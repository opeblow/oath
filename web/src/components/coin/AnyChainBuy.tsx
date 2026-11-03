import { useEffect, useMemo, useState } from "react";
import { config } from "../../lib/config";
import { parseNear } from "../../lib/format";
import {
  canExecuteIntents,
  chainLabel,
  DRY_RUN_ACCOUNT,
  intentsTokens,
  quoteForNear,
  swapStatus,
  type QuoteResponse,
  type SwapStatus,
} from "../../lib/intents";
import type { Certificate } from "../../lib/types";
import { useAsync } from "../../lib/useAsync";
import { useTx } from "../../lib/useTx";
import { useWallet } from "../../lib/wallet";

/**
 * Buy a coin with any token on any chain through NEAR Intents (1Click).
 * Step 1: 1Click turns the payment into wNEAR in the buyer's NEAR account.
 * Step 2: the buyer unwraps and buys in two signed calls.
 * On testnet, 1Click has no network, so the panel shows real dry-run quotes only.
 */
export function AnyChainBuy({ cert, onChange }: { cert: Certificate; onChange: () => void }) {
  const tokenList = useAsync(() => intentsTokens(), []);
  const [assetId, setAssetId] = useState("");
  const [nearAmount, setNearAmount] = useState("2");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [deposit, setDeposit] = useState<QuoteResponse | null>(null);
  const [status, setStatus] = useState<SwapStatus | null>(null);
  const { accountId } = useWallet();
  const { send, busy } = useTx(onChange);

  const options = tokenList.data ?? [];
  const selected = useMemo(() => options.find((t) => t.assetId === assetId) ?? options.find((t) => t.symbol === "USDC" && t.blockchain === "base") ?? options[0], [options, assetId]);

  useEffect(() => {
    setQuote(null);
    setErr(null);
    if (!selected) return;
    const t = setTimeout(async () => {
      try {
        const q = await quoteForNear({
          originAsset: selected.assetId,
          nearOut: parseNear(nearAmount),
          recipient: canExecuteIntents && accountId ? accountId : DRY_RUN_ACCOUNT,
          refundTo: canExecuteIntents && accountId ? accountId : DRY_RUN_ACCOUNT,
          dry: true,
        });
        setQuote(q);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "No route");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [selected, nearAmount, accountId]);

  useEffect(() => {
    const addr = deposit?.quote.depositAddress;
    if (!addr || status === "SUCCESS" || status === "REFUNDED" || status === "FAILED") return;
    const t = setInterval(async () => setStatus(await swapStatus(addr).catch(() => status)), 5000);
    return () => clearInterval(t);
  }, [deposit, status]);

  async function getDepositAddress() {
    if (!selected || !accountId) return;
    try {
      const q = await quoteForNear({ originAsset: selected.assetId, nearOut: parseNear(nearAmount), recipient: accountId, refundTo: accountId, dry: false });
      setDeposit(q);
      setStatus("PENDING_DEPOSIT");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create the deposit");
    }
  }

  async function unwrapAndBuy() {
    const amount = deposit?.quote.amountOut ?? parseNear(nearAmount);
    const unwrapped = await send("Unwrap NEAR", { contractId: "wrap.near", method: "near_withdraw", args: { amount }, deposit: "1", gas: "10000000000000" });
    if (!unwrapped) return;
    await send("Buy", { contractId: cert.contract_id, method: "buy", args: { min_tokens_out: "0" }, deposit: amount, gas: "50000000000000" });
  }

  return (
    <div className="form-stack" style={{ gap: 14 }}>
      <label className="field">
        <span className="field-label">Pay with</span>
        <select className="select" value={selected?.assetId ?? ""} onChange={(e) => setAssetId(e.target.value)} disabled={!options.length}>
          {!options.length && <option>{tokenList.error ? "Token list unavailable" : "Loading 1Click tokens..."}</option>}
          {options.map((t) => (
            <option key={t.assetId} value={t.assetId}>
              {t.symbol} on {chainLabel(t.blockchain)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">NEAR to put into {cert.symbol}</span>
        <div className="input-row">
          <input className="input num" inputMode="decimal" value={nearAmount} onChange={(e) => setNearAmount(e.target.value.replace(/[^\d.]/g, ""))} />
          <span className="input-suffix">NEAR</span>
        </div>
      </label>
      <div className="quote" aria-live="polite">
        {err ? (
          <div className="error-text">{err}</div>
        ) : quote && selected ? (
          <>
            <div><span>You send</span><strong className="num">{quote.quote.amountInFormatted} {selected.symbol}</strong></div>
            <div><span className="muted">On</span><span>{chainLabel(selected.blockchain)}</span></div>
            <div><span className="muted">Value</span><span className="num">${Number(quote.quote.amountInUsd).toFixed(2)}</span></div>
            <div><span className="muted">Arrives in about</span><span className="num">{quote.quote.timeEstimate}s</span></div>
            <div className="small muted">Live signed quote from NEAR Intents 1Click. Refunds go to your NEAR Intents balance.</div>
          </>
        ) : (
          <div className="muted">Asking 1Click solvers for a route...</div>
        )}
      </div>

      {!canExecuteIntents ? (
        <div className="small" style={{ borderLeft: "2px solid var(--amber)", paddingLeft: 10 }}>
          NEAR Intents runs on mainnet only, and this app is on {config.network}. The quote above is real; executing it is enabled on the mainnet build.
        </div>
      ) : !deposit ? (
        <button className="btn" disabled={!quote || !accountId} onClick={getDepositAddress}>
          {accountId ? "Get deposit address" : "Connect wallet first"}
        </button>
      ) : (
        <div className="panel" style={{ padding: 14 }}>
          <div className="field-label">Send exactly</div>
          <div className="mono">{deposit.quote.amountInFormatted} {selected?.symbol}</div>
          <div className="field-label" style={{ marginTop: 8 }}>To this {chainLabel(selected?.blockchain ?? "")} address</div>
          <div className="mono small" style={{ overflowWrap: "anywhere" }}>{deposit.quote.depositAddress}</div>
          <div className="small" style={{ marginTop: 8 }}>Status: <strong>{status?.replace(/_/g, " ").toLowerCase()}</strong></div>
          {status === "SUCCESS" && (
            <button className="btn" style={{ marginTop: 10 }} disabled={!!busy} onClick={unwrapAndBuy}>
              Unwrap and buy {cert.symbol}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
