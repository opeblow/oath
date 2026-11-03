import { near } from "../../lib/format";
import { bondedOaths, sealedOaths, type OathLine } from "../../lib/oaths";
import type { Certificate } from "../../lib/types";
import { useTx } from "../../lib/useTx";
import { useWallet } from "../../lib/wallet";

const STATUS_LABEL: Record<OathLine["status"], string> = {
  sealed: "Sealed",
  active: "In force",
  kept: "Kept",
  breakable: "Broken, enforce now",
  broken: "Broken",
};

export function OathList({ cert, onChange }: { cert: Certificate; onChange: () => void }) {
  const { accountId } = useWallet();
  const { send, busy } = useTx(onChange);
  const lines = [...sealedOaths(cert), ...bondedOaths(cert)];
  const isCreator = accountId === cert.creator;

  return (
    <ol className="oath-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {lines.map((o, i) => (
        <li className="oath" key={o.key}>
          <span className="oath-n">{i + 1}</span>
          <div>
            <h3>{o.title}</h3>
            <p>{o.plain}</p>
            <div className="oath-proof">{o.proof}</div>
          </div>
          <div className="oath-side">
            <span className={`pill pill-${o.status}`}>
              <span className="dot" />
              {STATUS_LABEL[o.status]}
            </span>
            {o.stake && <span className="small mono">{near(o.stake, 2)} NEAR staked</span>}
            {o.status === "breakable" && o.bonded && (
              <button
                className="btn btn-seal btn-sm"
                disabled={!!busy}
                onClick={() =>
                  send(
                    "Enforce oath",
                    { contractId: cert.contract_id, method: "enforce", args: { index: o.bonded!.index }, gas: "60000000000000" },
                    () => `Enforced. You earned ${near((BigInt(o.stake!) * 5n) / 100n, 3)} NEAR.`,
                  )
                }
              >
                {busy ? "Enforcing..." : `Enforce, earn ${near((BigInt(o.stake ?? "0") * 5n) / 100n, 3)} NEAR`}
              </button>
            )}
            {o.status === "kept" && o.bonded && !o.bonded.reclaimed && isCreator && (
              <button
                className="btn btn-ghost btn-sm"
                disabled={!!busy}
                onClick={() => send("Reclaim stake", { contractId: cert.contract_id, method: "reclaim_stake", args: { index: o.bonded!.index }, gas: "30000000000000" })}
              >
                Reclaim stake
              </button>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
