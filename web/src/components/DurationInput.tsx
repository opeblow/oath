import { useEffect, useState } from "react";

const UNITS = [
  { label: "minutes", secs: 60 },
  { label: "hours", secs: 3_600 },
  { label: "days", secs: 86_400 },
  { label: "weeks", secs: 604_800 },
];

function split(secs: number) {
  for (let i = UNITS.length - 1; i >= 0; i--) {
    if (secs > 0 && secs % UNITS[i].secs === 0) return { n: String(secs / UNITS[i].secs), unit: UNITS[i].secs };
  }
  return { n: String(Math.round(secs / 60)), unit: 60 };
}

export function DurationInput({ value, onChange, id, min = 0 }: { value: number; onChange: (secs: number) => void; id?: string; min?: number }) {
  const initial = split(value);
  const [n, setN] = useState(initial.n);
  const [unit, setUnit] = useState(initial.unit);
  useEffect(() => {
    const s = split(value);
    if (Number(n) * unit !== value) {
      setN(s.n);
      setUnit(s.unit);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const emit = (nn: string, uu: number) => {
    const v = Math.max(min, Math.round(Number(nn || "0") * uu));
    onChange(Number.isFinite(v) ? v : 0);
  };
  return (
    <div className="input-row">
      <input
        id={id}
        className="input num"
        inputMode="decimal"
        value={n}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.]/g, "");
          setN(v);
          emit(v, unit);
        }}
      />
      <select
        className="select"
        style={{ width: 130, borderLeft: 0 }}
        value={unit}
        aria-label="Unit"
        onChange={(e) => {
          const u = Number(e.target.value);
          setUnit(u);
          emit(n, u);
        }}
      >
        {UNITS.map((u) => (
          <option key={u.secs} value={u.secs}>{u.label}</option>
        ))}
      </select>
    </div>
  );
}
