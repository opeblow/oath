import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CertificateCard, type CertificateModel } from "../components/CertificateCard";
import { DurationInput } from "../components/DurationInput";
import { config } from "../lib/config";
import { bpsToPct, near, parseNear, tokens } from "../lib/format";
import { viewAccount } from "../lib/near";
import { previewOaths } from "../lib/oaths";
import { errorText, useToast } from "../lib/toast";
import type { BondedOathInput, LaunchParams } from "../lib/types";
import { useWallet } from "../lib/wallet";

const DAY = 86_400;
const STORAGE_AND_REGISTRY = "520000000000000000000000"; // 0.52 NEAR, see factory

interface Draft {
  name: string;
  symbol: string;
  sub: string;
  manifesto: string;
  icon: string | null;
  supply: string;
  creatorPct: string;
  cliff: number;
  vest: number;
  window: number;
  maxWalletPct: string;
  feePct: string;
  startNear: string;
  recipients: string[];
  treasuryMax: string;
  period: number;
  bonded: BondedDraft[];
}

type BondedDraft =
  | { kind: "heartbeat"; every: number; forSecs: number; stake: string }
  | { kind: "floor_top_up"; amount: string; within: number; stake: string };

const INITIAL: Draft = {
  name: "",
  symbol: "",
  sub: "",
  manifesto: "",
  icon: null,
  supply: "1000000000",
  creatorPct: "5",
  cliff: 30 * DAY,
  vest: 60 * DAY,
  window: DAY,
  maxWalletPct: "2",
  feePct: "1",
  startNear: "100",
  recipients: [""],
  treasuryMax: "1",
  period: 7 * DAY,
  bonded: [{ kind: "heartbeat", every: 7 * DAY, forSecs: 8 * 7 * DAY, stake: "2" }],
};

const STEPS = ["Identity", "Sealed oaths", "Treasury", "Bonded oaths", "Review"];

function pctToBps(p: string): number {
  const v = Math.round(Number(p) * 100);
  return Number.isFinite(v) ? v : -1;
}

function toParams(d: Draft): { params: LaunchParams; errors: Record<string, string>; bond: bigint } {
  const errors: Record<string, string> = {};
  const nearOr = (v: string, key: string) => {
    try {
      return parseNear(v);
    } catch {
      errors[key] = "Enter an amount in NEAR";
      return "0";
    }
  };
  if (!d.name.trim()) errors.name = "Give the coin a name";
  if (d.name.length > 32) errors.name = "32 characters at most";
  if (!/^[A-Za-z0-9]{2,12}$/.test(d.symbol)) errors.symbol = "2 to 12 letters or digits";
  if (!/^[a-z0-9]([a-z0-9-]{0,22}[a-z0-9])?$/.test(d.sub) || d.sub.length < 2) errors.sub = "2 to 24 characters: a-z, 0-9 or -";
  if (d.manifesto.length > 280) errors.manifesto = "280 characters at most";
  const supply = BigInt(/^\d+$/.test(d.supply) ? d.supply : "0");
  if (supply < 1000n || supply > 1_000_000_000_000n) errors.supply = "Between 1,000 and 1,000,000,000,000";
  const creatorBps = pctToBps(d.creatorPct);
  if (creatorBps < 0 || creatorBps > 1000) errors.creatorPct = "0% to 10%";
  if (creatorBps > 0 && d.vest <= 0) errors.vest = "Vesting needs a duration";
  const maxWalletBps = pctToBps(d.maxWalletPct);
  if (maxWalletBps < 10 || maxWalletBps > 10000) errors.maxWalletPct = "0.1% to 100%";
  const feeBps = pctToBps(d.feePct);
  if (feeBps < 0 || feeBps > 200) errors.feePct = "0% to 2%";
  const start = nearOr(d.startNear, "startNear");
  if (BigInt(start) < 10n ** 24n || BigInt(start) > 100_000n * 10n ** 24n) errors.startNear = "1 to 100,000 NEAR";
  const recipients = d.recipients.map((r) => r.trim()).filter(Boolean);
  if (recipients.length === 0) errors.recipients = "Declare at least one recipient";
  if (recipients.some((r) => !/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(r) || r.length < 2 || r.length > 64))
    errors.recipients = "Use valid NEAR account names";
  if (d.period < 3600) errors.period = "At least one hour";
  const treasuryMax = nearOr(d.treasuryMax, "treasuryMax");

  let bond = 0n;
  const bonded: BondedOathInput[] = d.bonded.map((b, i) => {
    const stake = nearOr(b.stake, `stake${i}`);
    if (BigInt(stake) < 10n ** 23n) errors[`stake${i}`] = "At least 0.1 NEAR";
    bond += BigInt(stake);
    if (b.kind === "heartbeat") {
      if (b.every < 60) errors[`every${i}`] = "At least a minute";
      if (b.forSecs < b.every) errors[`for${i}`] = "Must cover at least one interval";
      return { stake, terms: { kind: "heartbeat", every_secs: b.every, for_secs: b.forSecs } };
    }
    const amount = nearOr(b.amount, `amount${i}`);
    if (BigInt(amount) <= 0n) errors[`amount${i}`] = "Promise a positive amount";
    if (b.within < 60) errors[`within${i}`] = "At least a minute";
    return { stake, terms: { kind: "floor_top_up", amount, within_secs: b.within } };
  });

  return {
    bond,
    errors,
    params: {
      name: d.name.trim(),
      symbol: d.symbol.toUpperCase(),
      icon: d.icon,
      manifesto: d.manifesto.trim(),
      total_supply_whole: supply.toString(),
      creator_alloc_bps: Math.max(0, creatorBps),
      vest_cliff_secs: d.cliff,
      vest_duration_secs: creatorBps > 0 ? d.vest : 0,
      virtual_near: start,
      fee_bps: Math.max(0, feeBps),
      max_wallet_bps: Math.max(10, maxWalletBps),
      launch_window_secs: d.window,
      treasury: { recipients, max_per_period: treasuryMax, period_secs: d.period },
      bonded,
    },
  };
}

async function resizeIcon(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  for (const size of [128, 96, 72, 56]) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const s = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, (bitmap.width - s) / 2, (bitmap.height - s) / 2, s, s, 0, 0, size, size);
    for (const q of [0.8, 0.6, 0.45]) {
      const url = canvas.toDataURL("image/webp", q);
      if (url.startsWith("data:image/webp") && url.length <= 8000) return url;
      const jpg = canvas.toDataURL("image/jpeg", q);
      if (jpg.length <= 8000) return jpg;
    }
  }
  throw new Error("Image is too detailed to fit on chain. Try a simpler one.");
}

export default function Launch() {
  const [d, setD] = useState<Draft>(INITIAL);
  const [step, setStep] = useState(0);
  const [touched, setTouched] = useState(false);
  const [subFree, setSubFree] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const { accountId, call, connect } = useWallet();
  const toast = useToast();
  const navigate = useNavigate();

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const { params, errors, bond } = useMemo(() => toParams(d), [d]);
  const total = bond + BigInt(STORAGE_AND_REGISTRY);
  const coinId = `${d.sub || "your-coin"}.${config.factoryId}`;

  useEffect(() => {
    if (!d.sub || errors.sub) return setSubFree(null);
    setSubFree(null);
    const t = setTimeout(() => {
      viewAccount(`${d.sub}.${config.factoryId}`)
        .then((a) => setSubFree(a === null))
        .catch(() => setSubFree(null));
    }, 400);
    return () => clearTimeout(t);
  }, [d.sub, errors.sub]);

  useEffect(() => {
    if (accountId && d.recipients.length === 1 && !d.recipients[0]) set("recipients", [accountId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const stepFields: string[][] = [
    ["name", "symbol", "sub", "manifesto"],
    ["supply", "creatorPct", "vest", "maxWalletPct", "feePct", "startNear"],
    ["recipients", "treasuryMax", "period"],
    Object.keys(errors).filter((k) => /^(stake|every|for|amount|within)\d+$/.test(k)),
    [],
  ];
  const stepErrors = (i: number) => stepFields[i].filter((k) => errors[k]);
  const canNext = stepErrors(step).length === 0 && !(step === 0 && subFree === false);
  const err = (k: string) => (touched || step > 0) && errors[k] ? <span className="error-text">{errors[k]}</span> : null;

  const preview: CertificateModel = {
    id: coinId,
    name: d.name || "Your coin",
    symbol: (d.symbol || "COIN").toUpperCase(),
    manifesto: d.manifesto,
    creator: accountId ?? "you.testnet",
    icon: d.icon,
    oathTitles: previewOaths(params).map((o) => o.title),
    facts: [
      { label: "Oaths", value: String(5 + d.bonded.length), sub: `${d.bonded.length} bonded` },
      { label: "Bond at stake", value: near(bond, 2), sub: "NEAR" },
      { label: "Supply", value: tokens(BigInt(params.total_supply_whole) * 10n ** 18n, 0) },
      { label: "Creator", value: bpsToPct(params.creator_alloc_bps), sub: "vesting" },
    ],
  };

  async function launch() {
    setTouched(true);
    if (Object.keys(errors).length) {
      toast.fail("Check the form", "Some fields need attention.");
      return;
    }
    if (!accountId) {
      await connect();
      return;
    }
    setBusy(true);
    try {
      const r = await call({
        contractId: config.factoryId,
        method: "create_coin",
        args: { sub: d.sub, params },
        deposit: total.toString(),
        gas: "200000000000000",
      });
      if (r.value === false) throw new Error("The launch was rejected and your deposit was refunded.");
      toast.ok("Sworn and sealed", `${coinId} is live.`, r.txHash);
      navigate(`/coin/${coinId}?sworn=1`);
    } catch (e) {
      toast.fail("Launch failed", errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const bondedEditor = (b: BondedDraft, i: number) => {
    const update = (patch: Partial<BondedDraft>) => set("bonded", d.bonded.map((x, j) => (j === i ? ({ ...x, ...patch } as BondedDraft) : x)));
    return (
      <div className="oath-builder" key={i}>
        <div className="oath-builder-head">
          <strong>{b.kind === "heartbeat" ? "Show up on schedule" : "Add to the floor"}</strong>
          <button className="btn-link small" onClick={() => set("bonded", d.bonded.filter((_, j) => j !== i))}>Remove</button>
        </div>
        {b.kind === "heartbeat" ? (
          <div className="form-row">
            <div className="field">
              <span className="field-label">Post an update every</span>
              <DurationInput value={b.every} onChange={(v) => update({ every: v })} />
              {err(`every${i}`)}
            </div>
            <div className="field">
              <span className="field-label">For how long</span>
              <DurationInput value={b.forSecs} onChange={(v) => update({ forSecs: v })} />
              {err(`for${i}`)}
            </div>
          </div>
        ) : (
          <div className="form-row">
            <div className="field">
              <span className="field-label">Amount to add</span>
              <div className="input-row">
                <input className="input num" inputMode="decimal" value={b.amount} onChange={(e) => update({ amount: e.target.value })} />
                <span className="input-suffix">NEAR</span>
              </div>
              {err(`amount${i}`)}
            </div>
            <div className="field">
              <span className="field-label">Within</span>
              <DurationInput value={b.within} onChange={(v) => update({ within: v })} />
              {err(`within${i}`)}
            </div>
          </div>
        )}
        <div className="field">
          <span className="field-label">Stake on this promise</span>
          <div className="input-row">
            <input className="input num" inputMode="decimal" value={b.stake} onChange={(e) => update({ stake: e.target.value })} />
            <span className="input-suffix">NEAR</span>
          </div>
          <span className="field-hint">Paid to holders if you break it. Returned to you when you keep it.</span>
          {err(`stake${i}`)}
        </div>
      </div>
    );
  };

  return (
    <div className="wrap">
      <header className="page-head">
        <div className="eyebrow">Launch</div>
        <h1>Swear your coin into being.</h1>
        <p className="lede">Five steps, one transaction. Everything you set here is sealed in the contract and can never be edited, including by you.</p>
      </header>

      <div className="launch-grid">
        <div>
          <nav className="steps-nav" aria-label="Launch steps">
            {STEPS.map((s, i) => (
              <button key={s} className={`${i === step ? "on" : ""} ${i < step ? "done" : ""}`} onClick={() => (i <= step || stepErrors(step).length === 0) && setStep(i)}>
                {i + 1}. {s}
              </button>
            ))}
          </nav>

          {step === 0 && (
            <div className="form-stack">
              <div className="form-row">
                <label className="field">
                  <span className="field-label">Name</span>
                  <input className="input" value={d.name} maxLength={32} placeholder="Pepe Keeps Promises" onChange={(e) => set("name", e.target.value)} />
                  {err("name")}
                </label>
                <label className="field">
                  <span className="field-label">Symbol</span>
                  <input
                    className="input mono"
                    value={d.symbol}
                    maxLength={12}
                    placeholder="PKP"
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
                      setD((x) => ({ ...x, symbol: v, sub: x.sub && x.sub !== x.symbol.toLowerCase() ? x.sub : v.toLowerCase() }));
                    }}
                  />
                  {err("symbol")}
                </label>
              </div>
              <label className="field">
                <span className="field-label">Coin account</span>
                <div className="input-row">
                  <input className="input mono" value={d.sub} placeholder="pkp" onChange={(e) => set("sub", e.target.value.toLowerCase())} />
                  <span className="input-suffix">.{config.factoryId}</span>
                </div>
                {err("sub") ??
                  (subFree === false ? <span className="error-text">Taken. Pick another.</span> : subFree ? <span className="field-hint">Available.</span> : null)}
              </label>
              <label className="field">
                <span className="field-label">Manifesto</span>
                <textarea className="textarea" maxLength={280} value={d.manifesto} placeholder="Why this coin exists, in one or two sentences." onChange={(e) => set("manifesto", e.target.value)} />
                <span className="field-hint">{d.manifesto.length}/280. Printed on the certificate.</span>
              </label>
              <div className="field">
                <span className="field-label">Icon (optional)</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      set("icon", await resizeIcon(f));
                    } catch (x) {
                      toast.fail("Icon not used", x);
                    }
                  }}
                />
                <span className="field-hint">Resized and stored on chain inside the token metadata.</span>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="form-stack">
              <div className="form-row">
                <label className="field">
                  <span className="field-label">Total supply</span>
                  <input className="input num" inputMode="numeric" value={d.supply} onChange={(e) => set("supply", e.target.value.replace(/\D/g, ""))} />
                  {err("supply")}
                </label>
                <label className="field">
                  <span className="field-label">Starting reserve</span>
                  <div className="input-row">
                    <input className="input num" inputMode="decimal" value={d.startNear} onChange={(e) => set("startNear", e.target.value)} />
                    <span className="input-suffix">NEAR</span>
                  </div>
                  <span className="field-hint">Virtual. Sets the opening price; no NEAR is deposited.</span>
                  {err("startNear")}
                </label>
              </div>
              <div className="form-row">
                <label className="field">
                  <span className="field-label">Creator allocation</span>
                  <div className="input-row">
                    <input className="input num" inputMode="decimal" value={d.creatorPct} onChange={(e) => set("creatorPct", e.target.value)} />
                    <span className="input-suffix">%</span>
                  </div>
                  <span className="field-hint">0 to 10%. Locked by the vesting below.</span>
                  {err("creatorPct")}
                </label>
                <label className="field">
                  <span className="field-label">Trade fee</span>
                  <div className="input-row">
                    <input className="input num" inputMode="decimal" value={d.feePct} onChange={(e) => set("feePct", e.target.value)} />
                    <span className="input-suffix">%</span>
                  </div>
                  <span className="field-hint">0 to 2%. Goes to the rule-bound treasury.</span>
                  {err("feePct")}
                </label>
              </div>
              <div className="form-row">
                <div className="field">
                  <span className="field-label">Vesting cliff</span>
                  <DurationInput value={d.cliff} onChange={(v) => set("cliff", v)} />
                  <span className="field-hint">Nothing unlocks before this.</span>
                </div>
                <div className="field">
                  <span className="field-label">Then unlock over</span>
                  <DurationInput value={d.vest} onChange={(v) => set("vest", v)} />
                  {err("vest")}
                </div>
              </div>
              <div className="form-row">
                <label className="field">
                  <span className="field-label">Launch max wallet</span>
                  <div className="input-row">
                    <input className="input num" inputMode="decimal" value={d.maxWalletPct} onChange={(e) => set("maxWalletPct", e.target.value)} />
                    <span className="input-suffix">%</span>
                  </div>
                  {err("maxWalletPct")}
                </label>
                <div className="field">
                  <span className="field-label">Launch window</span>
                  <DurationInput value={d.window} onChange={(v) => set("window", v)} />
                  <span className="field-hint">The cap and the creator buy ban last this long.</span>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="form-stack">
              <p className="muted">Trade fees collect in the treasury. Only you can spend it, only within these limits, only to these accounts, and every spend carries a public note.</p>
              <div className="field">
                <span className="field-label">Who can receive treasury funds</span>
                {d.recipients.map((r, i) => (
                  <div className="input-row" key={i}>
                    <input className="input mono" value={r} placeholder="artist.testnet" onChange={(e) => set("recipients", d.recipients.map((x, j) => (j === i ? e.target.value.trim().toLowerCase() : x)))} />
                    {d.recipients.length > 1 && (
                      <button className="btn btn-ghost btn-sm" style={{ borderLeft: 0 }} onClick={() => set("recipients", d.recipients.filter((_, j) => j !== i))}>Remove</button>
                    )}
                  </div>
                ))}
                {d.recipients.length < 8 && (
                  <button className="btn-link small" style={{ justifySelf: "start" }} onClick={() => set("recipients", [...d.recipients, ""])}>Add recipient</button>
                )}
                {err("recipients")}
              </div>
              <div className="form-row">
                <label className="field">
                  <span className="field-label">Spending limit</span>
                  <div className="input-row">
                    <input className="input num" inputMode="decimal" value={d.treasuryMax} onChange={(e) => set("treasuryMax", e.target.value)} />
                    <span className="input-suffix">NEAR</span>
                  </div>
                  {err("treasuryMax")}
                </label>
                <div className="field">
                  <span className="field-label">Per period of</span>
                  <DurationInput value={d.period} onChange={(v) => set("period", v)} />
                  {err("period")}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="form-stack">
              <p className="muted">
                Bonded oaths are promises the contract can watch but not force. Each one stakes part of your bond. Break one, and anyone can enforce it:
                5% to them, 95% to your holders.
              </p>
              {d.bonded.map(bondedEditor)}
              {d.bonded.length < 4 && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => set("bonded", [...d.bonded, { kind: "heartbeat", every: 7 * DAY, forSecs: 8 * 7 * DAY, stake: "1" }])}>
                    Add: show up on schedule
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => set("bonded", [...d.bonded, { kind: "floor_top_up", amount: "5", within: 14 * DAY, stake: "1" }])}>
                    Add: top up the floor
                  </button>
                </div>
              )}
              {d.bonded.length === 0 && <p className="field-hint">No bonded oaths. The sealed oaths still apply, but buyers will see nothing at stake.</p>}
            </div>
          )}

          {step === 4 && (
            <div className="form-stack">
              <table className="ledger cost-table">
                <tbody>
                  <tr><td>Creator bond (all stakes)</td><td>{near(bond)} NEAR</td></tr>
                  <tr><td>Coin storage and registry</td><td>{near(STORAGE_AND_REGISTRY)} NEAR</td></tr>
                  <tr className="total"><td>Attached to the launch</td><td>{near(total)} NEAR</td></tr>
                </tbody>
              </table>
              <p className="small muted">
                The bond stays in your coin's contract. You reclaim each stake when its oath is kept. Network: {config.network}. Coin account: <span className="mono">{coinId}</span>.
              </p>
              {Object.keys(errors).length > 0 && (
                <div className="error-text">Fix {Object.keys(errors).length} field(s) in the earlier steps before launching.</div>
              )}
              <button className="btn btn-seal" disabled={busy || subFree === false} onClick={launch}>
                {busy ? "Waiting for your wallet..." : accountId ? `Swear and launch for ${near(total, 2)} NEAR` : "Connect a wallet to launch"}
              </button>
              <p className="small muted">
                Need testnet NEAR? Use the <a href="https://near-faucet.io" target="_blank" rel="noreferrer">faucet</a>. New to OATH? Read <Link to="/how">how it works</Link>.
              </p>
            </div>
          )}

          <div className="form-actions">
            <button className="btn btn-ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</button>
            {step < STEPS.length - 1 && (
              <button
                className="btn"
                disabled={!canNext}
                onClick={() => {
                  setTouched(true);
                  if (canNext) setStep((s) => s + 1);
                }}
              >
                Continue
              </button>
            )}
          </div>
        </div>

        <aside className="launch-preview" aria-label="Certificate preview">
          <div className="eyebrow">Live preview</div>
          <CertificateCard model={preview} stamp={false} compact />
          <ol className="oath-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {previewOaths(params).map((o, i) => (
              <li key={o.key} className="oath" style={{ gridTemplateColumns: "34px 1fr" }}>
                <span className="oath-n" style={{ fontSize: 20 }}>{i + 1}</span>
                <div>
                  <strong>{o.title}</strong>
                  <div className="small muted">{o.plain}</div>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
