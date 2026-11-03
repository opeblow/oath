import { Link } from "react-router-dom";
import { config } from "../lib/config";

export default function How() {
  return (
    <div className="wrap">
      <header className="page-head">
        <div className="eyebrow">How it works</div>
        <h1>Promises as contract rules.</h1>
        <p className="lede">
          Most memecoin promises live in a tweet, so breaking one costs nothing. On OATH, each promise is either impossible to break or expensive to
          break. This page explains which is which, and how to check it yourself.
        </p>
      </header>

      <div className="prose">
        <h2>1. Every coin is its own sealed contract</h2>
        <p>
          When a creator launches, the factory <code>{config.factoryId}</code> creates a new account such as <code>dog.{config.factoryId}</code>, points it at
          the published OATH token code, and adds no access keys. With no keys, nobody can sign for that account: not the creator, not the OATH team.
          Nobody can redeploy the code or move funds by hand. The coin is permanently governed by its code.
        </p>
        <p>
          The code is a NEAR global contract with hash <code>{config.tokenCodeHash}</code>. Every coin page re-checks both facts live from the chain on
          its Verify tab.
        </p>

        <h2>2. Liquidity that cannot be pulled</h2>
        <p>
          Buying and selling happen on a bonding curve inside the coin contract. The NEAR you pay stays in that contract. There is no withdraw method,
          so the only way NEAR leaves the curve is when someone sells tokens back. A rug pull is not against the rules; it is not possible.
        </p>
        <p>
          The contract also tracks its own books. Its balance must always cover the curve reserve, the treasury, the creator's bond, unclaimed payouts
          and storage. The Verify tab shows this sum.
        </p>

        <h2>3. Sealed oaths: impossible to break</h2>
        <p>Five rules are fixed at launch and checked on every transaction:</p>
        <ul>
          <li><strong>Liquidity is locked.</strong> As above.</li>
          <li><strong>Creator tokens vest.</strong> At most 10% of supply. Nothing unlocks before the cliff, then it unlocks linearly. A transfer or sell that would dip below the locked amount fails.</li>
          <li><strong>Snipers are capped.</strong> During the launch window no wallet may hold more than a set share of supply, and the creator cannot buy.</li>
          <li><strong>The fee is fixed.</strong> Set once, capped at 2%, paid into the coin's treasury.</li>
          <li><strong>The treasury has rules.</strong> The creator can spend a fixed amount per period, only to accounts declared at launch, with a public memo each time.</li>
        </ul>

        <h2>4. Bonded oaths: expensive to break</h2>
        <p>
          Some promises are about the future, so code cannot prevent breaking them. For these, the creator deposits a bond of NEAR at launch and
          stakes it on each promise:
        </p>
        <ul>
          <li><strong>Show up.</strong> Post a public on-chain update at least every N days until a set date.</li>
          <li><strong>Add to the floor.</strong> Put X more NEAR into the curve by a deadline, which raises the price every holder can sell at.</li>
        </ul>
        <p>
          The contract knows the deadlines. Once one passes, the oath becomes enforceable by anyone. The person who calls <code>enforce</code> earns 5% of the
          stake. The other 95% is split between holders by balance (the creator is excluded), and each holder claims it from the coin page. The oath is
          marked Broken on the certificate forever.
        </p>
        <p>If the creator keeps the promise until its end date, the oath is marked Kept and the creator can reclaim that stake.</p>

        <h2>5. Watchers keep creators honest</h2>
        <p>
          Nobody has to trust OATH to enforce anything. The <Link to="/watch">Watch</Link> page scans every coin for broken oaths and deadlines. Bots and AI
          agents can do the same through the public view methods described on <Link to="/agents">For agents</Link>.
        </p>

        <h2>6. What OATH does not promise</h2>
        <ul>
          <li>The price can still fall. OATH removes betrayal, not risk.</li>
          <li>The wallet cap is a speed bump. One person can split buys across many wallets.</li>
          <li>Bonded oaths cover what a contract can observe: on-chain updates and deposits. Off-chain promises like "we will list on an exchange" are not enforceable here.</li>
        </ul>

        <h2>Check it yourself</h2>
        <p>Every claim above can be checked without trusting this website. For any coin:</p>
        <pre className="code">{`# 0 access keys means nobody can sign for the coin
near account list-keys <coin>.${config.factoryId} network-config ${config.network} now

# The code it runs
near account view-account-summary <coin>.${config.factoryId} network-config ${config.network} now

# Every rule, live
near contract call-function as-read-only <coin>.${config.factoryId} get_certificate json-args {} network-config ${config.network} now`}</pre>
        <p>
          The contracts are open source. <Link to="/launch">Launch a coin</Link> to see the full set of choices a creator makes.
        </p>
      </div>
    </div>
  );
}
