import { useId } from "react";

interface SealProps {
  size?: number;
  /** Text set around the rim, e.g. "SEALED ON NEAR". */
  text?: string;
  /** Centre mark, usually the coin symbol. */
  mark?: string;
  stamp?: boolean;
  tone?: "seal" | "ink";
}

/** Wax seal drawn in SVG: irregular rim, rim lettering, inner ring, centre mark. */
export function Seal({ size = 120, text = "SEALED BY CODE  -  OATH  -  ", mark = "OATH", stamp = false, tone = "seal" }: SealProps) {
  const id = useId().replace(/:/g, "");
  const fill = tone === "seal" ? "var(--seal)" : "var(--ink)";
  const edge = Array.from({ length: 28 }, (_, i) => {
    const a = (i / 28) * Math.PI * 2;
    const r = 48 + (i % 2 === 0 ? 1.8 : -1.2) + Math.sin(i * 1.7) * 0.9;
    return `${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
  const repeated = text.repeat(Math.max(1, Math.ceil(60 / text.length))).slice(0, 60);
  const markSize = mark.length <= 4 ? 15 : mark.length <= 6 ? 12 : 9.5;
  return (
    <svg
      className={stamp ? "seal-stamp" : undefined}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={`Seal: ${mark}`}
    >
      <defs>
        <path id={`rim-${id}`} d="M50,50 m-34,0 a34,34 0 1,1 68,0 a34,34 0 1,1 -68,0" />
      </defs>
      <polygon points={edge} fill={fill} />
      <circle cx="50" cy="50" r="42" fill="none" stroke="var(--paper)" strokeWidth="0.6" opacity="0.55" />
      <circle cx="50" cy="50" r="27" fill="none" stroke="var(--paper)" strokeWidth="0.8" />
      <circle cx="50" cy="50" r="25" fill="none" stroke="var(--paper)" strokeWidth="0.4" strokeDasharray="1 1.4" />
      <text fill="var(--paper)" fontFamily="var(--sans)" fontWeight="600" fontSize="6.2" letterSpacing="1.1">
        <textPath href={`#rim-${id}`}>{repeated}</textPath>
      </text>
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--paper)"
        fontFamily="var(--display)"
        fontSize={markSize}
        letterSpacing="0.5"
      >
        {mark}
      </text>
    </svg>
  );
}
