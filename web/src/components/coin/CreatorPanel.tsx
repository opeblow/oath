import { useState } from "react";
import { dateLabel, near, parseNear, relative } from "../../lib/format";
import type { Certificate } from "../../lib/types";
import { useTx } from "../../lib/useTx";

const MAX_MEMO = 140;

/** Creator-only actions: keep heartbeat oaths, top up the floor, spend the treasury. */
export function CreatorPanel({ cert, onChange }: { cert: Certificate; onChange: () => void }) {
  const { send, busy } = useTx(onChange);
  const [message, setMessage] = useState("");
  const [floor, setFloor] = useState("");
  const [recipient, setRecipient] = useState(cert.treasury_rule.recipients[0] ?? "");
  const [spend, setSpend] = useState("");
  const [memo, setMemo] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const beats = cert.bonded.filter((b) => b.kind === "heartbeat" && b.status === "active");
  const nextDue = beats.map((b) => b.next_due_ns).filter((x): x is string => !!x).sort()[0];
  const floors = cert.bonded.filter((b) => b.kind === "floor_top_up" && b.status === "active");
  const floorOwed = floors.reduce((a, b) => a + BigInt(b.amount ?? "0") - BigInt(b.deposited ?? "0"), 0n);
  const limit = BigInt(cert.treasury_rule.max_per_period);
  const spent = BigInt(cert.treasury_spent_this_period);
  const left = limit > spent ? limit - spent : 0n;
  const treasury = BigInt(cert.accounting.treasury);
  const canSpend = left < treasury ? left : treasury;

  function amount(v: string): string | null {
    try {
      setErr(null);
      return parseNear(v);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invalid amount");
      return null;
    }
  }

  return (
    <section className="panel" aria-label="Creator desk" style={{ borderColor: "var(--ink)" }}>
      <div className="panel-title">
        <h3>Creator desk</h3>
        <span className="small muted">Only you see this</span>
      </div>
      <div className="form-stack" style={{ gap: 22 }}>
        <div>
          <div className="field-label">Heartbeat</div>
          {beats.length === 0 ? (
            <p className="small muted" style={{ margin: "4px 0 0" }}>No heartbeat oath is in force.</p>
          ) : (
            <>
              <p className="small" style={{ margin: "4px 0 8px" }}>
                Next update due {nextDue ? <strong>{relative(nextDue)}</strong> : "now"}{nextDue ? ` (${dateLabel(nextDue)})` : ""}. Miss it and anyone can enforce the oath.
              </p>
              <textarea className="textarea" rows={3} maxLength={MAX_MEMO} placeholder="What did you ship? This is public and permanent." value={message} onChange={(e) => setMessage(e.target.value)} />
              <div className="small muted" style={{ textAlign: "right" }}>{message.length}/{MAX_MEMO}</div>
              <button
                className="btn btn-sm"
                disabled={!!busy || !message.trim()}
                onClick={async () => {
                  const r = await send("Post update", { contractId: cert.contract_id, method: "heartbeat", args: { message: message.trim() }, gas: "30000000000000" }, () => "Update posted. Heartbeat oaths renewed.");
                  if (r) setMessage("");
                }}
              >
                Post update
              </button>
            </>
          )}
        </div>

        <hr className="rule" />

        <div>
          <div className="field-label">Add to the liquidity floor</div>
          <p className="small" style={{ margin: "4px 0 8px" }}>
            {floorOwed > 0n ? `${near(floorOwed)} NEAR still owed to floor oaths.` : "Raises the price every holder can sell at. It cannot be withdrawn."}
          </p>
          <div className="input-row">
            <input className="input num" inputMode="decimal" placeholder={floorOwed > 0n ? near(floorOwed) : "0"} value={floor} onChange={(e) => setFloor(e.target.value.replace(/[^\d.]/g, ""))} />
            <span className="input-suffix">NEAR</span>
          </div>
          <button
            className="btn btn-sm"
            style={{ marginTop: 8 }}
            disabled={!!busy || !floor}
            onClick={async () => {
              const y = amount(floor);
              if (!y) return;
              const r = await send("Add to floor", { contractId: cert.contract_id, method: "add_to_floor", deposit: y, gas: "30000000000000" }, () => `Added ${floor} NEAR to the floor`);
              if (r) setFloor("");
            }}
          >
            Add to floor
          </button>
        </div>

        <hr className="rule" />

        <div>
          <div className="field-label">Spend from the treasury</div>
          <p className="small" style={{ margin: "4px 0 8px" }}>
            Treasury {near(treasury)} NEAR. You can spend {near(canSpend)} NEAR more this period.
          </p>
          <div className="form-stack" style={{ gap: 8 }}>
            <select className="select" value={recipient} onChange={(e) => setRecipient(e.target.value)} aria-label="Recipient">
              {cert.treasury_rule.recipients.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <div className="input-row">
              <input className="input num" inputMode="decimal" placeholder="0" value={spend} onChange={(e) => setSpend(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Amount" />
              <span className="input-suffix">NEAR</span>
            </div>
            <input className="input" maxLength={MAX_MEMO} placeholder="Public reason for this spend" value={memo} onChange={(e) => setMemo(e.target.value)} aria-label="Memo" />
            <button
              className="btn btn-sm"
              disabled={!!busy || !spend || !memo.trim() || !recipient || canSpend === 0n}
              onClick={async () => {
                const y = amount(spend);
                if (!y) return;
                if (BigInt(y) > canSpend) return setErr(`At most ${near(canSpend)} NEAR this period`);
                const r = await send(
                  "Treasury spend",
                  { contractId: cert.contract_id, method: "treasury_spend", args: { recipient, amount: y, memo: memo.trim() }, deposit: "1", gas: "30000000000000" },
                  () => `Sent ${spend} NEAR to ${recipient}`,
                );
                if (r) {
                  setSpend("");
                  setMemo("");
                }
              }}
            >
              Spend
            </button>
          </div>
        </div>
        {err && <div className="error-text">{err}</div>}
      </div>
    </section>
  );
}
