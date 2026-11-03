// Chain access for the MCP server and the watcher. Reads use plain JSON-RPC; writes use near-api-js.

import { Account } from "near-api-js";
import { audit } from "../../web/src/lib/audit";
import { near } from "../../web/src/lib/format";
import { bondedLine, bondedOaths, sealedOaths } from "../../web/src/lib/oaths";
import type { Activity, BuyQuote, Certificate, CoinEntry, HolderView, SellQuote } from "../../web/src/lib/types";

export const FACTORY = process.env.OATH_FACTORY_ID || "oathcoin.testnet";
export const TOKEN_CODE_HASH = process.env.OATH_TOKEN_CODE_HASH || "DjVgSpu5TjKGe4BDjmLpQGGpLB5d7U1xRjSCoLsouKmi";
export const NETWORK = process.env.NEAR_NETWORK || "testnet";
export const RPC = process.env.NEAR_RPC || (NETWORK === "mainnet" ? "https://rpc.mainnet.fastnear.com" : "https://rpc.testnet.fastnear.com");
export const SITE = process.env.OATH_SITE || "https://oath-near.vercel.app";

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "oath", method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const body = (await res.json()) as { result?: T & { error?: string }; error?: { cause?: { info?: { error_message?: string } }; message?: string } };
  if (body.error) throw new Error(body.error.cause?.info?.error_message ?? body.error.message ?? "RPC error");
  if (body.result && typeof body.result === "object" && "error" in body.result && body.result.error) throw new Error(body.result.error);
  return body.result as T;
}

export async function view<T>(contractId: string, method: string, args: object = {}): Promise<T> {
  const r = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString()) as T;
}

export const factory = {
  count: () => view<number>(FACTORY, "get_coin_count"),
  coins: (from = 0, limit = 50) => view<CoinEntry[]>(FACTORY, "get_coins", { from, limit }),
  coin: (id: string) => view<CoinEntry | null>(FACTORY, "get_coin", { coin_id: id }),
  async all(): Promise<CoinEntry[]> {
    const total = await factory.count();
    const out: CoinEntry[] = [];
    for (let from = 0; from < total; from += 50) out.push(...(await factory.coins(from, 50)));
    return out;
  },
};

export const coin = {
  certificate: (id: string) => view<Certificate>(id, "get_certificate"),
  holder: (id: string, account: string) => view<HolderView>(id, "get_holder", { account_id: account }),
  quoteBuy: (id: string, nearIn: string) => view<BuyQuote>(id, "quote_buy", { near_in: nearIn, account_id: null }),
  quoteSell: (id: string, amount: string) => view<SellQuote>(id, "quote_sell", { amount }),
  activity: (id: string, limit = 20) => view<Activity[]>(id, "get_activity", { from: 0, limit }),
};

/** Re-check the trust claims from the chain: no keys, published code, registered in the factory. */
export async function verify(id: string) {
  const [keys, account, entry] = await Promise.all([
    rpc<{ keys: unknown[] }>("query", { request_type: "view_access_key_list", finality: "final", account_id: id }),
    rpc<{ global_contract_hash?: string | null }>("query", { request_type: "view_account", finality: "final", account_id: id }),
    factory.coin(id),
  ]);
  return {
    access_keys: keys.keys.length,
    code_hash: account.global_contract_hash ?? null,
    runs_published_code: account.global_contract_hash === TOKEN_CODE_HASH,
    registered_in_factory: !!entry,
  };
}

export function summary(c: Certificate) {
  const oaths = [...sealedOaths(c), ...bondedOaths(c)];
  return {
    coin_id: c.contract_id,
    name: c.name,
    symbol: c.symbol,
    creator: c.creator,
    manifesto: c.manifesto,
    page: `${SITE}/coin/${c.contract_id}`,
    locked_liquidity_near: near(c.curve.real_near_reserve),
    bond_at_stake_near: near(c.bond_locked),
    paid_to_holders_near: near(c.payouts_distributed),
    holders: c.holders,
    solvent: c.accounting.solvent,
    oaths: oaths.map((o, i) => ({
      n: i + 1,
      kind: o.kind,
      status: o.status,
      title: o.title,
      plain: o.plain,
      proof: o.proof,
      ...(o.bonded ? { index: o.bonded.index, stake_near: near(o.bonded.stake) } : {}),
    })),
  };
}

export interface Enforceable {
  coin_id: string;
  symbol: string;
  index: number;
  title: string;
  stake: string;
  bounty: string;
}

export interface Upcoming {
  coin_id: string;
  symbol: string;
  index: number;
  title: string;
  deadline_ns: string;
  stake: string;
}

/** Scan every coin for broken bonded oaths and upcoming deadlines. */
export async function scan(): Promise<{ scanned: number; enforceable: Enforceable[]; upcoming: Upcoming[] }> {
  const entries = await factory.all();
  const enforceable: Enforceable[] = [];
  const upcoming: Upcoming[] = [];
  let scanned = 0;
  for (let i = 0; i < entries.length; i += 8) {
    const certs = await Promise.all(entries.slice(i, i + 8).map((e) => coin.certificate(e.coin_id).catch(() => null)));
    for (const c of certs) {
      if (!c) continue;
      scanned++;
      for (const b of c.bonded) {
        const title = bondedLine(b, c.symbol).title;
        if (b.status === "breakable") {
          enforceable.push({ coin_id: c.contract_id, symbol: c.symbol, index: b.index, title, stake: b.stake, bounty: ((BigInt(b.stake) * 5n) / 100n).toString() });
        } else if (b.status === "active") {
          const deadline = b.kind === "heartbeat" ? (b.next_due_ns ?? b.ends_at_ns) : b.ends_at_ns;
          upcoming.push({ coin_id: c.contract_id, symbol: c.symbol, index: b.index, title, deadline_ns: deadline, stake: b.stake });
        }
      }
    }
  }
  upcoming.sort((a, b) => (BigInt(a.deadline_ns) < BigInt(b.deadline_ns) ? -1 : 1));
  return { scanned, enforceable, upcoming };
}

export { audit };

/** A signing account from NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY, or null when not configured. */
export function signer(): Account | null {
  const id = process.env.NEAR_ACCOUNT_ID;
  const key = process.env.NEAR_PRIVATE_KEY;
  if (!id || !key) return null;
  return new Account(id, RPC, key as `ed25519:${string}`);
}

export async function enforce(account: Account, coinId: string, index: number): Promise<string> {
  const bounty = await account.callFunction<string>({ contractId: coinId, methodName: "enforce", args: { index }, gas: "60000000000000" });
  return String(bounty ?? "0");
}
