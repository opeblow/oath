import { Link } from "react-router-dom";
import { CertificateCard, type CertificateModel } from "../components/CertificateCard";
import { Rosette } from "../components/Engraving";
import { CoinRow } from "../components/CoinRow";
import { coin, factory } from "../lib/near";
import { certificateModel } from "../lib/model";
import { near } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const SPECIMEN: CertificateModel = {
  id: "specimen",
  name: "Specimen Coin",
  symbol: "SPEC",
  manifesto: "This is what a buyer sees before buying: every promise, its status, and what is at stake.",
  creator: "creator.testnet",
  oathTitles: ["Liquidity is locked", "Creator tokens vest", "Snipers are capped", "The fee is fixed", "The treasury has rules", "Show up every 1 week"],
  facts: [
    { label: "Oaths", value: "6", sub: "1 bonded" },
    { label: "Bond at stake", value: "5.00", sub: "NEAR" },
    { label: "Locked liquidity", value: "0.00", sub: "NEAR" },
    { label: "Sold", value: "0.0%", sub: "0 holders" },
  ],
};

const BETRAYALS = [
  {
    n: "I",
    what: "The rug",
    usual: "The team pulls the liquidity pool and the price goes to zero in one block.",
    oath: "Liquidity lives in the coin's own contract, which has no withdraw method and no keys. It only leaves when holders sell.",
  },
  {
    n: "II",
    what: "The team dump",
    usual: "Insiders get a big allocation and sell it into the first wave of buyers.",
    oath: "The creator allocation is capped at 10% and vests on a schedule the contract enforces on every transfer.",
  },
  {
    n: "III",
    what: "The snipe",
    usual: "Bots and insiders buy most of the supply in the first seconds.",
    oath: "During the launch window no wallet may exceed a set share of supply, and the creator cannot buy at all.",
  },
  {
    n: "IV",
    what: "The broken roadmap",
    usual: "Promises live in a tweet. Breaking them costs nothing.",
    oath: "Promises are bonded with NEAR. Break one and anyone can enforce it: the bond is paid to holders.",
  },
];

export function Landing() {
  const latest = useAsync(async () => {
    const coins = await factory.coins(0, 7);
    const featured = coins[0] ? await coin.certificate(coins[0].coin_id).catch(() => null) : null;
    return { coins, featured };
  }, [], 30_000);
  const count = useAsync(() => factory.count(), []);

  const model = latest.data?.featured ? certificateModel(latest.data.featured) : SPECIMEN;
  const totalBond = (latest.data?.coins ?? []).reduce((a, c) => a + BigInt(c.bond), 0n);

  return (
    <>
      <section className="hero">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">A memecoin launchpad on NEAR</div>
            <h1>
              A memecoin that
              <br />
              keeps its <em>word.</em>
            </h1>
            <p className="lede">
              On OATH, a creator's promises are contract rules. The ones code can prevent are impossible to break. The rest are backed by a bond
              that is paid to holders the moment a promise is broken.
            </p>
            <div className="hero-ctas">
              <Link to="/launch" className="btn">Launch a coin</Link>
              <Link to="/coins" className="btn btn-ghost">Read the registry</Link>
            </div>
            <dl className="hero-stats">
              <div>
                <dt>Coins sworn</dt>
                <dd className="num">{count.data ?? "-"}</dd>
              </div>
              <div>
                <dt>Bonded, recent</dt>
                <dd className="num">{near(totalBond, 2)} <span className="unit">NEAR</span></dd>
              </div>
              <div>
                <dt>Admin keys</dt>
                <dd className="num">0</dd>
              </div>
            </dl>
          </div>
          <div className="hero-cert">
            {latest.data?.featured ? (
              <Link to={`/coin/${latest.data.featured.contract_id}`} className="hero-cert-link" aria-label="Open the latest certificate">
                <CertificateCard model={model} compact />
              </Link>
            ) : (
              <CertificateCard model={model} compact />
            )}
            <div className="hero-cert-caption small muted">
              {latest.data?.featured ? "Latest coin, read live from NEAR testnet." : latest.loading ? "Reading the chain..." : "Specimen. No coins yet."}
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Why buyers do not trust memecoins</div>
            <h2>Four betrayals, four rules.</h2>
            <p className="lede">Every rug follows one of four scripts. OATH turns each one into something the contract will not execute.</p>
          </div>
          <div className="betrayals">
            {BETRAYALS.map((b) => (
              <div className="betrayal" key={b.n}>
                <div className="betrayal-n">{b.n}</div>
                <div>
                  <h3>{b.what}</h3>
                  <p className="betrayal-usual"><span className="eyebrow">Usually</span> {b.usual}</p>
                  <p className="betrayal-oath"><span className="eyebrow">On OATH</span> {b.oath}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section ink-band">
        <div className="wrap grid-2 band-grid">
          <div className="section-head" style={{ marginBottom: 0 }}>
            <div className="eyebrow">Bonded oaths</div>
            <h2>A broken promise pays the holders.</h2>
            <p className="lede">
              Some promises cannot be forced, like showing up every week or adding to the floor. So the creator stakes NEAR on them. Miss one,
              and anyone can enforce it.
            </p>
            <div><Link to="/watch" className="btn btn-seal">Watch and earn</Link></div>
          </div>
          <ol className="steps">
            <li>
              <span className="step-n">1</span>
              <div>
                <h3>The creator swears and stakes</h3>
                <p>At launch, each bonded oath locks part of the creator's NEAR bond inside the coin contract.</p>
              </div>
            </li>
            <li>
              <span className="step-n">2</span>
              <div>
                <h3>The chain keeps time</h3>
                <p>A missed update or an unpaid top-up is visible to everyone. No oracle, no committee, no opinion.</p>
              </div>
            </li>
            <li>
              <span className="step-n">3</span>
              <div>
                <h3>Anyone enforces, holders get paid</h3>
                <p>The enforcer gets 5% of the stake. The other 95% goes to holders in proportion to what they hold. The creator gets nothing.</p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Verify, do not trust</div>
            <h2>Four checks on every certificate.</h2>
            <p className="lede">The app re-reads the chain each time you open a coin. If a check fails, the certificate says so.</p>
          </div>
          <div className="checks">
            <div className="check"><span className="check-mark">0</span><h3>Access keys</h3><p>The coin account has no keys. Nobody can upgrade the code or move the funds by hand.</p></div>
            <div className="check"><span className="check-mark mono">#</span><h3>Code hash</h3><p>The coin runs the published OATH code, pinned by hash as a NEAR global contract.</p></div>
            <div className="check"><span className="check-mark">=</span><h3>Solvency</h3><p>Contract balance covers the reserve, treasury, bond and unclaimed payouts, to the yoctoNEAR.</p></div>
            <div className="check"><span className="check-mark">R</span><h3>Registry</h3><p>The coin was created by the OATH factory, not copied by an imitator.</p></div>
          </div>
        </div>
      </section>

      <section className="section built">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Built on NEAR</div>
            <h2>Four pieces of NEAR, each doing real work.</h2>
          </div>
          <div className="grid-3 grid-4">
            <div>
              <div className="eyebrow">NEAR Protocol</div>
              <h3>Sealed accounts</h3>
              <p>Each coin is a keyless sub-account running a global contract. Launching costs about half a NEAR because the code is stored once.</p>
            </div>
            <div>
              <div className="eyebrow">NEAR Intents</div>
              <h3>Buy from any chain</h3>
              <p>Pay with USDC on Base, SOL, BTC or 30+ chains. 1Click routes it to NEAR and the coin is bought in your name.</p>
            </div>
            <div>
              <div className="eyebrow">NEAR AI Cloud</div>
              <h3>A private auditor</h3>
              <p>Ask any coin a question. A model running in a secure enclave answers from the contract's own data, with a signed attestation.</p>
            </div>
            <div>
              <div className="eyebrow">OutLayer</div>
              <h3>Verifiable reviews</h3>
              <p>Oath reviews run as hash-pinned code in a TEE, and the result is written back to NEAR where anyone can check it.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section-tight">
        <div className="wrap">
          <div className="panel-title">
            <h2 style={{ fontSize: 36 }}>Recently sworn</h2>
            <Link to="/coins" className="btn-link">Full registry</Link>
          </div>
          {latest.data && latest.data.coins.length > 0 ? (
            <div className="coin-list">
              {latest.data.coins.slice(0, 6).map((c) => (
                <CoinRow key={c.coin_id} entry={c} />
              ))}
            </div>
          ) : (
            <div className="empty">{latest.loading ? "Reading the registry..." : "No coins yet. Be the first to swear."}</div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="wrap closing">
          <Rosette seed="closing" size={420} lines={20} opacity={0.35} />
          <div className="closing-copy">
            <h2>Say it. Seal it. Keep it.</h2>
            <p className="lede">Launching takes one transaction. Your promises become a certificate anyone can check, forever.</p>
            <Link to="/launch" className="btn btn-seal">Launch a coin</Link>
          </div>
        </div>
      </section>
    </>
  );
}
