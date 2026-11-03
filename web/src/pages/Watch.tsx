import { Link } from "react-router-dom";
import { dateLabel, near, relative } from "../lib/format";
import { coin, factory } from "../lib/near";
import { bondedLine } from "../lib/oaths";
import type { BondedOathView, Certificate } from "../lib/types";
import { useAsync } from "../lib/useAsync";
import { useTx } from "../lib/useTx";
import { useWallet } from "../lib/wallet";

interface Watched {
  cert: Certificate;
  oath: BondedOathView;
  deadline: bigint;
}

const PAGE = 50;

async function scan(): Promise<{ broken: Watched[]; upcoming: Watched[]; scanned: number }> {
  const total = await factory.count();
  const entries = [];
  for (let from = 0; from < total; from += PAGE) entries.push(...(await factory.coins(from, PAGE)));
  const certs: Certificate[] = [];
  for (let i = 0; i < entries.length; i += 8) {
    const batch = await Promise.all(entries.slice(i, i + 8).map((e) => coin.certificate(e.coin_id).catch(() => null)));
    certs.push(...batch.filter((c): c is Certificate => !!c));
  }
  const broken: Watched[] = [];
  const upcoming: Watched[] = [];
  for (const cert of certs) {
    for (const oath of cert.bonded) {
      const deadline = BigInt(oath.kind === "heartbeat" ? (oath.next_due_ns ?? oath.ends_at_ns) : oath.ends_at_ns);
      if (oath.status === "breakable") broken.push({ cert, oath, deadline });
      else if (oath.status === "active") upcoming.push({ cert, oath, deadline });
    }
  }
  broken.sort((a, b) => (BigInt(b.oath.stake) > BigInt(a.oath.stake) ? 1 : -1));
  upcoming.sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
  return { broken, upcoming, scanned: certs.length };
}

const bounty = (stake: string) => (BigInt(stake) * 5n) / 100n;

export default function Watch() {
  const data = useAsync(scan, [], 30_000);
  const { accountId, connect } = useWallet();
  const { send, busy } = useTx(data.reload);
  const d = data.data;
  const totalBounty = (d?.broken ?? []).reduce((a, w) => a + bounty(w.oath.stake), 0n);

  return (
    <div className="wrap">
      <header className="page-head">
        <div className="eyebrow">Watch and earn</div>
        <h1>Catch a broken promise. Get paid.</h1>
        <p className="lede">
          When a creator misses a bonded oath, anyone can enforce it. The enforcer earns 5% of the stake and the other 95% is paid to holders. No
          committee decides: the contract checks the deadline itself.
        </p>
      </header>

      {data.error && !d ? (
        <div className="empty">Could not scan the registry. <button className="btn-link" onClick={data.reload}>Try again</button></div>
      ) : !d ? (
        <div className="skeleton" style={{ height: 260 }} />
      ) : (
        <>
          <div className="facts" style={{ marginBottom: 40 }}>
            <div className="fact"><div className="fact-label">Coins scanned</div><div className="fact-value num">{d.scanned}</div></div>
            <div className="fact"><div className="fact-label">Enforceable now</div><div className="fact-value num">{d.broken.length}</div></div>
            <div className="fact"><div className="fact-label">Bounty available</div><div className="fact-value num">{near(totalBounty, 3)}</div><div className="fact-sub">NEAR</div></div>
            <div className="fact"><div className="fact-label">Oaths in force</div><div className="fact-value num">{d.upcoming.length}</div></div>
          </div>

          <section style={{ marginBottom: 48 }}>
            <h2 style={{ fontSize: 32, marginBottom: 14 }}>Enforceable now</h2>
            {d.broken.length === 0 ? (
              <div className="empty">Every creator is keeping their word right now. Check the deadlines below.</div>
            ) : (
              <table className="ledger">
                <thead>
                  <tr><th>Coin</th><th>Oath</th><th className="r">Stake</th><th className="r">You earn</th><th /></tr>
                </thead>
                <tbody>
                  {d.broken.map(({ cert, oath }) => (
                    <tr key={`${cert.contract_id}-${oath.index}`}>
                      <td><Link to={`/coin/${cert.contract_id}`}>{cert.name}</Link><div className="small muted mono">${cert.symbol}</div></td>
                      <td>{bondedLine(oath, cert.symbol).title}<div className="small muted">Missed {dateLabel(oath.kind === "heartbeat" ? (oath.next_due_ns ?? oath.ends_at_ns) : oath.ends_at_ns)}</div></td>
                      <td className="r num">{near(oath.stake, 2)} NEAR</td>
                      <td className="r num">{near(bounty(oath.stake), 3)} NEAR</td>
                      <td className="r">
                        <button
                          className="btn btn-seal btn-sm"
                          disabled={!!busy}
                          onClick={() =>
                            accountId
                              ? send("Enforce oath", { contractId: cert.contract_id, method: "enforce", args: { index: oath.index }, gas: "60000000000000" }, () => `Enforced. You earned ${near(bounty(oath.stake), 3)} NEAR.`)
                              : connect()
                          }
                        >
                          {accountId ? "Enforce" : "Connect"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <h2 style={{ fontSize: 32, marginBottom: 14 }}>Next deadlines</h2>
            {d.upcoming.length === 0 ? (
              <div className="empty">No bonded oaths are in force. <Link to="/launch">Launch a coin with one</Link>.</div>
            ) : (
              <table className="ledger">
                <thead>
                  <tr><th>Coin</th><th>Oath</th><th>Deadline</th><th className="r">Stake</th></tr>
                </thead>
                <tbody>
                  {d.upcoming.slice(0, 50).map(({ cert, oath, deadline }) => (
                    <tr key={`${cert.contract_id}-${oath.index}`}>
                      <td><Link to={`/coin/${cert.contract_id}`}>{cert.name}</Link><div className="small muted mono">${cert.symbol}</div></td>
                      <td>{bondedLine(oath, cert.symbol).title}</td>
                      <td>{relative(deadline.toString())}<div className="small muted">{dateLabel(deadline.toString())}</div></td>
                      <td className="r num">{near(oath.stake, 2)} NEAR</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <p className="small muted" style={{ marginTop: 20 }}>Read live from {d.scanned} coin contracts. Refreshes every 30 seconds.</p>
        </>
      )}
    </div>
  );
}
