import { useState } from "react";
import { explorerAccount } from "../../lib/config";
import { near, relative, shortAccount, tokens } from "../../lib/format";
import { coin } from "../../lib/near";
import type { Activity, Certificate } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";

const PAGE = 30;

const LABEL: Record<string, string> = {
  launch: "Sworn",
  buy: "Buy",
  sell: "Sell",
  floor: "Floor",
  heartbeat: "Update",
  treasury: "Treasury",
  reclaim: "Reclaim",
  enforce: "Enforce",
  claim: "Claim",
};

function describe(a: Activity, symbol: string): string {
  switch (a.kind) {
    case "launch":
      return `Launched with ${near(a.near, 2)} NEAR bonded`;
    case "buy":
      return `Bought ${tokens(a.tokens)} ${symbol} for ${near(a.near, 3)} NEAR`;
    case "sell":
      return `Sold ${tokens(a.tokens)} ${symbol} for ${near(a.near, 3)} NEAR`;
    case "floor":
      return `Added ${near(a.near, 3)} NEAR to the floor`;
    case "heartbeat":
      return a.memo ?? "Posted an update";
    case "treasury":
      return `Received ${near(a.near, 3)} NEAR from the treasury${a.memo ? `: ${a.memo}` : ""}`;
    case "reclaim":
      return `Reclaimed ${near(a.near, 3)} NEAR stake from a kept oath`;
    case "enforce":
      return `Enforced ${a.memo ?? "an oath"}; ${near(a.near, 3)} NEAR stake released`;
    case "claim":
      return `Claimed ${near(a.near, 3)} NEAR in payouts`;
    default:
      return a.memo ?? a.kind;
  }
}

/** The coin's on-chain activity log, newest first. The contract keeps the latest 64 entries. */
export function ActivityFeed({ cert }: { cert: Certificate }) {
  const [pages, setPages] = useState(1);
  const feed = useAsync(
    async () => {
      const out: Activity[] = [];
      for (let p = 0; p < pages; p++) out.push(...(await coin.activity(cert.contract_id, p * PAGE, PAGE)));
      return out;
    },
    [cert.contract_id, pages, cert.activity_count],
  );
  const items = feed.data ?? [];
  const total = Number(cert.activity_count);
  const stored = Math.min(total, 64);

  if (feed.error && !feed.data) {
    return <div className="empty">The activity log could not be read. <button className="btn-link" onClick={feed.reload}>Try again</button></div>;
  }
  if (!feed.data) return <div className="skeleton" style={{ height: 200 }} />;
  if (items.length === 0) return <div className="empty">Nothing has happened yet.</div>;

  return (
    <>
      <ul className="activity">
        {items.map((a) => (
          <li key={a.seq}>
            <span className={`activity-kind k-${a.kind}`}>{LABEL[a.kind] ?? a.kind}</span>
            <div>
              <div style={a.kind === "heartbeat" ? { fontFamily: "var(--serif)" } : undefined}>{describe(a, cert.symbol)}</div>
              <a className="small mono muted" href={explorerAccount(a.account)} target="_blank" rel="noreferrer">{shortAccount(a.account, 28)}</a>
            </div>
            <span className="small muted" title={new Date(Number(BigInt(a.at_ns) / 1_000_000n)).toLocaleString()}>{relative(a.at_ns)}</span>
          </li>
        ))}
      </ul>
      <div className="small muted" style={{ marginTop: 12, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span>{total} events in total. The contract keeps the latest {stored} on chain; older ones are in the transaction history.</span>
        {items.length < stored && (
          <button className="btn-link small" onClick={() => setPages((p) => p + 1)}>Show older</button>
        )}
      </div>
    </>
  );
}
