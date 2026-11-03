// Core of POST /api/ask. Shared by the Vercel function and the Vite dev server.

import { audit } from "../../src/lib/audit";
import { bondedOaths, sealedOaths } from "../../src/lib/oaths";
import type { Certificate } from "../../src/lib/types";
import { checkAttestation, recoverSigner, sha256Hex } from "./verify";

const BASE = "https://cloud-api.near.ai/v1";
export const MODEL = process.env.NEAR_AI_MODEL || "deepseek-ai/DeepSeek-V4.1-Flash-1017";
const FACTORY = process.env.OATH_FACTORY_ID || "oathcoin.testnet";
const RPC = process.env.OATH_RPC || "https://rpc.testnet.fastnear.com";
const MAX_QUESTION = 300;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Best-effort limit per server instance: protects the API credit from a single caller.
const hits = new Map<string, number[]>();
function rateLimit(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 6) throw new HttpError(429, "Too many questions. Wait a minute and try again.");
  recent.push(now);
  hits.set(ip, recent);
}

async function certificate(coinId: string): Promise<Certificate> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "oath",
      method: "query",
      params: { request_type: "call_function", finality: "optimistic", account_id: coinId, method_name: "get_certificate", args_base64: "e30=" },
    }),
  });
  const body = (await res.json()) as { result?: { result?: number[] }; error?: unknown };
  if (!body.result?.result) throw new HttpError(404, `No OATH coin at ${coinId}`);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result))) as Certificate;
}

const SYSTEM = `You explain one OATH memecoin to a possible buyer on NEAR.
OATH coins have sealed oaths (rules the contract enforces on every transaction) and bonded oaths (promises backed by staked NEAR; if broken, anyone can enforce: 5% of the stake to the enforcer, 95% to holders).
Answer only from the facts given. Prefer the plain-language oaths and rules; use raw values for exact numbers. Number oaths as they are listed (Oath 1, Oath 2, ...). If the facts do not answer the question, say so.
Amounts: NEAR values are in yoctoNEAR (divide by 1e24), token amounts have 18 decimals, times are nanoseconds since the Unix epoch. Convert them to readable numbers and dates.
Write plain English in at most 140 words. No markdown headings, no emojis, no financial advice. Say "the contract" rather than "we".`;

function facts(c: Certificate) {
  const { icon: _icon, ...rest } = c;
  const oaths = [...sealedOaths(c), ...bondedOaths(c)].map((o, i) => `Oath ${i + 1} (${o.kind}, ${o.status}): ${o.title}. ${o.plain} ${o.proof}`);
  return {
    oaths,
    rules: [
      "No function can withdraw the liquidity reserve; NEAR only leaves the curve when holders sell.",
      "The coin account has no access keys, so nobody can change the code or move funds by hand.",
      "A broken bonded oath can be enforced by anyone: 5% of its stake to the enforcer, 95% split across holders by balance (creator excluded), claimable from the coin page.",
      "A kept bonded oath lets the creator reclaim its stake.",
    ],
    audit: audit(c).findings.map((f) => `${f.severity}: ${f.title}. ${f.detail}`),
    raw: rest,
  };
}

export interface AskResult {
  answer: string;
  attestation: {
    model: string;
    chat_id: string;
    signer: string;
    verified: boolean;
    signed_text: string;
    signature: string;
    checks: { hashes_match: boolean; signature_valid: boolean; signer_in_report: boolean; nonce_bound: boolean };
  } | null;
}

export async function ask(input: unknown, ip: string): Promise<AskResult> {
  const key = process.env.NEAR_AI_API_KEY;
  if (!key) throw new HttpError(503, "The auditor is not configured on this server.");
  const { coin_id, question } = (input ?? {}) as { coin_id?: unknown; question?: unknown };
  if (typeof coin_id !== "string" || !coin_id.endsWith(`.${FACTORY}`) || !/^[a-z0-9-]+\.[a-z0-9.-]+$/.test(coin_id)) {
    throw new HttpError(400, "Unknown coin");
  }
  if (typeof question !== "string" || !question.trim() || question.length > MAX_QUESTION) {
    throw new HttpError(400, `Ask a question of 1 to ${MAX_QUESTION} characters`);
  }
  rateLimit(ip);

  const cert = await certificate(coin_id);
  const requestBody = JSON.stringify({
    model: MODEL,
    stream: false,
    max_tokens: 4000,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Facts (JSON, read live from ${coin_id}):\n${JSON.stringify(facts(cert))}\n\nQuestion: ${question.trim()}` },
    ],
  });
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: requestBody,
  });
  const responseText = await res.text();
  if (!res.ok) throw new HttpError(502, `NEAR AI returned ${res.status}`);
  const chat = JSON.parse(responseText) as { id: string; choices: { finish_reason?: string; message: { content: string | null } }[] };
  const answer = chat.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new HttpError(502, `The model returned no answer (${chat.choices?.[0]?.finish_reason ?? "unknown"}). Try again.`);

  let attestation: AskResult["attestation"] = null;
  try {
    const sres = await fetch(`${BASE}/signature/${encodeURIComponent(chat.id)}?model=${encodeURIComponent(MODEL)}&signing_algo=ecdsa`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (sres.ok) {
      const sig = (await sres.json()) as { text: string; signature: string; signing_address: string };
      const expected = `${MODEL}:${sha256Hex(requestBody)}:${sha256Hex(responseText)}`;
      const signer = recoverSigner(sig.text, sig.signature);
      const signatureValid = signer.toLowerCase() === sig.signing_address.toLowerCase();
      const report = await checkAttestation(BASE, key, MODEL, signer);
      const checks = {
        hashes_match: sig.text === expected,
        signature_valid: signatureValid,
        signer_in_report: report.signer_in_report,
        nonce_bound: report.nonce_bound,
      };
      attestation = {
        model: MODEL,
        chat_id: chat.id,
        signer,
        verified: Object.values(checks).every(Boolean),
        signed_text: sig.text,
        signature: sig.signature,
        checks,
      };
    }
  } catch {
    attestation = null;
  }
  return { answer, attestation };
}
