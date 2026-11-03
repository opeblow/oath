#!/usr/bin/env node
// Run the OATH auditor (auditor/, WASI) on NEAR OutLayer for one coin.
// The certificate is read from the chain, sent as stdin to the WASM, and the audit comes back
// in the transaction outcome, so the result is recorded on-chain and anyone can re-check it.
// Usage: oath-outlayer-audit <coin_id> [--wasm-url URL] [--hash HEX]
// Needs NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY (pays about 0.003 NEAR; unused deposit is refunded).

import { coin, NETWORK, signer, SITE } from "./oath";

const OUTLAYER = NETWORK === "mainnet" ? "outlayer.near" : "outlayer.testnet";
// sha256 of web/public/auditor/oath-audit.wasm (built from auditor/ with cargo build --release --target wasm32-wasip1)
export const AUDITOR_SHA256 = "54d4fee5a4d4b531de21556783984dce0af2aa89d536ddfd16a7096fae5df3e4";

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const coinId = args.find((a) => !a.startsWith("--") && a !== opt("--wasm-url") && a !== opt("--hash"));
const wasmUrl = opt("--wasm-url") ?? `${SITE}/auditor/oath-audit.wasm`;
const hash = opt("--hash") ?? AUDITOR_SHA256;

if (!coinId) {
  console.error("Usage: oath-outlayer-audit <coin_id> [--wasm-url URL] [--hash HEX]");
  process.exit(1);
}
const account = signer();
if (!account) {
  console.error("Set NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY.");
  process.exit(1);
}

const cert = await coin.certificate(coinId);
const { icon: _icon, ...slim } = cert;
console.log(`Auditing ${coinId} on ${OUTLAYER} with ${wasmUrl}`);
const outcome = await account.callFunctionRaw({
  contractId: OUTLAYER,
  methodName: "request_execution",
  args: {
    source: { WasmUrl: { url: wasmUrl, hash, build_target: "wasm32-wasip1" } },
    input_data: JSON.stringify(slim),
    resource_limits: { max_instructions: 1_000_000_000, max_memory_mb: 64, max_execution_seconds: 20 },
    response_format: "Json",
  },
  deposit: "50000000000000000000000", // 0.05 NEAR, unused part refunded
  gas: "300000000000000",
  waitUntil: "FINAL",
});

const tx = (outcome as { transaction?: { hash?: string } }).transaction?.hash;
const status = (outcome as { status?: { SuccessValue?: string; Failure?: unknown } }).status;
console.log(`Transaction: ${tx}`);
if (status && "SuccessValue" in status && status.SuccessValue !== undefined) {
  const text = Buffer.from(status.SuccessValue, "base64").toString();
  console.log(text ? JSON.stringify(JSON.parse(text), null, 2) : "(empty result: see the transaction logs)");
} else {
  console.log(JSON.stringify(status, null, 2));
  process.exitCode = 1;
}
