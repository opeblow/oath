import { NearConnector } from "@hot-labs/near-connect";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { config } from "./config";

export interface CallOptions {
  contractId: string;
  method: string;
  args?: object;
  /** yoctoNEAR */
  deposit?: string;
  /** gas units */
  gas?: string;
}

export interface CallResult {
  txHash: string;
  /** Parsed JSON return value of the function call, if any. */
  value: unknown;
}

interface WalletState {
  accountId: string | null;
  ready: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  call: (o: CallOptions) => Promise<CallResult>;
}

const WalletContext = createContext<WalletState | null>(null);

let connectorSingleton: NearConnector | null = null;
function getConnector(): NearConnector {
  if (!connectorSingleton) {
    connectorSingleton = new NearConnector({
      network: config.network,
      features: config.network === "testnet" ? { testnet: true } : {},
      footerBranding: null,
      autoConnect: true,
    });
  }
  return connectorSingleton;
}

const DEFAULT_GAS = "100000000000000"; // 100 Tgas

interface Outcome {
  transaction?: { hash?: string };
  transaction_outcome?: { id?: string };
  status?: { SuccessValue?: string; Failure?: unknown };
}

function parseOutcome(raw: unknown): CallResult {
  const o = (Array.isArray(raw) ? raw[0] : raw) as Outcome | undefined;
  const txHash = o?.transaction?.hash ?? o?.transaction_outcome?.id ?? "";
  if (o?.status && "Failure" in o.status && o.status.Failure) {
    throw new Error(failureMessage(o.status.Failure));
  }
  let value: unknown = null;
  const sv = o?.status?.SuccessValue;
  if (sv) {
    try {
      value = JSON.parse(atob(sv));
    } catch {
      value = null;
    }
  }
  return { txHash, value };
}

function failureMessage(f: unknown): string {
  const text = JSON.stringify(f);
  const m = text.match(/Smart contract panicked: ([^"\\]+)/) ?? text.match(/"ExecutionError":"([^"]+)"/);
  return m ? m[1] : "The transaction failed";
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const c = getConnector();
    const onIn = (t: { accounts: { accountId: string }[] }) => setAccountId(t.accounts[0]?.accountId ?? null);
    const onOut = () => setAccountId(null);
    c.on("wallet:signIn", onIn);
    c.on("wallet:signOut", onOut);
    c.getConnectedWallet()
      .then(({ accounts }) => setAccountId(accounts[0]?.accountId ?? null))
      .catch(() => setAccountId(null))
      .finally(() => setReady(true));
    return () => {
      c.off("wallet:signIn", onIn);
      c.off("wallet:signOut", onOut);
    };
  }, []);

  const connect = useCallback(async () => {
    await getConnector().connect();
  }, []);

  const disconnect = useCallback(async () => {
    await getConnector().disconnect();
    setAccountId(null);
  }, []);

  const call = useCallback(
    async ({ contractId, method, args = {}, deposit = "0", gas = DEFAULT_GAS }: CallOptions) => {
      const c = getConnector();
      if (!accountId) {
        await c.connect();
      }
      const wallet = await c.wallet();
      const raw = await wallet.signAndSendTransaction({
        receiverId: contractId,
        actions: [{ type: "FunctionCall", params: { methodName: method, args, gas, deposit } }],
      });
      return parseOutcome(raw);
    },
    [accountId],
  );

  const value = useMemo(() => ({ accountId, ready, connect, disconnect, call }), [accountId, ready, connect, disconnect, call]);
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
