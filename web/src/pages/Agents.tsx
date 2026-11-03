import { config } from "../lib/config";

const VIEWS: [string, string, string][] = [
  ["get_coin_count", "{}", "Number of coins in the factory"],
  ["get_coins", '{"from":0,"limit":50}', "Registry page: coin id, creator, symbol, bond"],
  ["get_coins_by_creator", '{"creator":"alice.testnet"}', "Every coin a creator launched"],
];

const COIN_VIEWS: [string, string, string][] = [
  ["get_certificate", "{}", "All rules, oath statuses, curve state and accounting"],
  ["get_holder", '{"account_id":"bob.testnet"}', "Balance, vesting lock and claimable payouts"],
  ["quote_buy", '{"near_in":"1000000000000000000000000","account_id":null}', "Tokens out for a NEAR amount"],
  ["quote_sell", '{"amount":"1000000000000000000"}', "NEAR out for a token amount"],
  ["get_activity", '{"from":0,"limit":30}', "Latest events, newest first"],
];

const CALLS: [string, string, string][] = [
  ["enforce", '{"index":0}', "Enforce a broken bonded oath. Pays the caller 5% of its stake."],
  ["claim", "{}", "Claim payouts from enforced oaths"],
  ["buy", '{"min_tokens_out":"0"}', "Attach NEAR to buy"],
  ["sell", '{"amount":"...","min_near_out":"0"}', "Attach 1 yoctoNEAR"],
];

function Table({ rows }: { rows: [string, string, string][] }) {
  return (
    <table className="ledger" style={{ margin: "12px 0 8px" }}>
      <thead>
        <tr><th>Method</th><th>Arguments</th><th>Returns or does</th></tr>
      </thead>
      <tbody>
        {rows.map(([m, a, d]) => (
          <tr key={m}><td className="mono">{m}</td><td className="mono small" style={{ overflowWrap: "anywhere" }}>{a}</td><td>{d}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Agents() {
  const rpc = config.rpc[0];
  return (
    <div className="wrap">
      <header className="page-head">
        <div className="eyebrow">For agents</div>
        <h1>Built to be read by machines.</h1>
        <p className="lede">
          Every rule and status on OATH is a public contract view. An agent can audit a coin before buying, watch deadlines, and enforce broken oaths for
          the bounty, with no API key and no OATH server in the way.
        </p>
      </header>

      <div className="prose">
        <h2>Factory</h2>
        <p>Contract <code>{config.factoryId}</code> on NEAR {config.network}.</p>
        <Table rows={VIEWS} />

        <h2>Each coin</h2>
        <p>Every coin is an account like <code>dog.{config.factoryId}</code> running the same code.</p>
        <Table rows={COIN_VIEWS} />
        <h3>Calls anyone can make</h3>
        <Table rows={CALLS} />

        <h2>Read a coin with one HTTP request</h2>
        <p>Arguments are base64 JSON. This reads the certificate of <code>first.{config.factoryId}</code>:</p>
        <pre className="code">{`curl -s ${rpc} -H 'Content-Type: application/json' -d '{
  "jsonrpc": "2.0", "id": "oath", "method": "query",
  "params": {
    "request_type": "call_function", "finality": "optimistic",
    "account_id": "first.${config.factoryId}",
    "method_name": "get_certificate", "args_base64": "e30="
  }
}' | jq -r '.result.result | implode | fromjson'`}</pre>

        <h2>A watcher loop</h2>
        <p>The whole enforcement bot fits in a few lines. Any bonded oath with status <code>breakable</code> can be enforced right now:</p>
        <pre className="code">{`for each coin in get_coins(0, 50):
  cert = coin.get_certificate()
  for oath in cert.bonded:
    if oath.status == "breakable":
      call coin.enforce({ index: oath.index })   # earns 5% of oath.stake`}</pre>

        <h2>Rules worth knowing</h2>
        <ul>
          <li>Amounts are strings: NEAR in yoctoNEAR (24 decimals), tokens with 18 decimals.</li>
          <li>Times are nanoseconds since the Unix epoch.</li>
          <li>Status values: <code>active</code>, <code>breakable</code>, <code>broken</code>, <code>kept</code>.</li>
          <li>The contract emits NEP-297 events with standard <code>oath</code> for launch, buy, sell, floor, heartbeat, treasury_spend, reclaim, enforce and claim.</li>
          <li>Trust checks an agent should repeat: the coin account has zero access keys and its global contract hash equals <code>{config.tokenCodeHash}</code>.</li>
        </ul>
      </div>
    </div>
  );
}
