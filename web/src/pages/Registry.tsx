import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CoinRow } from "../components/CoinRow";
import { factory } from "../lib/near";
import type { CoinEntry } from "../lib/types";
import { useAsync } from "../lib/useAsync";

const PAGE = 50;

export default function Registry() {
  const [pages, setPages] = useState(1);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"new" | "bond">("new");
  const list = useAsync(
    async () => {
      const total = await factory.count();
      const chunks: CoinEntry[][] = [];
      for (let p = 0; p < pages; p++) chunks.push(await factory.coins(p * PAGE, PAGE));
      return { total, coins: chunks.flat() };
    },
    [pages],
    30_000,
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let coins = list.data?.coins ?? [];
    if (q) coins = coins.filter((c) => [c.name, c.symbol, c.coin_id, c.creator].some((v) => v.toLowerCase().includes(q)));
    if (sort === "bond") coins = [...coins].sort((a, b) => (BigInt(b.bond) > BigInt(a.bond) ? 1 : -1));
    return coins;
  }, [list.data, query, sort]);

  return (
    <div className="wrap">
      <header className="page-head">
        <div className="eyebrow">The registry</div>
        <h1>Every coin, every oath.</h1>
        <p className="lede">Each row is read live from the OATH factory on NEAR. Status shows whether any bonded promise is broken right now.</p>
      </header>

      <div className="toolbar">
        <label className="field" style={{ minWidth: 280, flex: "1 1 280px", maxWidth: 420 }}>
          <span className="sr-only">Search coins</span>
          <input className="input" placeholder="Search by name, symbol or creator" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="segmented" role="group" aria-label="Sort">
          <button className={sort === "new" ? "on" : ""} onClick={() => setSort("new")}>Newest</button>
          <button className={sort === "bond" ? "on" : ""} onClick={() => setSort("bond")}>Largest bond</button>
        </div>
      </div>

      {list.error && !list.data ? (
        <div className="empty">
          The registry could not be read. <button className="btn-link" onClick={list.reload}>Try again</button>
        </div>
      ) : !list.data ? (
        <div className="coin-list">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton" style={{ height: 70, marginTop: 8 }} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">
          {query ? "No coin matches that search." : "No coins have been sworn yet."} <Link to="/launch">Launch one</Link>.
        </div>
      ) : (
        <>
          <div className="small muted" style={{ marginBottom: 8 }}>
            Showing {shown.length} of {list.data.total} coins
          </div>
          <div className="coin-list">
            {shown.map((c) => (
              <CoinRow key={c.coin_id} entry={c} />
            ))}
          </div>
          {list.data.coins.length < list.data.total && (
            <div style={{ textAlign: "center", marginTop: 24 }}>
              <button className="btn btn-ghost" onClick={() => setPages((p) => p + 1)}>Load more</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
