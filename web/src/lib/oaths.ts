import { bpsToPct, dateLabel, duration, near, percent, tokens } from "./format";
import type { BondedOathView, Certificate, LaunchParams, OathStatus } from "./types";

export type OathKind = "sealed" | "bonded";

export interface OathLine {
  key: string;
  kind: OathKind;
  title: string;
  /** One sentence a buyer can understand. */
  plain: string;
  /** How the guarantee is enforced or proven. */
  proof: string;
  status: OathStatus | "sealed";
  stake?: string;
  bonded?: BondedOathView;
}

const NS = 1_000_000_000n;

export function sealedOaths(c: Certificate): OathLine[] {
  const now = BigInt(c.now_ns);
  const windowOpen = now < BigInt(c.launch_window_end_ns);
  const lines: OathLine[] = [
    {
      key: "liquidity",
      kind: "sealed",
      title: "Liquidity is locked",
      plain: `${near(c.curve.real_near_reserve)} NEAR sits in the bonding curve. No function can withdraw it; it only leaves when holders sell.`,
      proof: "The contract has no withdraw method and the coin account has no access keys.",
      status: "sealed",
    },
  ];
  if (BigInt(c.creator_alloc) > 0n) {
    const locked = BigInt(c.creator_locked_now);
    lines.push({
      key: "vesting",
      kind: "sealed",
      title: "Creator tokens vest",
      plain: `The creator holds ${tokens(c.creator_alloc)} ${c.symbol} (${percent(c.creator_alloc, c.total_supply)} of supply). ${
        locked > 0n ? `${tokens(locked)} are still locked.` : "All of it is now unlocked."
      } Nothing unlocks before ${dateLabel(c.vest_cliff_ns)}; the rest unlocks evenly until ${dateLabel(c.vest_end_ns)}.`,
      proof: "Any transfer or sell that would take the creator below the locked amount fails.",
      status: "sealed",
    });
  } else {
    lines.push({
      key: "vesting",
      kind: "sealed",
      title: "No creator allocation",
      plain: "The creator received no tokens at launch. Every token came from the curve.",
      proof: "The launch minted the full supply to the bonding curve.",
      status: "sealed",
    });
  }
  lines.push({
    key: "maxwallet",
    kind: "sealed",
    title: "Snipers are capped",
    plain: `${windowOpen ? "Until" : "Until"} ${dateLabel(c.launch_window_end_ns)} no wallet can hold more than ${bpsToPct(c.max_wallet_bps)} of supply, and the creator cannot buy at all.${
      windowOpen ? "" : " The launch window has closed."
    }`,
    proof: "Buys and transfers that break the cap fail. Splitting across wallets is still possible; this is a speed bump, not identity.",
    status: "sealed",
  });
  lines.push({
    key: "fee",
    kind: "sealed",
    title: "The fee is fixed",
    plain: `Every buy and sell pays ${bpsToPct(c.fee_bps)} into the treasury. It can never change.`,
    proof: "Set at launch, capped at 2% by the code.",
    status: "sealed",
  });
  const t = c.treasury_rule;
  lines.push({
    key: "treasury",
    kind: "sealed",
    title: "The treasury has rules",
    plain: `The creator can spend at most ${near(t.max_per_period)} NEAR every ${duration(t.period_secs)}, only to ${
      t.recipients.length === 1 ? t.recipients[0] : `${t.recipients.length} declared accounts`
    }, with a public note each time. Treasury now: ${near(c.accounting.treasury)} NEAR.`,
    proof: "Spends to undeclared accounts or over the limit fail.",
    status: "sealed",
  });
  return lines;
}

export function bondedOaths(c: Certificate): OathLine[] {
  return c.bonded.map((b) => bondedLine(b, c.symbol));
}

export function bondedLine(b: BondedOathView, _symbol: string): OathLine {
  if (b.kind === "heartbeat") {
    const every = duration(b.every_secs ?? 0);
    return {
      key: `bonded-${b.index}`,
      kind: "bonded",
      title: `Show up every ${every}`,
      plain: `The creator posts a public update at least every ${every} until ${dateLabel(b.ends_at_ns)}.`,
      proof:
        b.status === "active" && b.next_due_ns
          ? `Next update due ${dateLabel(b.next_due_ns)}. Missing it lets anyone enforce this oath.`
          : statusProof(b),
      status: b.status,
      stake: b.stake,
      bonded: b,
    };
  }
  return {
    key: `bonded-${b.index}`,
    kind: "bonded",
    title: `Add ${near(b.amount ?? "0")} NEAR to the floor`,
    plain: `The creator adds ${near(b.amount ?? "0")} NEAR to the liquidity floor by ${dateLabel(b.ends_at_ns)}, raising the price every holder can sell at.`,
    proof:
      b.status === "active"
        ? `${near(b.deposited ?? "0")} of ${near(b.amount ?? "0")} NEAR added so far.`
        : statusProof(b),
    status: b.status,
    stake: b.stake,
    bonded: b,
  };
}

function statusProof(b: BondedOathView): string {
  switch (b.status) {
    case "breakable":
      return "Broken. Anyone can enforce it now: 5% of the stake to the enforcer, 95% to holders.";
    case "broken":
      return `Enforced${b.enforced_by ? ` by ${b.enforced_by}` : ""}. The stake was paid out to holders.`;
    case "kept":
      return b.reclaimed ? "Kept. The stake was returned to the creator." : "Kept. The creator can reclaim the stake.";
    default:
      return "";
  }
}

/** Oaths for the launch preview, before anything is on chain. */
export function previewOaths(p: LaunchParams): OathLine[] {
  const supply = BigInt(p.total_supply_whole) * 10n ** 18n;
  const alloc = (supply * BigInt(p.creator_alloc_bps)) / 10_000n;
  const lines: OathLine[] = [
    { key: "liquidity", kind: "sealed", title: "Liquidity is locked", plain: "NEAR paid into the curve can only leave when holders sell.", proof: "No withdraw method. No access keys.", status: "sealed" },
    alloc > 0n
      ? {
          key: "vesting",
          kind: "sealed",
          title: "Creator tokens vest",
          plain: `${tokens(alloc)} ${p.symbol || "tokens"} for the creator: locked for ${duration(p.vest_cliff_secs)}, then unlocking over ${duration(p.vest_duration_secs)}.`,
          proof: "Transfers below the locked amount fail.",
          status: "sealed",
        }
      : { key: "vesting", kind: "sealed", title: "No creator allocation", plain: "Every token comes from the curve.", proof: "Full supply minted to the curve.", status: "sealed" },
    { key: "maxwallet", kind: "sealed", title: "Snipers are capped", plain: `Max ${bpsToPct(p.max_wallet_bps)} per wallet for the first ${duration(p.launch_window_secs)}; the creator cannot buy.`, proof: "Enforced on buys and transfers.", status: "sealed" },
    { key: "fee", kind: "sealed", title: "The fee is fixed", plain: `${bpsToPct(p.fee_bps)} per trade, forever.`, proof: "Capped at 2% by the code.", status: "sealed" },
    {
      key: "treasury",
      kind: "sealed",
      title: "The treasury has rules",
      plain: `At most ${safeNear(p.treasury.max_per_period)} NEAR per ${duration(p.treasury.period_secs)}, only to ${p.treasury.recipients.filter(Boolean).length} declared account(s).`,
      proof: "Over-limit or undeclared spends fail.",
      status: "sealed",
    },
  ];
  p.bonded.forEach((b, i) => {
    if (b.terms.kind === "heartbeat") {
      lines.push({ key: `b${i}`, kind: "bonded", title: `Show up every ${duration(b.terms.every_secs)}`, plain: `Public update at least every ${duration(b.terms.every_secs)} for ${duration(b.terms.for_secs)}.`, proof: `${safeNear(b.stake)} NEAR at stake.`, status: "active", stake: b.stake });
    } else {
      lines.push({ key: `b${i}`, kind: "bonded", title: `Add ${safeNear(b.terms.amount)} NEAR to the floor`, plain: `Within ${duration(b.terms.within_secs)} of launch.`, proof: `${safeNear(b.stake)} NEAR at stake.`, status: "active", stake: b.stake });
    }
  });
  return lines;
}

function safeNear(y: string): string {
  try {
    return near(y);
  } catch {
    return "0";
  }
}

export interface TrustSummary {
  sealed: number;
  bonded: number;
  kept: number;
  broken: number;
  breakable: number;
  atStake: string;
}

export function trustSummary(c: Certificate): TrustSummary {
  return {
    sealed: sealedOaths(c).length,
    bonded: c.bonded.length,
    kept: c.bonded.filter((b) => b.status === "kept").length,
    broken: c.bonded.filter((b) => b.status === "broken").length,
    breakable: c.bonded.filter((b) => b.status === "breakable").length,
    atStake: c.bond_locked,
  };
}

export const secsUntil = (ns: string, nowNs: string) => Number((BigInt(ns) - BigInt(nowNs)) / NS);
