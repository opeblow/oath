import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CertificateCard } from "../components/CertificateCard";
import { ActivityFeed } from "../components/coin/ActivityFeed";
import { AskPanel } from "../components/coin/AskPanel";
import { AuditPanel } from "../components/coin/AuditPanel";
import { CreatorPanel } from "../components/coin/CreatorPanel";
import { OathList } from "../components/coin/OathList";
import { PositionPanel } from "../components/coin/PositionPanel";
import { TradePanel } from "../components/coin/TradePanel";
import { VerifyPanel } from "../components/coin/VerifyPanel";
import { explorerAccount } from "../lib/config";
import { near, percent, spotPrice, tokens } from "../lib/format";
import { certificateModel } from "../lib/model";
import { coin, RpcError } from "../lib/near";
import { trustSummary } from "../lib/oaths";
import { useAsync } from "../lib/useAsync";
import { useWallet } from "../lib/wallet";

type Tab = "oaths" | "activity" | "verify" | "audit" | "ask";
const TABS: { id: Tab; label: string }[] = [
  { id: "oaths", label: "Oaths" },
  { id: "activity", label: "Activity" },
  { id: "verify", label: "Verify" },
  { id: "audit", label: "Audit" },
  { id: "ask", label: "Ask the auditor" },
];

export default function Coin() {
  const { id = "" } = useParams();
  const [search] = useSearchParams();
  const justSworn = search.get("sworn") === "1";
  const [tab, setTab] = useState<Tab>("oaths");
  const { accountId } = useWallet();
  const cert = useAsync(() => coin.certificate(id), [id], 15_000);
  const holder = useAsync(() => (accountId ? coin.holder(id, accountId) : Promise.resolve(undefined)), [id, accountId, cert.data?.activity_count]);
  const c = cert.data;

  function refresh() {
    cert.reload();
    holder.reload();
  }

  if (cert.error && !c) {
    const missing = cert.error instanceof RpcError && /does not exist|UNKNOWN_ACCOUNT|MethodNotFound|CodeDoesNotExist/i.test(cert.error.message);
    return (
      <div className="wrap section-tight">
        <div className="empty">
          {missing ? (
            <>No OATH coin lives at <span className="mono">{id}</span>. <Link to="/coins">Browse the registry</Link>.</>
          ) : (
            <>The coin could not be read from NEAR right now. <button className="btn-link" onClick={cert.reload}>Try again</button></>
          )}
        </div>
      </div>
    );
  }
  if (!c) {
    return (
      <div className="wrap section-tight">
        <div className="skeleton" style={{ height: 420 }} />
      </div>
    );
  }

  const t = trustSummary(c);
  const isCreator = accountId === c.creator;

  return (
    <div className="wrap section-tight">
      {justSworn && (
        <div className="panel" role="status" style={{ marginBottom: 24, borderColor: "var(--ledger)", background: "var(--ledger-wash)" }}>
          <strong>Sworn.</strong> {c.name} is live and every oath below is now enforced by its contract. Share this page: buyers can verify everything themselves.
        </div>
      )}

      <div className="coin-grid">
        <div>
          <CertificateCard model={certificateModel(c)} stamp={justSworn} />

          <div className="facts" style={{ marginTop: 24 }}>
            <div className="fact"><div className="fact-label">Price</div><div className="fact-value num" style={{ fontSize: 22 }}>{spotPrice(c.curve.spot_price_scaled)}</div><div className="fact-sub">NEAR per {c.symbol}</div></div>
            <div className="fact"><div className="fact-label">Locked liquidity</div><div className="fact-value num" style={{ fontSize: 22 }}>{near(c.curve.real_near_reserve, 2)}</div><div className="fact-sub">NEAR, {near(c.curve.floor_added, 2)} from floor top-ups</div></div>
            <div className="fact"><div className="fact-label">Sold on curve</div><div className="fact-value num" style={{ fontSize: 22 }}>{percent(c.curve.tokens_sold, c.curve.curve_supply)}</div><div className="fact-sub">{tokens(c.curve.tokens_sold)} of {tokens(c.curve.curve_supply)}</div></div>
            <div className="fact"><div className="fact-label">Paid to holders</div><div className="fact-value num" style={{ fontSize: 22 }}>{near(c.payouts_distributed, 2)}</div><div className="fact-sub">NEAR from broken oaths</div></div>
          </div>

          {t.breakable > 0 && (
            <div className="panel" role="alert" style={{ marginTop: 24, borderColor: "var(--seal)", background: "var(--seal-wash)" }}>
              <strong>{t.breakable === 1 ? "A bonded oath is broken." : `${t.breakable} bonded oaths are broken.`}</strong> Anyone can enforce it below: 5% of the stake goes to you, 95% to holders.
            </div>
          )}

          <div className="tabs" role="tablist">
            {TABS.map((x) => (
              <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? "on" : ""} onClick={() => setTab(x.id)}>
                {x.label}
              </button>
            ))}
          </div>
          <div className="tab-body" role="tabpanel">
            {tab === "oaths" && <OathList cert={c} onChange={refresh} />}
            {tab === "activity" && <ActivityFeed cert={c} />}
            {tab === "verify" && <VerifyPanel cert={c} />}
            {tab === "audit" && <AuditPanel cert={c} />}
            {tab === "ask" && <AskPanel cert={c} />}
          </div>
        </div>

        <aside className="coin-side">
          <TradePanel cert={c} holder={holder.data} onChange={refresh} />
          <PositionPanel cert={c} holder={holder.data} onChange={refresh} />
          {isCreator && <CreatorPanel cert={c} onChange={refresh} />}
          <div className="small muted">
            Contract <a className="mono" href={explorerAccount(c.contract_id)} target="_blank" rel="noreferrer">{c.contract_id}</a>
            <br />
            Creator <a className="mono" href={explorerAccount(c.creator)} target="_blank" rel="noreferrer">{c.creator}</a>
          </div>
        </aside>
      </div>
    </div>
  );
}
