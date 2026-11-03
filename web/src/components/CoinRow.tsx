import { Link } from "react-router-dom";
import { near, percent, relative, shortAccount } from "../lib/format";
import { coin } from "../lib/near";
import { trustSummary } from "../lib/oaths";
import type { CoinEntry } from "../lib/types";
import { useAsync } from "../lib/useAsync";
import { Rosette } from "./Engraving";

export function CoinRow({ entry }: { entry: CoinEntry }) {
  const cert = useAsync(() => coin.certificate(entry.coin_id), [entry.coin_id]);
  const c = cert.data;
  const t = c ? trustSummary(c) : null;
  return (
    <Link to={`/coin/${entry.coin_id}`} className="coin-row">
      <div className="coin-row-mark" aria-hidden="true">
        <Rosette seed={entry.coin_id} size={52} lines={8} opacity={0.8} />
        <span className="coin-row-sym mono">{entry.symbol.slice(0, 4)}</span>
      </div>
      <div className="coin-row-name">
        <div className="coin-row-title">{entry.name}</div>
        <div className="small muted mono">${entry.symbol} - {shortAccount(entry.creator, 24)}</div>
      </div>
      <div className="coin-row-stat">
        <div className="fact-label">Oaths</div>
        <div className="num">{t ? `${t.sealed + t.bonded}` : "-"}</div>
      </div>
      <div className="coin-row-stat">
        <div className="fact-label">Status</div>
        <div>
          {!t ? (
            "-"
          ) : t.broken > 0 ? (
            <span className="pill pill-broken"><span className="dot" />{t.broken} broken</span>
          ) : t.breakable > 0 ? (
            <span className="pill pill-breakable"><span className="dot" />Enforceable</span>
          ) : t.bonded > 0 && t.kept === t.bonded ? (
            <span className="pill pill-kept"><span className="dot" />Kept</span>
          ) : t.bonded > 0 ? (
            <span className="pill pill-active"><span className="dot" />In force</span>
          ) : (
            <span className="pill pill-sealed"><span className="dot" />Sealed</span>
          )}
        </div>
      </div>
      <div className="coin-row-stat hide-sm">
        <div className="fact-label">At stake</div>
        <div className="num">{c ? `${near(c.bond_locked, 2)} NEAR` : "-"}</div>
      </div>
      <div className="coin-row-stat hide-sm">
        <div className="fact-label">Liquidity</div>
        <div className="num">{c ? `${near(c.curve.real_near_reserve, 2)} NEAR` : "-"}</div>
      </div>
      <div className="coin-row-stat hide-sm">
        <div className="fact-label">Sold</div>
        <div className="num">{c ? percent(c.curve.tokens_sold, c.curve.curve_supply) : "-"}</div>
      </div>
      <div className="coin-row-stat hide-sm">
        <div className="fact-label">Sworn</div>
        <div className="small">{relative(entry.created_at_ns)}</div>
      </div>
    </Link>
  );
}
