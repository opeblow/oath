import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { explorerTx } from "./config";

interface Toast {
  id: number;
  title: string;
  body?: string;
  txHash?: string;
  error?: boolean;
}

interface ToastApi {
  ok: (title: string, body?: string, txHash?: string) => void;
  fail: (title: string, error: unknown) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
let nextId = 1;

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Something went wrong";
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = nextId++;
    setToasts((all) => [...all, { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.error ? 9000 : 7000);
  }, []);
  const api: ToastApi = {
    ok: (title, body, txHash) => push({ title, body, txHash }),
    fail: (title, error) => {
      const msg = errorText(error);
      if (/reject|cancel|closed/i.test(msg)) return push({ title: "Cancelled in wallet" });
      push({ title, body: msg, error: true });
    },
  };
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.error ? "err" : ""}`}>
            <div className="toast-title">{t.title}</div>
            {t.body && <div className="muted">{t.body}</div>}
            {t.txHash && (
              <a className="small mono" href={explorerTx(t.txHash)} target="_blank" rel="noreferrer">
                View transaction {t.txHash.slice(0, 10)}...
              </a>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
