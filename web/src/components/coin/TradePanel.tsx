import { useEffect, useState } from "react";
import { bpsToPct, near, parseNear, parseTokens, spotPrice, tokens } from "../../lib/format";
import { coin } from "../../lib/near";
import type { BuyQuote, Certificate, HolderView, SellQuote } from "../../lib/types";
import { useTx } from "../../lib/useTx";
import { useWallet } from "../../lib/wallet";
import { AnyChainBuy } from "./AnyChainBuy";

const SLIPPAGE_BPS = 100n;

export function TradePanel({ cert, holder, onChange }: { cert: Certificate; holder: HolderView | undefined; onChange: () => void }) {
  const [tab, setTab] = useState<"buy" | "sell" | "any">("buy");
  const [amount, setAmount] = useState("1");
  const [quote, setQuote] = useState<BuyQuote | SellQuote | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const { accountId, connect } = useWallet();
  const { send, busy } = useTx(onChange);
  const sym = cert.symbol;
  const sellable = holder ? BigInt(holder.balance) - BigInt(holder.locked) : 0n;
  const soldOut = BigInt(cert.curve.tokens_for_sale) === 0n;

  useEffect(() => {
    setQuote(null);
    setQErr(null);
    if (tab === "any") return;
    const t = setTimeout(async () => {
      try {
        if (!amount || Number(amount) <= 0) return;
        if (tab === "buy") setQuote(await coin.quoteBuy(cert.contract_id, parseNear(amount), accountId ?? undefined));
        else setQuote(await coin.quoteSell(cert.contract_id, parseTokens(amount)));
      } catch (e) {
        setQErr(e instanceof Error ? e.message.replace(/^.*panicked: /, "") : "No quote");
      }
    }, 350);
    return () => clearTimeout(t);
  }, [tab, amount, cert.contract_id, accountId, cert.curve.token_reserve_virtual]);

  async function submit() {
    if (!accountId) return connect();
    if (!quote) return;
    if (tab === "buy") {
      const q = quote as BuyQuote;
      const min = (BigInt(q.tokens_out) * (10_000n - SLIPPAGE_BPS)) / 10_000n;
      await send(
        "Buy",
        { contractId: cert.contract_id, method: "buy", args: { min_tokens_out: min.toString() }, deposit: parseNear(amount), gas: "50000000000000" },
        (r) => `Bought ${tokens(String(r.value ?? q.tokens_out))} ${sym}`,
      );
    } else {
      const q = quote as SellQuote;
      const min = (BigInt(q.near_out) * (10_000n - SLIPPAGE_BPS)) / 10_000n;
      await send(
        "Sell",
        { contractId: cert.contract_id, method: "sell", args: { amount: parseTokens(amount), min_near_out: min.toString() }, deposit: "1", gas: "50000000000000" },
        (r) => `Sold for ${near(String(r.value ?? q.near_out))} NEAR`,
      );
    }
  }

  return (
    <section className="panel" aria-label="Trade">
      <div className="panel-title">
        <h3>Trade</h3>
        <span className="small mono muted">{spotPrice(cert.curve.spot_price_scaled)} NEAR / {sym}</span>
      </div>
      <div className="trade-tabs" role="tablist" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <button role="tab" aria-selected={tab === "buy"} className={tab === "buy" ? "on" : ""} onClick={() => { setTab("buy"); setAmount("1"); }}>Buy</button>
        <button role="tab" aria-selected={tab === "sell"} className={tab === "sell" ? "on" : ""} onClick={() => { setTab("sell"); setAmount(""); }}>Sell</button>
        <button role="tab" aria-selected={tab === "any"} className={tab === "any" ? "on" : ""} onClick={() => setTab("any")}>Any chain</button>
      </div>

      {tab === "any" ? (
        <AnyChainBuy cert={cert} onChange={onChange} />
      ) : (
        <>
          <label className="field">
            <span className="field-label">{tab === "buy" ? "You pay" : "You sell"}</span>
            <div className="input-row">
              <input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
              <span className="input-suffix">{tab === "buy" ? "NEAR" : sym}</span>
            </div>
          </label>
          {tab === "sell" && holder && (
            <div className="small muted" style={{ marginTop: 6 }}>
              Sellable {tokens(sellable < 0n ? 0n : sellable)} {sym}
              {sellable > 0n && (
                <>
                  {" "}
                  <button className="btn-link small" onClick={() => setAmount((Number(sellable / 10n ** 12n) / 1e6).toString())}>Max</button>
                </>
              )}
            </div>
          )}

          <div className="quote" aria-live="polite">
            {qErr ? (
              <div className="error-text">{qErr}</div>
            ) : !quote ? (
              <div className="muted">Quoting...</div>
            ) : tab === "buy" ? (
              <>
                <div><span>You receive</span><strong className="num">{tokens((quote as BuyQuote).tokens_out)} {sym}</strong></div>
                <div><span className="muted">Fee ({bpsToPct(cert.fee_bps)})</span><span className="num">{near((quote as BuyQuote).fee)} NEAR</span></div>
                {BigInt((quote as BuyQuote).registration_cost) > 0n && (
                  <div><span className="muted">One-time registration</span><span className="num">{near((quote as BuyQuote).registration_cost)} NEAR</span></div>
                )}
                {BigInt((quote as BuyQuote).refund) > 0n && (
                  <div><span className="muted">Refunded (curve sold out)</span><span className="num">{near((quote as BuyQuote).refund)} NEAR</span></div>
                )}
              </>
            ) : (
              <>
                <div><span>You receive</span><strong className="num">{near((quote as SellQuote).near_out)} NEAR</strong></div>
                <div><span className="muted">Fee ({bpsToPct(cert.fee_bps)})</span><span className="num">{near((quote as SellQuote).fee)} NEAR</span></div>
              </>
            )}
            <div className="small muted">Slippage protection 1%. Liquidity is locked in the contract, so a sell can always settle.</div>
          </div>

          <button className="btn" style={{ width: "100%" }} disabled={!!busy || !!qErr || (!!accountId && !quote) || (tab === "buy" && soldOut)} onClick={submit}>
            {!accountId ? "Connect wallet" : busy ? "Confirm in wallet..." : tab === "buy" ? (soldOut ? "Curve sold out" : `Buy ${sym}`) : `Sell ${sym}`}
          </button>
        </>
      )}
    </section>
  );
}
