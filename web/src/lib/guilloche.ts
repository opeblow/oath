// Procedural guilloche (banknote engraving) generator.
// Every coin gets a unique, deterministic pattern seeded by its account id.

export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

export interface RosetteOptions {
  cx: number;
  cy: number;
  radius: number;
  seed: string;
  lines?: number;
  steps?: number;
}

/**
 * Rosette made of hypotrochoid-like loops. Returns SVG path data strings,
 * one per line, so they can be stroked thinly in ink.
 */
export function rosette({ cx, cy, radius, seed, lines = 14, steps = 720 }: RosetteOptions): string[] {
  const r = rng(hashSeed(seed));
  const petals = 7 + Math.floor(r() * 9); // 7..15
  const wobble = 3 + Math.floor(r() * 5);
  const depth = 0.18 + r() * 0.14;
  const paths: string[] = [];
  for (let l = 0; l < lines; l++) {
    const t = l / lines;
    const base = radius * (0.5 + 0.5 * t);
    const phase = t * Math.PI * 2 * (0.15 + r() * 0.05);
    let d = "";
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const rr =
        base *
        (1 - depth + depth * Math.cos(petals * a + phase)) *
        (1 + 0.04 * Math.sin(wobble * a - phase * 2));
      const x = cx + rr * Math.cos(a);
      const y = cy + rr * Math.sin(a);
      d += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    paths.push(d + "Z");
  }
  return paths;
}

/** Horizontal wave band, like the border of a banknote. */
export function waveBand(width: number, y: number, height: number, seed: string, lines = 9): string[] {
  const r = rng(hashSeed(seed + ":band"));
  const freq = 10 + Math.floor(r() * 14);
  const paths: string[] = [];
  for (let l = 0; l < lines; l++) {
    const phase = (l / lines) * Math.PI;
    let d = "";
    const steps = Math.max(200, Math.floor(width / 2));
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * width;
      const a = (x / width) * Math.PI * 2 * freq;
      const yy = y + height / 2 + (height / 2) * Math.sin(a + phase) * Math.cos(a / 3 - phase);
      d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${yy.toFixed(2)}`;
    }
    paths.push(d);
  }
  return paths;
}

/** A serial number derived from the account id, e.g. "OA 4821 0937". */
export function serial(seed: string): string {
  const h = hashSeed(seed).toString().padStart(10, "0");
  const h2 = hashSeed(seed + ":2").toString().padStart(10, "0");
  return `OA ${h.slice(0, 4)} ${h2.slice(0, 4)} ${h.slice(4, 6)}`;
}
