import { config, explorerAccount } from "../../lib/config";
import { near } from "../../lib/format";
import { verifyCoin } from "../../lib/near";
import type { Certificate } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";

function Row({ ok, title, detail }: { ok: boolean | null; title: string; detail: React.ReactNode }) {
  return (
    <li>
      <span className={ok === null ? "verify-wait" : ok ? "verify-ok" : "verify-bad"} aria-label={ok === null ? "checking" : ok ? "pass" : "fail"}>
        {ok === null ? "..." : ok ? "Yes" : "No"}
      </span>
      <div>
        <strong>{title}</strong>
        <div className="small muted">{detail}</div>
      </div>
    </li>
  );
}

export function VerifyPanel({ cert }: { cert: Certificate }) {
  const v = useAsync(() => verifyCoin(cert.contract_id, cert.accounting.solvent), [cert.contract_id, cert.accounting.solvent]);
  const d = v.data;
  const a = cert.accounting;
  return (
    <div>
      <ul className="verify-list">
        <Row
          ok={d ? d.accessKeys === 0 : null}
          title="No access keys"
          detail={d ? `${d.accessKeys ?? "unknown"} keys on ${cert.contract_id}. Nobody can redeploy the code or move funds by hand.` : "Reading the account..."}
        />
        <Row
          ok={d ? d.codeMatches : null}
          title="Runs the published OATH code"
          detail={
            d ? (
              <>
                Global contract <span className="mono">{(d.globalHash ?? "none").slice(0, 16)}...</span> {d.codeMatches ? "matches" : "does not match"} the published hash.
              </>
            ) : (
              "Comparing code hashes..."
            )
          }
        />
        <Row
          ok={d ? d.registered && cert.factory_id === config.factoryId : null}
          title="Created by the OATH factory"
          detail={d ? `Listed in ${config.factoryId}.` : "Checking the registry..."}
        />
        <Row
          ok={a.solvent}
          title="Fully backed"
          detail={`Balance ${near(a.contract_balance, 3)} NEAR covers liquidity ${near(a.real_near_reserve, 3)} + treasury ${near(a.treasury, 3)} + bond ${near(
            a.bond_locked,
            3,
          )} + unclaimed ${near(a.unclaimed_payouts, 3)} + storage ${near(a.storage_cost, 3)}.`}
        />
      </ul>
      <p className="small muted" style={{ marginTop: 12 }}>
        Checked directly against NEAR {config.network} RPC{d ? ` at ${new Date(d.checkedAt).toLocaleTimeString()}` : ""}.{" "}
        <a href={explorerAccount(cert.contract_id)} target="_blank" rel="noreferrer">Open in explorer</a>
      </p>
    </div>
  );
}
