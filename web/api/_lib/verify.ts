// Verifies that a NEAR AI Cloud answer was signed inside an attested TEE.
// Method follows near-examples/nearai-cloud-verification-example:
//   signed text = "<model>:<sha256(request body)>:<sha256(response body)>"
//   signature   = EIP-191 personal_sign by the model's enclave key
//   the key must appear in a fresh attestation report bound to our nonce.

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export const sha256Hex = (s: string) => bytesToHex(sha256(utf8ToBytes(s)));

/** Recover the Ethereum address that personal_sign'ed `text`. */
export function recoverSigner(text: string, signatureHex: string): string {
  const msg = utf8ToBytes(text);
  const prefixed = new Uint8Array([...utf8ToBytes(`\x19Ethereum Signed Message:\n${msg.length}`), ...msg]);
  const hash = keccak_256(prefixed);
  const sig = hexToBytes(signatureHex.replace(/^0x/, ""));
  if (sig.length !== 65) throw new Error("Signature must be 65 bytes");
  const v = sig[64] >= 27 ? sig[64] - 27 : sig[64];
  const recovered = secp256k1.Signature.fromBytes(sig.slice(0, 64), "compact").addRecoveryBit(v);
  const pub = recovered.recoverPublicKey(hash).toBytes(false);
  return "0x" + bytesToHex(keccak_256(pub.slice(1)).slice(-20));
}

export interface ModelAttestation {
  model_name?: string;
  signing_address: string;
  request_nonce?: string;
}

export interface AttestationCheck {
  signer_in_report: boolean;
  nonce_bound: boolean;
  report_nonce: string;
}

const cache = new Map<string, { at: number; check: AttestationCheck }>();
const CACHE_MS = 10 * 60_000;

/** Fetch a fresh attestation report (with our own nonce) and check the signer is in it. */
export async function checkAttestation(base: string, key: string, model: string, signer: string): Promise<AttestationCheck> {
  const hit = cache.get(`${model}:${signer}`);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.check;
  const nonce = bytesToHex(randomBytes(32));
  const res = await fetch(`${base}/attestation/report?model=${encodeURIComponent(model)}&signing_algo=ecdsa&nonce=${nonce}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Attestation report failed (${res.status})`);
  const report = (await res.json()) as { model_attestations?: ModelAttestation[] };
  const match = (report.model_attestations ?? []).find((a) => a.signing_address?.toLowerCase() === signer.toLowerCase());
  const check: AttestationCheck = {
    signer_in_report: !!match,
    nonce_bound: match?.request_nonce?.toLowerCase() === nonce,
    report_nonce: nonce,
  };
  if (check.signer_in_report && check.nonce_bound) cache.set(`${model}:${signer}`, { at: Date.now(), check });
  return check;
}
