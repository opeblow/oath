import { useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { config } from "../lib/config";
import { shortAccount } from "../lib/format";
import { useWallet } from "../lib/wallet";
import { Seal } from "./Seal";

export function Layout() {
  const { accountId, connect, disconnect, ready } = useWallet();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <>
      <a className="sr-only" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="wrap">
          <Link to="/" className="brand" aria-label="OATH home">
            <Seal size={30} mark="O" text="  " />
            <span className="brand-word">OATH</span>
          </Link>
          <nav className={`nav ${open ? "open" : ""}`} aria-label="Main">
            <NavLink to="/coins">Registry</NavLink>
            <NavLink to="/launch">Launch</NavLink>
            <NavLink to="/watch">Watch and earn</NavLink>
            <NavLink to="/how">How it works</NavLink>
            <NavLink to="/agents">For agents</NavLink>
          </nav>
          <div className="header-right">
            <span className="net-tag" title="Network">{config.network}</span>
            {ready && accountId ? (
              <button className="btn btn-ghost btn-sm mono" onClick={() => disconnect()} title="Disconnect">
                {shortAccount(accountId, 20)}
              </button>
            ) : (
              <button className="btn btn-sm" onClick={() => connect()}>Connect wallet</button>
            )}
            <button className="btn btn-ghost btn-sm menu-btn" aria-expanded={open} aria-label="Menu" onClick={() => setOpen(!open)}>
              Menu
            </button>
          </div>
        </div>
      </header>
      <main id="main">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="wrap footer-grid">
          <div>
            <div className="brand" style={{ marginBottom: 12 }}>
              <Seal size={26} mark="O" text="  " />
              <span className="brand-word" style={{ fontSize: 22 }}>OATH</span>
            </div>
            <p className="muted small" style={{ maxWidth: 320 }}>
              Memecoins that keep their word. Every promise is a contract rule on NEAR. OATH never holds your keys or your money.
            </p>
          </div>
          <div>
            <h4>Product</h4>
            <ul>
              <li><Link to="/coins">Registry</Link></li>
              <li><Link to="/launch">Launch a coin</Link></li>
              <li><Link to="/watch">Watch and earn</Link></li>
            </ul>
          </div>
          <div>
            <h4>Learn</h4>
            <ul>
              <li><Link to="/how">How it works</Link></li>
              <li><Link to="/agents">Agents and MCP</Link></li>
              <li><a href="https://github.com/opeblow/oath" target="_blank" rel="noreferrer">Source code</a></li>
            </ul>
          </div>
          <div>
            <h4>Contracts</h4>
            <ul className="mono small">
              <li><a href={`${config.explorer}/address/${config.factoryId}`} target="_blank" rel="noreferrer">{config.factoryId}</a></li>
              <li title={config.tokenCodeHash}>code {config.tokenCodeHash.slice(0, 10)}...</li>
            </ul>
          </div>
        </div>
      </footer>
    </>
  );
}
