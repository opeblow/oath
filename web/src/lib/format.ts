const YOCTO = 10n ** 24n;
const TOKEN = 10n ** 18n;

function fixed(value: bigint, unit: bigint, digits: number): string {
  const negative = value < 0n;
  const v = negative ? -value : value;
  const whole = v / unit;
  const frac = v % unit;
  const scale = 10n ** BigInt(digits);
  let fracDigits = ((frac * scale) / unit).toString().padStart(digits, "0");
  fracDigits = fracDigits.replace(/0+$/, "");
  const wholeStr = whole.toLocaleString("en-US");
  return `${negative ? "-" : ""}${wholeStr}${fracDigits ? "." + fracDigits : ""}`;
}

/** yoctoNEAR string -> "1.25" */
export function near(yocto: string | bigint, digits = 4): string {
  return fixed(BigInt(yocto), YOCTO, digits);
}

/** "1.25" NEAR -> yoctoNEAR string. Accepts up to 24 decimals. */
export function parseNear(input: string): string {
  const s = input.trim();
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") throw new Error("Enter a number");
  const [w, f = ""] = s.split(".");
  if (f.length > 24) throw new Error("Too many decimals");
  return (BigInt(w || "0") * YOCTO + BigInt((f + "0".repeat(24)).slice(0, 24))).toString();
}

/** token units (18 decimals) -> human string with compact suffix for big values */
export function tokens(units: string | bigint, digits = 2): string {
  const v = BigInt(units);
  const whole = v / TOKEN;
  if (whole >= 1_000_000_000n) return `${fixed(v, TOKEN * 1_000_000_000n, 2)}B`;
  if (whole >= 1_000_000n) return `${fixed(v, TOKEN * 1_000_000n, 2)}M`;
  if (whole >= 10_000n) return `${fixed(v, TOKEN * 1_000n, 1)}K`;
  return fixed(v, TOKEN, digits);
}

export function parseTokens(input: string): string {
  const s = input.trim();
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") throw new Error("Enter a number");
  const [w, f = ""] = s.split(".");
  if (f.length > 18) throw new Error("Too many decimals");
  return (BigInt(w || "0") * TOKEN + BigInt((f + "0".repeat(18)).slice(0, 18))).toString();
}

export function percent(part: string | bigint, whole: string | bigint, digits = 1): string {
  const w = BigInt(whole);
  if (w === 0n) return "0%";
  const scaled = (BigInt(part) * 10n ** BigInt(digits + 2)) / w;
  const s = scaled.toString().padStart(digits + 1, "0");
  return `${s.slice(0, -digits) || "0"}.${s.slice(-digits)}%`;
}

export const bpsToPct = (bps: number) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

export const nsToDate = (ns: string | bigint) => new Date(Number(BigInt(ns) / 1_000_000n));

export function dateLabel(ns: string): string {
  return nsToDate(ns).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function duration(secs: number): string {
  const units: [number, string][] = [
    [86_400 * 365, "year"],
    [86_400 * 30, "month"],
    [86_400 * 7, "week"],
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    if (secs >= size && secs % size === 0) {
      const n = secs / size;
      return `${n} ${name}${n === 1 ? "" : "s"}`;
    }
  }
  for (const [size, name] of units) {
    if (secs >= size) {
      const n = Math.round((secs / size) * 10) / 10;
      return `${n} ${name}${n === 1 ? "" : "s"}`;
    }
  }
  return `${secs} seconds`;
}

/** Rounded to the largest whole unit, e.g. 39540 -> "11 hours". */
export function approx(secs: number): string {
  const units: [number, string][] = [
    [86_400 * 365, "year"],
    [86_400 * 30, "month"],
    [86_400 * 7, "week"],
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    if (secs >= size) {
      const n = Math.round(secs / size);
      return `${n} ${name}${n === 1 ? "" : "s"}`;
    }
  }
  return `${Math.round(secs)} seconds`;
}

/** Relative time from now, e.g. "in 3 days" or "2 hours ago". */
export function relative(ns: string, nowMs = Date.now()): string {
  const diff = (Number(BigInt(ns) / 1_000_000n) - nowMs) / 1000;
  const abs = Math.abs(diff);
  const label = abs < 60 ? "less than a minute" : approx(abs);
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}

export function shortAccount(id: string, max = 22): string {
  if (id.length <= max) return id;
  if (/^[0-9a-f]{64}$/.test(id)) return `${id.slice(0, 6)}...${id.slice(-4)}`;
  return `${id.slice(0, max - 8)}...${id.slice(-6)}`;
}

/** Spot price (yoctoNEAR per whole token, scaled by 1e18) -> NEAR per token string. */
export function spotPrice(scaled: string): string {
  const v = BigInt(scaled); // yocto per token * 1e18
  const perToken = Number(v) / 1e18 / 1e24;
  if (perToken === 0) return "0";
  if (perToken >= 0.01) return perToken.toFixed(4);
  const digits = Math.max(2, -Math.floor(Math.log10(perToken)) + 2);
  return perToken.toFixed(Math.min(digits, 14));
}
