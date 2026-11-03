import { config } from "./config";
import type {
  Activity,
  BuyQuote,
  Certificate,
  CoinEntry,
  HolderView,
  SellQuote,
} from "./types";

let rpcIndex = 0;

async function rpc<T>(method: string, params: unknown): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < config.rpc.length; attempt++) {
    const url = config.rpc[(rpcIndex + attempt) % config.rpc.length];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "oath", method, params }),
      });
      if (!res.ok) throw new Error(`RPC ${res.status}`);
      const body = await res.json();
      if (body.error) {
        const cause = body.error?.cause?.info?.error_message ?? body.error?.data ?? body.error?.message;
        throw new RpcError(typeof cause === "string" ? cause : JSON.stringify(body.error));
      }
      rpcIndex = (rpcIndex + attempt) % config.rpc.length;
      return body.result as T;
    } catch (e) {
      lastError = e;
      if (e instanceof RpcError) throw e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("RPC unavailable");
}

export class RpcError extends Error {}

function toBase64(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

export async function view<T>(contractId: string, method: string, args: object = {}): Promise<T> {
  const result = await rpc<{ result: number[]; error?: string }>("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: contractId,
    method_name: method,
    args_base64: toBase64(JSON.stringify(args)),
  });
  if (result.error) throw new RpcError(result.error);
  const text = new TextDecoder().decode(new Uint8Array(result.result));
  return JSON.parse(text) as T;
}

export interface AccountState {
  amount: string;
  code_hash: string;
  global_contract_hash?: string | null;
  global_contract_account_id?: string | null;
  storage_usage: number;
}

export async function viewAccount(accountId: string): Promise<AccountState | null> {
  try {
    return await rpc<AccountState>("query", {
      request_type: "view_account",
      finality: "final",
      account_id: accountId,
    });
  } catch (e) {
    if (e instanceof RpcError && /does not exist|UNKNOWN_ACCOUNT/i.test(e.message)) return null;
    throw e;
  }
}

export async function viewAccessKeys(accountId: string): Promise<number> {
  const r = await rpc<{ keys: unknown[] }>("query", {
    request_type: "view_access_key_list",
    finality: "final",
    account_id: accountId,
  });
  return r.keys.length;
}

// ---------------------------------------------------------------- typed contract views

export const factory = {
  count: () => view<number>(config.factoryId, "get_coin_count"),
  coins: (from = 0, limit = 50) => view<CoinEntry[]>(config.factoryId, "get_coins", { from, limit }),
  coin: (coinId: string) => view<CoinEntry | null>(config.factoryId, "get_coin", { coin_id: coinId }),
  byCreator: (creator: string) => view<CoinEntry[]>(config.factoryId, "get_coins_by_creator", { creator }),
  launchCost: (bond: string) => view<string>(config.factoryId, "get_launch_cost", { bond }),
  codeHash: () => view<string>(config.factoryId, "get_token_code_hash"),
};

export const coin = {
  certificate: (id: string) => view<Certificate>(id, "get_certificate"),
  holder: (id: string, accountId: string) => view<HolderView>(id, "get_holder", { account_id: accountId }),
  quoteBuy: (id: string, nearIn: string, accountId?: string) =>
    view<BuyQuote>(id, "quote_buy", { near_in: nearIn, account_id: accountId ?? null }),
  quoteSell: (id: string, amount: string) => view<SellQuote>(id, "quote_sell", { amount }),
  activity: (id: string, from = 0, limit = 30) => view<Activity[]>(id, "get_activity", { from, limit }),
};

export interface Verification {
  accessKeys: number | null;
  globalHash: string | null;
  codeMatches: boolean;
  registered: boolean;
  solvent: boolean;
  checkedAt: number;
}

/** Everything the certificate claims about trust, re-checked from the chain. */
export async function verifyCoin(id: string, solvent: boolean): Promise<Verification> {
  const [keys, account, entry] = await Promise.all([
    viewAccessKeys(id).catch(() => null),
    viewAccount(id).catch(() => null),
    factory.coin(id).catch(() => null),
  ]);
  const globalHash = account?.global_contract_hash ?? null;
  return {
    accessKeys: keys,
    globalHash,
    codeMatches: globalHash === config.tokenCodeHash,
    registered: !!entry,
    solvent,
    checkedAt: Date.now(),
  };
}
