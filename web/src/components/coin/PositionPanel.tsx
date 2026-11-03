import { near, percent, tokens } from "../../lib/format";
import { coin } from "../../lib/near";
import type { Certificate, HolderView } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";
import { useTx } from "../../lib/useTx";
import { useWallet } from "../../lib/wallet";

/** The connected account's balance, sale value and unclaimed payouts. */
export function PositionPanel({ cert, holder, onChange }: { cert: Certificate; holder: HolderView | undefined; onChange: () => void }) {
  const { accountId, connect } = useWallet();
  const { send, busy } = useTx(onChange);
  const balance = holder ? BigInt(holder.balance) : 0n;
  const locked = holder ? BigInt(holder.locked) : 0n;
  const sellable = balance > locked ? balance - locked : 0n;
  const claimable = holder ? BigInt(holder.claimable) : 0n;

  const value = useAsync(
    async () => (sellable > 0n ? (await coin.quoteSell(cert.contract_id, sellable.toString())).near_out : "0"),
    [cert.contract_id, sellable.toString(), cert.curve.real_near_reserve],
  );

  if (!accountId) {
    return (
      <section className="panel" aria-label="Your position">
        <div className="panel-title"><h3>Your position</h3></div>
        <p className="small muted" style={{ marginTop: 0 }}>Connect a wallet to see your balance and any payouts from enforced oaths.</p>
        <button className="btn btn-ghost btn-sm" onClick={() => connect()}>Connect wallet</button>
      </section>
    );
  }

  return (
    <section className="panel" aria-label="Your position">
      <div className="panel-title">
        <h3>Your position</h3>
        {holder && balance > 0n && <span className="small muted">{percent(balance, cert.total_supply, 2)} of supply</span>}
      </div>
      {!holder ? (
        <div className="skeleton" style={{ height: 90 }} />
      ) : (
        <>
          <table className="ledger">
            <tbody>
              <tr><td>Balance</td><td className="r num">{tokens(balance)} {cert.symbol}</td></tr>
              {locked > 0n && <tr><td>Still vesting</td><td className="r num">{tokens(locked)} {cert.symbol}</td></tr>}
              <tr><td>Sells for now</td><td className="r num">{value.data ? `${near(value.data)} NEAR` : "-"}</td></tr>
              <tr><td>Unclaimed payouts</td><td className="r num">{near(claimable)} NEAR</td></tr>
            </tbody>
          </table>
          {claimable > 0n ? (
            <button
              className="btn btn-seal"
              style={{ width: "100%", marginTop: 14 }}
              disabled={!!busy}
              onClick={() => send("Claim", { contractId: cert.contract_id, method: "claim", gas: "30000000000000" }, (r) => `Claimed ${near(String(r.value ?? claimable))} NEAR`)}
            >
              {busy ? "Confirm in wallet..." : `Claim ${near(claimable)} NEAR`}
            </button>
          ) : (
            <p className="small muted" style={{ margin: "12px 0 0" }}>
              When a bonded oath is enforced, 95% of its stake is split across holders by balance. Your share appears here.
            </p>
          )}
        </>
      )}
    </section>
  );
}
