import { Band, Rosette } from "./Engraving";
import { Seal } from "./Seal";
import { serial } from "../lib/guilloche";
import "./certificate.css";

export interface CertificateModel {
  id: string;
  name: string;
  symbol: string;
  manifesto: string;
  creator: string;
  icon?: string | null;
  sworn?: string;
  facts: { label: string; value: string; sub?: string }[];
  oathTitles: string[];
}

export function CertificateCard({ model, stamp = true, compact = false }: { model: CertificateModel; stamp?: boolean; compact?: boolean }) {
  const seed = model.id || model.symbol || "oath";
  return (
    <article className={`cert ${compact ? "cert-compact" : ""}`} aria-label={`Certificate of oaths for ${model.name}`}>
      <div className="cert-inner">
        <Band seed={seed} />
        <header className="cert-head">
          <span className="eyebrow">Certificate of oaths</span>
          <span className="mono small muted">No. {serial(seed)}</span>
        </header>

        <div className="cert-body">
          <div className="cert-rosette" aria-hidden="true">
            <Rosette seed={seed} size={compact ? 240 : 320} spin />
          </div>
          <div className="cert-title">
            {model.icon ? <img className="cert-icon" src={model.icon} alt="" width={44} height={44} /> : null}
            <h2 className="cert-name">{model.name || "Unnamed coin"}</h2>
            <div className="cert-symbol mono">${model.symbol || "SYMBOL"}</div>
            {model.manifesto && <p className="cert-manifesto">{model.manifesto}</p>}
          </div>
          <div className="cert-seal">
            <Seal size={compact ? 96 : 124} mark={(model.symbol || "OATH").slice(0, 8)} stamp={stamp} />
          </div>
        </div>

        {model.oathTitles.length > 0 && (
          <ol className="cert-oaths">
            {model.oathTitles.slice(0, compact ? 4 : 8).map((t, i) => (
              <li key={i}>
                <span className="cert-oath-n mono">{String(i + 1).padStart(2, "0")}</span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
        )}

        <dl className="cert-facts">
          {model.facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd className="num">{f.value}</dd>
              {f.sub && <dd className="cert-fact-sub">{f.sub}</dd>}
            </div>
          ))}
        </dl>

        <footer className="cert-foot">
          <div className="cert-sign">
            <span className="cert-sign-line mono">{model.creator || "creator.near"}</span>
            <span className="eyebrow">Sworn by the creator{model.sworn ? `, ${model.sworn}` : ""}</span>
          </div>
          <div className="cert-sign cert-sign-right">
            <span className="cert-sign-line mono">{model.id || "pending.oathcoin.testnet"}</span>
            <span className="eyebrow">Enforced by contract</span>
          </div>
        </footer>
        <Band seed={seed + "b"} />
      </div>
    </article>
  );
}
