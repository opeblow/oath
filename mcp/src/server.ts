#!/usr/bin/env node
// OATH MCP server (stdio). Lets any MCP client read coins, audit them, find broken oaths and enforce them.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { near, parseNear, parseTokens, tokens } from "../../web/src/lib/format";
import { audit, coin, enforce, factory, FACTORY, NETWORK, scan, signer, summary, verify } from "./oath";

const server = new McpServer({ name: "oath", version: "0.1.0" });

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const coinId = z.string().describe(`Coin account, e.g. first.${FACTORY}`);

server.registerTool(
  "list_coins",
  {
    description: `List OATH memecoins registered in the factory ${FACTORY} on NEAR ${NETWORK}, newest last.`,
    inputSchema: { from: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(20) },
  },
  async ({ from, limit }) => {
    const [total, coins] = await Promise.all([factory.count(), factory.coins(from, limit)]);
    return json({ total, coins: coins.map((c) => ({ coin_id: c.coin_id, name: c.name, symbol: c.symbol, creator: c.creator, bond_near: near(c.bond) })) });
  },
);

server.registerTool(
  "get_coin",
  {
    description: "Read one coin: every oath in plain words with its live status, locked liquidity, bond at stake, and payouts to holders.",
    inputSchema: { coin_id: coinId },
  },
  async ({ coin_id }) => json(summary(await coin.certificate(coin_id))),
);

server.registerTool(
  "verify_coin",
  {
    description: "Re-check a coin's trust claims from the chain: zero access keys, runs the published OATH code, listed in the factory, fully backed.",
    inputSchema: { coin_id: coinId },
  },
  async ({ coin_id }) => {
    const [v, c] = await Promise.all([verify(coin_id), coin.certificate(coin_id)]);
    return json({ ...v, solvent: c.accounting.solvent, trustworthy: v.access_keys === 0 && v.runs_published_code && v.registered_in_factory && c.accounting.solvent });
  },
);

server.registerTool(
  "audit_coin",
  {
    description: "Rule-based risk audit (oath-audit/1): grade A to D with findings on vesting, wallet cap, fee, treasury, bond and broken oaths.",
    inputSchema: { coin_id: coinId },
  },
  async ({ coin_id }) => json(audit(await coin.certificate(coin_id))),
);

server.registerTool(
  "find_enforceable",
  {
    description: "Scan every coin for bonded oaths that are broken right now. Enforcing one pays the caller 5% of its stake.",
    inputSchema: {},
  },
  async () => {
    const s = await scan();
    return json({
      scanned: s.scanned,
      enforceable: s.enforceable.map((e) => ({ ...e, stake_near: near(e.stake), bounty_near: near(e.bounty) })),
      next_deadlines: s.upcoming.slice(0, 10).map((u) => ({ ...u, deadline: new Date(Number(BigInt(u.deadline_ns) / 1_000_000n)).toISOString(), stake_near: near(u.stake) })),
    });
  },
);

server.registerTool(
  "quote",
  {
    description: "Quote a buy (NEAR in) or a sell (tokens in) on a coin's bonding curve.",
    inputSchema: { coin_id: coinId, side: z.enum(["buy", "sell"]), amount: z.string().describe("NEAR for buy, tokens for sell, as a decimal string") },
  },
  async ({ coin_id, side, amount }) => {
    if (side === "buy") {
      const q = await coin.quoteBuy(coin_id, parseNear(amount));
      return json({ tokens_out: tokens(q.tokens_out), fee_near: near(q.fee), refund_near: near(q.refund), registration_near: near(q.registration_cost) });
    }
    const q = await coin.quoteSell(coin_id, parseTokens(amount));
    return json({ near_out: near(q.near_out), fee_near: near(q.fee) });
  },
);

server.registerTool(
  "get_holder",
  {
    description: "A holder's balance, vesting lock and NEAR claimable from enforced oaths.",
    inputSchema: { coin_id: coinId, account_id: z.string() },
  },
  async ({ coin_id, account_id }) => {
    const h = await coin.holder(coin_id, account_id);
    return json({ ...h, balance_tokens: tokens(h.balance), locked_tokens: tokens(h.locked), claimable_near: near(h.claimable) });
  },
);

server.registerTool(
  "get_activity",
  {
    description: "Latest on-chain events of a coin: buys, sells, creator updates, treasury spends, enforcements, claims.",
    inputSchema: { coin_id: coinId, limit: z.number().int().min(1).max(64).default(20) },
  },
  async ({ coin_id, limit }) => json(await coin.activity(coin_id, limit)),
);

server.registerTool(
  "enforce_oath",
  {
    description: "Enforce a broken bonded oath and earn 5% of its stake. Requires NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY in the server environment. Sends a real transaction.",
    inputSchema: { coin_id: coinId, index: z.number().int().min(0) },
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ coin_id, index }) => {
    const account = signer();
    if (!account) return { isError: true, content: [{ type: "text" as const, text: "Set NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY to enable enforcement." }] };
    const c = await coin.certificate(coin_id);
    const oath = c.bonded.find((b) => b.index === index);
    if (!oath || oath.status !== "breakable") return { isError: true, content: [{ type: "text" as const, text: `Oath ${index} on ${coin_id} is ${oath?.status ?? "missing"}, not enforceable.` }] };
    const bounty = await enforce(account, coin_id, index);
    return json({ enforced: true, coin_id, index, enforcer: account.accountId, bounty_near: near(bounty) });
  },
);

await server.connect(new StdioServerTransport());
