// NEAR Intents 1Click client: buy from any chain.
// 1Click is mainnet-only. On testnet, OATH requests real dry-run quotes so buyers see exactly
// what a cross-chain purchase costs; execution is enabled when the app runs on mainnet.

import { config, ONECLICK_API } from "./config";

export interface IntentsToken {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  price: number;
}

export interface IntentsQuote {
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  amountOut: string;
  amountOutFormatted: string;
  timeEstimate: number;
  depositAddress?: string;
  deadline?: string;
}

export interface QuoteResponse {
  quote: IntentsQuote;
  signature: string;
  correlationId: string;
  timestamp: string;
}

export type SwapStatus =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "PROCESSING"
  | "SUCCESS"
  | "INCOMPLETE_DEPOSIT"
  | "REFUNDED"
  | "FAILED";

export const WNEAR = "nep141:wrap.near";

const POPULAR = new Set(["USDC", "USDT", "ETH", "BTC", "SOL", "ZEC", "DOGE", "XRP", "TRX", "BNB"]);

export const canExecuteIntents = config.network === "mainnet";

/** Mainnet account used for testnet dry-run quotes, which need a valid mainnet recipient. */
export const DRY_RUN_ACCOUNT = "oath-quote.near";

export async function intentsTokens(): Promise<IntentsToken[]> {
  const res = await fetch(`${ONECLICK_API}/tokens`);
  if (!res.ok) throw new Error(`1Click tokens ${res.status}`);
  const all = (await res.json()) as IntentsToken[];
  return all
    .filter((t) => POPULAR.has(t.symbol) && t.assetId !== WNEAR)
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.blockchain.localeCompare(b.blockchain));
}

export const chainLabel = (b: string) =>
  ({ eth: "Ethereum", base: "Base", arb: "Arbitrum", sol: "Solana", btc: "Bitcoin", near: "NEAR", bsc: "BNB Chain", op: "Optimism", pol: "Polygon", avax: "Avalanche", tron: "Tron", ton: "TON", zec: "Zcash", doge: "Dogecoin", xrp: "XRP Ledger", sui: "Sui", aptos: "Aptos", gnosis: "Gnosis", stellar: "Stellar" })[b] ?? b;

/**
 * Quote for receiving exactly `nearOut` yoctoNEAR (as wNEAR) on NEAR, paid with `originAsset`.
 * `dry: true` returns a signed quote without a deposit address.
 */
export async function quoteForNear(params: {
  originAsset: string;
  nearOut: string;
  recipient: string;
  /** NEAR account that receives refunds inside NEAR Intents if the swap cannot complete. */
  refundTo: string;
  dry: boolean;
  slippageBps?: number;
}): Promise<QuoteResponse> {
  const deadline = new Date(Date.now() + 30 * 60_000).toISOString();
  const body = {
    dry: params.dry,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: params.slippageBps ?? 100,
    originAsset: params.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: WNEAR,
    amount: params.nearOut,
    refundTo: params.refundTo,
    refundType: "INTENTS",
    recipient: params.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline,
  };
  const res = await fetch(`${ONECLICK_API}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message ?? `1Click quote failed (${res.status})`);
  return json as QuoteResponse;
}

export async function swapStatus(depositAddress: string): Promise<SwapStatus> {
  const res = await fetch(`${ONECLICK_API}/status?depositAddress=${encodeURIComponent(depositAddress)}`);
  if (!res.ok) throw new Error(`1Click status ${res.status}`);
  const json = await res.json();
  return json.status as SwapStatus;
}
