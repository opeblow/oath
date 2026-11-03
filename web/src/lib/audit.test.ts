import { describe, expect, it } from "vitest";
import live from "./__fixtures__/first-certificate.json";
import { audit } from "./audit";
import type { Certificate } from "./types";

const base = live as unknown as Certificate;

describe("audit", () => {
  it("grades the live testnet coin without risks", () => {
    const r = audit(base);
    expect(r.counts.risk).toBe(0);
    expect(r.findings.find((f) => f.id === "solvent")?.severity).toBe("ok");
  });

  it("flags a breakable oath as a risk and grades D", () => {
    const c: Certificate = {
      ...base,
      bonded: [{ ...base.bonded[0], index: 0, kind: "heartbeat", status: "breakable" } as Certificate["bonded"][0]],
    };
    const r = audit(c);
    expect(r.grade).toBe("D");
    expect(r.findings.some((f) => f.id === "oath-1" && f.severity === "risk")).toBe(true);
  });

  it("warns when the creator can pay the treasury to themselves", () => {
    const c: Certificate = { ...base, treasury_rule: { ...base.treasury_rule, recipients: [base.creator] } };
    expect(audit(c).findings.find((f) => f.id === "treasury")?.severity).toBe("warn");
  });

  it("warns when there are no bonded oaths", () => {
    expect(audit({ ...base, bonded: [] }).findings.find((f) => f.id === "bond")?.severity).toBe("warn");
  });

  it("flags insolvency", () => {
    const c: Certificate = { ...base, accounting: { ...base.accounting, solvent: false } };
    expect(audit(c).grade).toBe("D");
  });
});

import { approx, relative } from "./format";
describe("relative time", () => {
  it("rounds to the largest unit", () => {
    expect(approx(39_540)).toBe("11 hours");
    expect(approx(90)).toBe("2 minutes");
    expect(approx(86_400 * 3)).toBe("3 days");
    const ns = (BigInt(Date.now() - 3 * 3_600_000) * 1_000_000n).toString();
    expect(relative(ns)).toBe("3 hours ago");
  });
});
