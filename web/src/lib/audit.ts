// Deterministic risk audit of a coin, computed only from its on-chain certificate.
// The same rules run in the OutLayer auditor, so a browser result and a verifiable
// off-chain result can be compared line by line.

import { bpsToPct, duration, near, percent } from "./format.js";
import type { Certificate } from "./types";

export type Severity = "ok" | "note" | "warn" | "risk";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}

export interface AuditResult {
  findings: Finding[];
  counts: Record<Severity, number>;
  grade: "A" | "B" | "C" | "D";
}

const NS = 1_000_000_000n;
const DAY = 86_400;
const YOCTO = 10n ** 24n;

export const AUDIT_VERSION = "oath-audit/1";

export function audit(c: Certificate): AuditResult {
  const f: Finding[] = [];
  const now = BigInt(c.now_ns);
  const launched = BigInt(c.launched_at_ns);
  const secs = (ns: string) => Number((BigInt(ns) - launched) / NS);

  // Solvency
  f.push(
    c.accounting.solvent
      ? { id: "solvent", severity: "ok", title: "Fully backed", detail: "The contract balance covers liquidity, treasury, bond, payouts and storage." }
      : { id: "solvent", severity: "risk", title: "Not fully backed", detail: "The contract balance is below its liabilities. This should be impossible; report it." },
  );

  // Creator allocation and vesting
  const alloc = BigInt(c.creator_alloc);
  if (alloc === 0n) {
    f.push({ id: "alloc", severity: "ok", title: "No creator allocation", detail: "Every token was sold through the curve." });
  } else {
    const share = Number((alloc * 10_000n) / BigInt(c.total_supply));
    const cliff = secs(c.vest_cliff_ns);
    const end = secs(c.vest_end_ns);
    f.push({
      id: "alloc",
      severity: share > 500 ? "note" : "ok",
      title: `Creator holds ${percent(alloc, c.total_supply)} of supply`,
      detail: share > 500 ? "Above 5%. Vesting limits how fast it can be sold." : "A small allocation.",
    });
    f.push({
      id: "vesting",
      severity: cliff < 30 * DAY || end < 90 * DAY ? "warn" : "ok",
      title: `Vesting: ${duration(cliff)} cliff, fully unlocked after ${duration(end)}`,
      detail:
        cliff < 30 * DAY || end < 90 * DAY
          ? "Short. The creator can start selling soon after launch."
          : "The creator cannot sell early.",
    });
  }

  // Launch window and wallet cap
  const window = secs(c.launch_window_end_ns);
  f.push({
    id: "maxwallet",
    severity: c.max_wallet_bps > 300 ? "warn" : window < 3_600 ? "note" : "ok",
    title: `Max ${bpsToPct(c.max_wallet_bps)} per wallet for ${duration(window)}`,
    detail:
      c.max_wallet_bps > 300
        ? "A loose cap. A few wallets can take a large share at launch."
        : window < 3_600
          ? "A short window. Snipers only wait it out briefly."
          : "Limits early accumulation.",
  });

  // Fee
  f.push({
    id: "fee",
    severity: c.fee_bps > 100 ? "note" : "ok",
    title: `Trading fee ${bpsToPct(c.fee_bps)}`,
    detail: c.fee_bps > 100 ? "Above 1%. It funds the treasury, which the creator controls within its rules." : "Fixed forever.",
  });

  // Treasury
  const t = c.treasury_rule;
  const selfPay = t.recipients.includes(c.creator);
  f.push({
    id: "treasury",
    severity: selfPay ? "warn" : "ok",
    title: `Treasury: ${near(t.max_per_period, 2)} NEAR per ${duration(t.period_secs)} to ${t.recipients.length} account(s)`,
    detail: selfPay ? "The creator's own account is a declared recipient, so fees can be paid to the creator." : "Only declared accounts, with a public memo for each spend.",
  });

  // Bonded promises
  if (c.bonded.length === 0) {
    f.push({ id: "bond", severity: "warn", title: "No bonded oaths", detail: "The creator staked nothing on future behaviour. Only the sealed rules apply." });
  } else {
    const total = BigInt(c.bond_total);
    f.push({
      id: "bond",
      severity: total < YOCTO ? "note" : "ok",
      title: `${c.bonded.length} bonded oath(s), ${near(total, 2)} NEAR staked`,
      detail: total < YOCTO ? "Under 1 NEAR. Breaking a promise is cheap." : "Breaking a promise pays holders.",
    });
  }
  for (const b of c.bonded) {
    const n = b.index + 1;
    if (b.status === "breakable") {
      f.push({ id: `oath-${n}`, severity: "risk", title: `Bonded oath ${n} is broken`, detail: "Anyone can enforce it now and the stake goes to holders." });
    } else if (b.status === "broken") {
      f.push({ id: `oath-${n}`, severity: "risk", title: `Bonded oath ${n} was broken`, detail: `Enforced${b.enforced_by ? ` by ${b.enforced_by}` : ""}. The creator did not keep this promise.` });
    } else if (b.status === "active" && b.next_due_ns && BigInt(b.next_due_ns) - now < BigInt(DAY) * NS) {
      f.push({ id: `oath-${n}`, severity: "note", title: `Bonded oath ${n} is due within a day`, detail: "Watch whether the creator posts an update in time." });
    }
  }

  const counts: Record<Severity, number> = { ok: 0, note: 0, warn: 0, risk: 0 };
  for (const x of f) counts[x.severity]++;
  const grade = counts.risk > 0 ? "D" : counts.warn > 1 ? "C" : counts.warn === 1 ? "B" : "A";
  return { findings: f, counts, grade };
}
