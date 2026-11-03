import { useState } from "react";
import { errorText, useToast } from "./toast";
import { useWallet, type CallOptions, type CallResult } from "./wallet";

/** Send a contract call with wallet, toasts and a busy flag. */
export function useTx(onDone?: () => void) {
  const { call } = useWallet();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function send(label: string, opts: CallOptions, success?: (r: CallResult) => string): Promise<CallResult | null> {
    setBusy(label);
    try {
      const r = await call(opts);
      toast.ok(success ? success(r) : `${label}: done`, undefined, r.txHash);
      onDone?.();
      return r;
    } catch (e) {
      toast.fail(`${label} failed`, errorText(e));
      return null;
    } finally {
      setBusy(null);
    }
  }
  return { send, busy };
}
