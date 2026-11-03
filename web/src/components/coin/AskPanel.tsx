import { useState } from "react";
import { askAboutCoin, type AskResponse } from "../../lib/ask";
import type { Certificate } from "../../lib/types";

const SUGGESTED = ["Can the creator take the liquidity?", "What happens if the creator stops posting updates?", "How much can the creator sell, and when?"];

/** Ask a private AI model about this coin. The answer is signed inside a TEE and verified by the API. */
export function AskPanel({ cert }: { cert: Certificate }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AskResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setQ(question);
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      setRes(await askAboutCoin(cert.contract_id, question.trim()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No answer");
    } finally {
      setBusy(false);
    }
  }

  const a = res?.attestation;
  return (
    <div className="ask-box">
      <p className="small muted" style={{ margin: 0 }}>
        The model reads this coin's live certificate and answers in plain words. It runs on NEAR AI Cloud inside a secure enclave, and the server checks the enclave's signature before showing you the answer.
      </p>
      <form
        className="input-row"
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        <input className="input" maxLength={300} placeholder={`Ask anything about ${cert.symbol}`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Question" />
        <button className="btn btn-sm" disabled={busy || !q.trim()}>{busy ? "Thinking..." : "Ask"}</button>
      </form>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {SUGGESTED.map((s) => (
          <button key={s} className="btn btn-ghost btn-sm" disabled={busy} onClick={() => ask(s)}>{s}</button>
        ))}
      </div>
      {err && <div className="error-text">{err}</div>}
      {busy && <div className="skeleton" style={{ height: 90 }} />}
      {res && (
        <>
          <div className="ask-answer">{res.answer}</div>
          {a ? (
            <div className="attest">
              <span>
                <strong className={a.verified ? "verify-ok" : "verify-bad"} style={{ marginRight: 6 }}>{a.verified ? "Verified" : "Unverified"}</strong>
                Signed by enclave key <span className="mono">{a.signer.slice(0, 10)}...{a.signer.slice(-6)}</span>
              </span>
              <span>Model {a.model}, chat <span className="mono">{a.chat_id}</span></span>
              {a.checks && (
                <span>
                  {[
                    [a.checks.hashes_match, "request and answer hashes match the signed text"],
                    [a.checks.signature_valid, "signature recovers to the enclave key"],
                    [a.checks.signer_in_report, "key is in the model's TEE attestation report"],
                    [a.checks.nonce_bound, "report is fresh (bound to our nonce)"],
                  ].map(([ok, label]) => `${ok ? "Pass" : "Fail"}: ${label}`).join(". ")}.
                </span>
              )}
              <span className="mono" style={{ overflowWrap: "anywhere" }}>{a.signed_text}</span>
            </div>
          ) : (
            <div className="attest">No attestation was returned for this answer.</div>
          )}
        </>
      )}
    </div>
  );
}
