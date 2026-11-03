import type { CertificateModel } from "../components/CertificateCard";
import { dateLabel, near, percent } from "./format";
import { bondedOaths, sealedOaths } from "./oaths";
import type { Certificate } from "./types";

export function certificateModel(c: Certificate): CertificateModel {
  const oaths = [...sealedOaths(c), ...bondedOaths(c)];
  return {
    id: c.contract_id,
    name: c.name,
    symbol: c.symbol,
    manifesto: c.manifesto,
    creator: c.creator,
    icon: c.icon,
    sworn: dateLabel(c.launched_at_ns).split(",")[0],
    oathTitles: oaths.map((o) => o.title),
    facts: [
      { label: "Oaths", value: String(oaths.length), sub: `${c.bonded.length} bonded` },
      { label: "Bond at stake", value: `${near(c.bond_locked, 2)}`, sub: "NEAR" },
      { label: "Locked liquidity", value: `${near(c.curve.real_near_reserve, 2)}`, sub: "NEAR" },
      { label: "Sold", value: percent(c.curve.tokens_sold, c.curve.curve_supply), sub: `${c.holders} holders` },
    ],
  };
}
