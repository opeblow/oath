// Starts the built MCP server over stdio and calls its tools against NEAR testnet.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "oath-test", version: "1.0.0" });
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  assert.ok(!r.isError, r.content?.[0]?.text);
  return JSON.parse(r.content[0].text);
};

before(async () => {
  const env = { ...process.env };
  delete env.NEAR_ACCOUNT_ID;
  delete env.NEAR_PRIVATE_KEY;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/server.js"], env }));
});
after(() => client.close());

test("lists the tools", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["audit_coin", "enforce_oath", "find_enforceable", "get_activity", "get_coin", "get_holder", "list_coins", "quote", "verify_coin"]);
});

test("reads the registry and a coin", async () => {
  const list = await call("list_coins", { limit: 5 });
  assert.ok(list.total >= 1);
  const id = list.coins[0].coin_id;
  const c = await call("get_coin", { coin_id: id });
  assert.equal(c.coin_id, id);
  assert.ok(c.oaths.length >= 5);
});

test("verifies a coin is sealed", async () => {
  const v = await call("verify_coin", { coin_id: "first.oathcoin.testnet" });
  assert.equal(v.access_keys, 0);
  assert.equal(v.runs_published_code, true);
  assert.equal(v.trustworthy, true);
});

test("audits and quotes", async () => {
  const a = await call("audit_coin", { coin_id: "kept.oathcoin.testnet" });
  assert.match(a.grade, /^[A-D]$/);
  const q = await call("quote", { coin_id: "kept.oathcoin.testnet", side: "buy", amount: "1" });
  assert.ok(q.tokens_out);
});

test("scans for enforceable oaths", async () => {
  const s = await call("find_enforceable");
  assert.ok(s.scanned >= 2);
  assert.ok(Array.isArray(s.enforceable));
});

test("refuses to enforce without a key", async () => {
  const r = await client.callTool({ name: "enforce_oath", arguments: { coin_id: "first.oathcoin.testnet", index: 0 } });
  assert.equal(r.isError, true);
});
