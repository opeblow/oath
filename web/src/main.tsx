import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ToastProvider } from "./lib/toast";
import { WalletProvider } from "./lib/wallet";
import { Landing } from "./pages/Landing";
import "./styles.css";
import "./pages/pages.css";

const Registry = lazy(() => import("./pages/Registry"));
const Launch = lazy(() => import("./pages/Launch"));
const Coin = lazy(() => import("./pages/Coin"));
const Watch = lazy(() => import("./pages/Watch"));
const How = lazy(() => import("./pages/How"));
const Agents = lazy(() => import("./pages/Agents"));
const NotFound = lazy(() => import("./pages/NotFound"));

function Loading() {
  return (
    <div className="wrap section-tight">
      <div className="skeleton" style={{ height: 320 }} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <WalletProvider>
        <BrowserRouter>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Landing />} />
                <Route path="coins" element={<Registry />} />
                <Route path="launch" element={<Launch />} />
                <Route path="coin/:id" element={<Coin />} />
                <Route path="watch" element={<Watch />} />
                <Route path="how" element={<How />} />
                <Route path="agents" element={<Agents />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </WalletProvider>
    </ToastProvider>
  </StrictMode>,
);
