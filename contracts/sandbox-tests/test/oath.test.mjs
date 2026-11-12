// End-to-end: publish the token as a global contract, run the factory, launch coins, trade,
// break and keep oaths, enforce, claim. Runs on a local NEAR sandbox.
// Wasm paths: OATH_TOKEN_WASM / OATH_FACTORY_WASM.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Account, JsonRpcProvider } from "near-api-js";
import { Sandbox, DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY, DEFAULT_PUBLIC_KEY } from "near-sandbox";

const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;
const near = (x) => (BigInt(Math.round(x * 1000)) * NEAR) / 1000n;
const TOKEN_WASM = process.env.OATH_TOKEN_WASM ?? "../target/near/oath_token/oath_token.wasm";
const FACTORY_WASM = process.env.OATH_FACTORY_WASM ?? "../target/near/oath_factory/oath_factory.wasm";

let sandbox, provider, root, factory, creator, alice, bob, watcher, tokenHash;

function base58(bytes) {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let s = "";
  while (n > 0n) {
    s = A[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b === 0) s = "1" + s;
    else break;
  }
  return s;
}

const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });
const call = (account, contractId, methodName, args = {}, deposit = 0n, gas = 100n * TGAS) =>
  account.callFunction({ contractId, methodName, args, deposit, gas });

async function rejects(promise, pattern) {
  await assert.rejects(promise, (e) => {
    const text = String(e?.message ?? e) + " " + JSON.stringify(e?.cause ?? e?.type ?? "");
    assert.match(text, pattern);
    return true;
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sub(name, amount) {
  const id = `${name}.${DEFAULT_ACCOUNT_ID}`;
  await root.createAccount({ newAccountId: id, publicKey: DEFAULT_PUBLIC_KEY, nearToTransfer: amount });
  return new Account(id, provider, DEFAULT_PRIVATE_KEY);
}

function params(overrides = {}) {
  return {
    name: "Test Dog",
    symbol: "TDOG",
    icon: null,
    manifesto: "Sandbox coin.",
    total_supply_whole: "1000000000",
    creator_alloc_bps: 500,
    vest_cliff_secs: 3600,
    vest_duration_secs: 7200,
    virtual_near: (20n * NEAR).toString(),
    fee_bps: 100,
    max_wallet_bps: 300,
    launch_window_secs: 3600,
    treasury: { recipients: [`bob.${DEFAULT_ACCOUNT_ID}`], max_per_period: (NEAR / 100n).toString(), period_secs: 3600 },
    bonded: [],
    ...overrides,
  };
}
const launchCost = (p) => p.bonded.reduce((a, b) => a + BigInt(b.stake), 0n) + (52n * NEAR) / 100n;

async function launch(subName, p) {
  await call(creator, factory.accountId, "create_coin", { sub: subName, params: p }, launchCost(p), 300n * TGAS);
  return `${subName}.${factory.accountId}`;
}

before(
  async () => {
    sandbox = await Sandbox.start({ version: process.env.NEAR_SANDBOX_VERSION ?? "2.14.0" });
    provider = new JsonRpcProvider({ url: sandbox.rpcUrl });
    root = new Account(DEFAULT_ACCOUNT_ID, provider, DEFAULT_PRIVATE_KEY);
    const token = readFileSync(TOKEN_WASM);
    tokenHash = base58(createHash("sha256").update(token).digest());
    const publisher = await sub("code", near(60));
    await publisher.deployGlobalContract(new Uint8Array(token), "codeHash");
    factory = await sub("factory", near(20));
    await factory.deployContract(new Uint8Array(readFileSync(FACTORY_WASM)));
    await call(factory, factory.accountId, "new", { token_code_hash: tokenHash });
    creator = await sub("creator", near(100));
    alice = await sub("alice", near(100));
    bob = await sub("bob", near(100));
    watcher = await sub("watcher", near(10));
  },
  { timeout: 180_000 },
);

after(async () => {
  await sandbox?.tearDown();
});

test("launch creates a sealed coin running the published code", async () => {
  const id = await launch("dog", params());
  const keys = await provider.viewAccessKeyList({ accountId: id });
  assert.equal(keys.keys.length, 0, "coin account must have no access keys");
  const acc = await provider.viewAccount({ accountId: id });
  assert.equal(acc.global_contract_hash ?? acc.globalContractHash, tokenHash);
  const entry = await view(factory.accountId, "get_coin", { coin_id: id });
  assert.equal(entry.symbol, "TDOG");
  const cert = await view(id, "get_certificate");
  assert.equal(cert.creator, creator.accountId);
  assert.equal(cert.accounting.solvent, true);
});

test("factory rejects a wrong deposit and a duplicate coin", async () => {
  await rejects(call(creator, factory.accountId, "create_coin", { sub: "cat", params: params() }, NEAR, 300n * TGAS), /Attach exactly/);
  await rejects(call(creator, factory.accountId, "create_coin", { sub: "dog", params: params() }, launchCost(params()), 300n * TGAS), /already exists/);
});

test("buy, sell, and the launch-window rules", async () => {
  const id = `dog.${factory.accountId}`;
  await call(alice, id, "buy", { min_tokens_out: "0" }, near(0.5));
  const h = await view(id, "get_holder", { account_id: alice.accountId });
  assert.ok(BigInt(h.balance) > 0n);
  await rejects(call(creator, id, "buy", { min_tokens_out: "0" }, near(1)), /creator cannot buy/);
  await rejects(call(bob, id, "buy", { min_tokens_out: "0" }, near(50)), /[Mm]ax wallet|more than|cap/);
  const half = (BigInt(h.balance) / 2n).toString();
  const q = await view(id, "quote_sell", { amount: half });
  const before = await alice.getBalance();
  await call(alice, id, "sell", { amount: half, min_near_out: q.near_out }, 1n);
  assert.ok((await alice.getBalance()) > before, "seller receives NEAR");
  assert.equal((await view(id, "get_certificate")).accounting.solvent, true);
});

test("liquidity cannot be withdrawn and creator tokens cannot move while vesting", async () => {
  const id = `dog.${factory.accountId}`;
  await rejects(call(creator, id, "withdraw", {}), /MethodNotFound|not found|MethodResolveError/i);
  await call(alice, id, "storage_deposit", { account_id: bob.accountId }, near(0.01));
  await rejects(call(creator, id, "ft_transfer", { receiver_id: bob.accountId, amount: "1000000000000000000" }, 1n), /still vesting/);
});

test("treasury spends follow the launch rules", async () => {
  const id = `dog.${factory.accountId}`;
  await rejects(call(creator, id, "treasury_spend", { recipient: alice.accountId, amount: "1000", memo: "x" }, 1n), /not declared/);
  await rejects(call(alice, id, "treasury_spend", { recipient: bob.accountId, amount: "1000", memo: "x" }, 1n), /Only the creator/);
  const t = BigInt((await view(id, "get_certificate")).accounting.treasury);
  assert.ok(t > 0n, "fees reached the treasury");
  await call(creator, id, "treasury_spend", { recipient: bob.accountId, amount: (t / 2n).toString(), memo: "Artist payment" }, 1n);
  await rejects(call(creator, id, "treasury_spend", { recipient: bob.accountId, amount: (NEAR / 50n).toString(), memo: "too much" }, 1n), /limit|Not enough/);
});

test("a kept floor oath returns the stake to the creator", async () => {
  const p = params({ symbol: "KEEP", bonded: [{ terms: { kind: "floor_top_up", amount: NEAR.toString(), within_secs: 600 }, stake: NEAR.toString() }] });
  const id = await launch("keep", p);
  await rejects(call(creator, id, "reclaim_stake", { index: 0 }), /not kept/);
  await rejects(call(watcher, id, "enforce", { index: 0 }), /not broken/);
  await call(creator, id, "add_to_floor", {}, NEAR);
  assert.equal((await view(id, "get_certificate")).bonded[0].status, "kept");
  await rejects(call(alice, id, "reclaim_stake", { index: 0 }), /Only the creator/);
  await call(creator, id, "reclaim_stake", { index: 0 });
  await rejects(call(creator, id, "reclaim_stake", { index: 0 }), /Already reclaimed/);
  assert.equal((await view(id, "get_certificate")).bond_locked, "0");
});

test("a missed heartbeat is enforced: 5% to the enforcer, 95% to holders", { timeout: 180_000 }, async () => {
  const stake = NEAR;
  const p = params({ symbol: "BEAT", bonded: [{ terms: { kind: "heartbeat", every_secs: 60, for_secs: 3600 }, stake: stake.toString() }] });
  const id = await launch("beat", p);
  await call(alice, id, "buy", { min_tokens_out: "0" }, near(0.5));
  await call(creator, id, "heartbeat", { message: "Shipped the sandbox test." });
  await rejects(call(watcher, id, "enforce", { index: 0 }), /not broken/);
  await sleep(65_000);
  assert.equal((await view(id, "get_certificate")).bonded[0].status, "breakable");
  const w0 = await watcher.getBalance();
  const bounty = BigInt(await call(watcher, id, "enforce", { index: 0 }));
  assert.equal(bounty, stake / 20n);
  assert.ok((await watcher.getBalance()) > w0, "enforcer was paid");
  assert.equal((await view(id, "get_certificate")).bonded[0].status, "broken");
  const h = await view(id, "get_holder", { account_id: alice.accountId });
  assert.ok(BigInt(h.claimable) > 0n, "holder can claim");
  assert.ok(BigInt(h.claimable) <= (stake * 95n) / 100n);
  const claimed = BigInt(await call(alice, id, "claim"));
  assert.equal(claimed, BigInt(h.claimable));
  await rejects(call(alice, id, "claim"), /Nothing to claim/);
  await rejects(call(creator, id, "heartbeat", { message: "too late" }), /No active heartbeat/);
  assert.equal((await view(id, "get_certificate")).accounting.solvent, true);
});

test("an enforced oath is final: no second enforcement, no reclaim", async () => {
  const id = `beat.${factory.accountId}`;
  const before = await view(id, "get_certificate");
  await rejects(call(watcher, id, "enforce", { index: 0 }), /not broken/);
  await rejects(call(bob, id, "enforce", { index: 0 }), /not broken/);
  await rejects(call(creator, id, "reclaim_stake", { index: 0 }), /not kept/);
  await rejects(call(watcher, id, "enforce", { index: 7 }), /No such oath/);
  const after = await view(id, "get_certificate");
  assert.equal(after.bond_locked, "0");
  assert.equal(after.payouts_distributed, before.payouts_distributed, "failed calls change nothing");
  assert.equal(after.bonded[0].enforced_by, watcher.accountId);
  assert.equal(BigInt(after.payouts_distributed) + BigInt(after.curve.floor_added), (NEAR * 95n) / 100n);
});

test("two broken oaths, two holders: both stakes are fully accounted for", { timeout: 240_000 }, async () => {
  const stake = NEAR;
  const p = params({
    symbol: "DUO",
    bonded: [
      { terms: { kind: "heartbeat", every_secs: 60, for_secs: 3600 }, stake: stake.toString() },
      { terms: { kind: "floor_top_up", amount: NEAR.toString(), within_secs: 60 }, stake: (stake / 2n).toString() },
    ],
  });
  const id = await launch("duo", p);
  await call(alice, id, "buy", { min_tokens_out: "0" }, near(0.5));
  await call(bob, id, "buy", { min_tokens_out: "0" }, near(0.25));

  // Too early: both calls fail and the bond is untouched.
  await rejects(call(watcher, id, "enforce", { index: 0 }), /not broken/);
  await rejects(call(watcher, id, "enforce", { index: 1 }), /not broken/);
  assert.equal((await view(id, "get_certificate")).bond_locked, (stake + stake / 2n).toString());

  await sleep(65_000);
  let cert = await view(id, "get_certificate");
  assert.deepEqual(cert.bonded.map((b) => b.status), ["breakable", "breakable"]);

  // A deposit after the deadline is welcome in the floor but does not rescue the oath.
  await call(creator, id, "add_to_floor", {}, NEAR);
  assert.equal((await view(id, "get_certificate")).bonded[1].status, "breakable");

  // Any account can enforce, including a holder.
  const b1 = BigInt(await call(watcher, id, "enforce", { index: 1 }));
  const b0 = BigInt(await call(bob, id, "enforce", { index: 0 }));
  assert.equal(b1, stake / 40n);
  assert.equal(b0, stake / 20n);
  await rejects(call(watcher, id, "enforce", { index: 0 }), /not broken/);
  await rejects(call(watcher, id, "enforce", { index: 1 }), /not broken/);

  const pool = stake + stake / 2n - b0 - b1;
  const ha = await view(id, "get_holder", { account_id: alice.accountId });
  const hb = await view(id, "get_holder", { account_id: bob.accountId });
  const owedA = BigInt(ha.claimable);
  const owedB = BigInt(hb.claimable);
  assert.ok(owedA + owedB <= pool && owedA + owedB >= pool - 6n, "holders are owed the whole pool, less dust");
  const expectedA = (pool * BigInt(ha.balance)) / (BigInt(ha.balance) + BigInt(hb.balance));
  const diff = owedA > expectedA ? owedA - expectedA : expectedA - owedA;
  assert.ok(diff <= 4n, "shares follow balances");
  assert.equal((await view(id, "get_holder", { account_id: creator.accountId })).claimable, "0");

  assert.equal(BigInt(await call(alice, id, "claim")), owedA);
  assert.equal(BigInt(await call(bob, id, "claim")), owedB);
  await rejects(call(alice, id, "claim"), /Nothing to claim/);
  await rejects(call(bob, id, "claim"), /Nothing to claim/);
  await rejects(call(creator, id, "claim"), /Nothing to claim/);

  cert = await view(id, "get_certificate");
  assert.equal(cert.bond_locked, "0");
  // Paid to holders + dust in the floor == both pools. The extra NEAR is the creator's late deposit.
  assert.equal(BigInt(cert.payouts_distributed) + BigInt(cert.curve.floor_added), pool + NEAR);
  assert.ok(BigInt(cert.accounting.unclaimed_payouts) < 6n);
  assert.equal(cert.accounting.solvent, true);
});

test("a launch that fails to initialise leaves no account and no registry entry", async () => {
  const bad = params({ symbol: "BAD", fee_bps: 500 }); // over the sealed 2% fee cap
  const before = await creator.getBalance();
  const count = await view(factory.accountId, "get_coin_count");
  await call(creator, factory.accountId, "create_coin", { sub: "bad", params: bad }, launchCost(bad), 300n * TGAS).catch(() => false);
  const id = `bad.${factory.accountId}`;
  await assert.rejects(provider.viewAccount({ accountId: id }), "the coin account must not exist");
  assert.equal(await view(factory.accountId, "get_coin", { coin_id: id }), null);
  assert.equal(await view(factory.accountId, "get_coin_count"), count);
  const spent = BigInt(before) - BigInt(await creator.getBalance());
  assert.ok(spent < NEAR / 10n, "the deposit came back; only gas was spent");
});

test("the real account balance of every coin covers its books", async () => {
  for (const sub of ["dog", "keep", "beat", "duo"]) {
    const id = `${sub}.${factory.accountId}`;
    const a = (await view(id, "get_certificate")).accounting;
    const account = await provider.viewAccount({ accountId: id });
    const balance = BigInt(account.amount ?? account.balance?.total ?? a.contract_balance);
    assert.equal(a.solvent, true, `${sub} reports solvent`);
    assert.ok(balance >= BigInt(a.liabilities) + BigInt(a.storage_cost), `${sub}: balance covers reserve, treasury, bond, payouts and storage`);
    assert.equal(BigInt(a.liabilities), BigInt(a.real_near_reserve) + BigInt(a.treasury) + BigInt(a.bond_locked) + BigInt(a.unclaimed_payouts));
    const keys = await provider.viewAccessKeyList({ accountId: id });
    assert.equal(keys.keys.length, 0, `${sub} has no access keys`);
  }
});
