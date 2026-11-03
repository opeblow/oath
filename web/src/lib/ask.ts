import { API_BASE } from "./config";

/** Proof that the answer came from a model running in a TEE on NEAR AI Cloud. */
export interface AskAttestation {
  model: string;
  chat_id: string;
  /** EIP-191 signer recovered from the response signature. */
  signer: string;
  /** True when the signer matches an address in the model's attestation report. */
  verified: boolean;
  /** "model:sha256(request):sha256(response)" as signed by the enclave. */
  signed_text: string;
  signature: string;
  checks?: { hashes_match: boolean; signature_valid: boolean; signer_in_report: boolean; nonce_bound: boolean };
}

export interface AskResponse {
  answer: string;
  attestation: AskAttestation | null;
}

export async function askAboutCoin(coinId: string, question: string): Promise<AskResponse> {
  const res = await fetch(`${API_BASE}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coin_id: coinId, question }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `The auditor is unavailable (${res.status})`);
  return body as AskResponse;
}
