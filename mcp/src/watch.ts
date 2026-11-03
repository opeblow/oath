#!/usr/bin/env node
// OATH watcher: scans every coin, and enforces broken bonded oaths for the 5% bounty.
// Usage: oath-watch [--once] [--interval 60] [--dry-run] [--claim]
// --claim also collects payouts owed to the signing account on every coin.
// Signing: NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY. Without them it only reports.

import { near } from "../../web/src/lib/format";
import { coin, enforce, factory, FACTORY, NETWORK, scan, signer } from "./oath";

const args = process.argv.slice(2);
const once = args.includes("--once");
const dry = args.includes("--dry-run");
const claim = args.includes("--claim");
const interval = Number(args[args.indexOf("--interval") + 1]) || 60;

const log = (msg: string) => console.log(`${new Date().toISOString()}  ${msg}`);

async function tick() {
  const account = dry ? null : signer();
  const s = await scan();
  log(`scanned ${s.scanned} coins on ${FACTORY} (${NETWORK}): ${s.enforceable.length} enforceable, ${s.upcoming.length} in force`);
  const next = s.upcoming[0];
  if (next) log(`next deadline: ${next.coin_id} oath ${next.index} "${next.title}" at ${new Date(Number(BigInt(next.deadline_ns) / 1_000_000n)).toISOString()}`);
  for (const e of s.enforceable) {
    if (!account) {
      log(`ENFORCEABLE ${e.coin_id} oath ${e.index} "${e.title}" stake ${near(e.stake)} NEAR, bounty ${near(e.bounty)} NEAR (report only)`);
      continue;
    }
    try {
      const bounty = await enforce(account, e.coin_id, e.index);
      log(`ENFORCED ${e.coin_id} oath ${e.index} as ${account.accountId}: earned ${near(bounty)} NEAR`);
    } catch (err) {
      log(`failed to enforce ${e.coin_id} oath ${e.index}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (claim && account) {
    for (const entry of await factory.all()) {
      const h = await coin.holder(entry.coin_id, account.accountId).catch(() => null);
      if (!h || BigInt(h.claimable) === 0n) continue;
      try {
        await account.callFunction({ contractId: entry.coin_id, methodName: "claim", args: {}, gas: "30000000000000" });
        log(`CLAIMED ${near(h.claimable)} NEAR from ${entry.coin_id} as ${account.accountId}`);
      } catch (err) {
        log(`failed to claim from ${entry.coin_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

if (!dry && !signer()) log("No NEAR_ACCOUNT_ID / NEAR_PRIVATE_KEY set: running in report-only mode.");
do {
  try {
    await tick();
  } catch (err) {
    log(`scan failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!once) await new Promise((r) => setTimeout(r, interval * 1000));
} while (!once);
