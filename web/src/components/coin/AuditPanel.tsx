import { AUDIT_VERSION, audit, type Severity } from "../../lib/audit";
import type { Certificate } from "../../lib/types";

const MARK: Record<Severity, { label: string; cls: string }> = {
  ok: { label: "Pass", cls: "verify-ok" },
  note: { label: "Note", cls: "verify-wait" },
  warn: { label: "Warn", cls: "verify-wait" },
  risk: { label: "Risk", cls: "verify-bad" },
};

export function AuditPanel({ cert }: { cert: Certificate }) {
  const r = audit(cert);
  return (
    <div>
      <div className="facts" style={{ marginBottom: 20 }}>
        <div className="fact"><div className="fact-label">Grade</div><div className="fact-value">{r.grade}</div></div>
        <div className="fact"><div className="fact-label">Pass</div><div className="fact-value num">{r.counts.ok}</div></div>
        <div className="fact"><div className="fact-label">Notes</div><div className="fact-value num">{r.counts.note}</div></div>
        <div className="fact"><div className="fact-label">Warnings</div><div className="fact-value num">{r.counts.warn}</div></div>
        <div className="fact"><div className="fact-label">Risks</div><div className="fact-value num">{r.counts.risk}</div></div>
      </div>
      <ul className="verify-list">
        {r.findings.map((x) => (
          <li key={x.id}>
            <span className={MARK[x.severity].cls}>{MARK[x.severity].label}</span>
            <div>
              <strong>{x.title}</strong>
              <div className="small muted">{x.detail}</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="small muted" style={{ marginTop: 12 }}>
        Rules {AUDIT_VERSION}, computed in your browser from the live certificate. Grade A means no warnings; any broken oath is a D.
      </p>
    </div>
  );
}
