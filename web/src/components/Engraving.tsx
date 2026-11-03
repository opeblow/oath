import { useMemo } from "react";
import { rosette, waveBand } from "../lib/guilloche";

export function Rosette({ seed, size = 320, lines = 16, spin = false, opacity = 0.55 }: { seed: string; size?: number; lines?: number; spin?: boolean; opacity?: number }) {
  const paths = useMemo(() => rosette({ cx: 100, cy: 100, radius: 96, seed, lines, steps: 900 }), [seed, lines]);
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" style={{ display: "block" }}>
      <g className={spin ? "engrave-spin" : undefined} fill="none" stroke="var(--engrave)" strokeWidth="0.32" opacity={opacity}>
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </svg>
  );
}

export function Band({ seed, width = 1000, height = 26, lines = 8 }: { seed: string; width?: number; height?: number; lines?: number }) {
  const paths = useMemo(() => waveBand(width, 1, height - 2, seed, lines), [seed, width, height, lines]);
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true" style={{ display: "block" }}>
      <g fill="none" stroke="var(--engrave)" strokeWidth="0.45" opacity="0.6">
        {paths.map((d, i) => (
          <path key={i} d={d} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    </svg>
  );
}
