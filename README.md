# OATH

**Memecoins that keep their word.** OATH is a memecoin launchpad on NEAR where a creator's promises are contract rules. The promises code can prevent are impossible to break. The rest are backed by a bond that anyone can enforce, and the bond is paid to holders.

Built at NEAR HACKATHON 2026 for the `memecoins` track.

[![CI](https://github.com/opeblow/oath/actions/workflows/ci.yml/badge.svg)](https://github.com/opeblow/oath/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)
[![Network: NEAR testnet](https://img.shields.io/badge/NEAR-testnet-black.svg)](https://testnet.nearblocks.io/address/oathcoin.testnet)

**Live app:** https://oath-near.vercel.app  
**Factory:** [`oathcoin.testnet`](https://testnet.nearblocks.io/address/oathcoin.testnet)  
**Token code (global contract hash):** `DjVgSpu5TjKGe4BDjmLpQGGpLB5d7U1xRjSCoLsouKmi`

![Coin certificate](docs/screenshots/coin.png)

## Contents

- [The problem](#the-problem)
- [What OATH does](#what-oath-does)
- [Try it in five minutes, no funds needed](#try-it-in-five-minutes-no-funds-needed)
- [Try it with a testnet wallet](#try-it-with-a-testnet-wallet)
- [Use it from an AI agent (MCP)](#use-it-from-an-ai-agent-mcp)
- [How it works](#how-it-works)
- [Repository layout](#repository-layout)
- [Run it locally](#run-it-locally)
- [Tests](#tests)
- [Limits and honest caveats](#limits-and-honest-caveats)
- [License](#license)

## The problem

Memecoin buyers get rugged in four ways: the team pulls the liquidity, insiders dump a large allocation, bots snipe the launch, and roadmap promises are forgotten. Each promise lives in a tweet, so breaking it costs nothing.

## What OATH does

Every coin is its own contract with **no access keys**, so nobody (not the creator, not OATH) can change its code or move its funds by hand. At launch the creator swears two kinds of oaths:

| Sealed oaths: impossible to break | Bonded oaths: expensive to break |
| --- | --- |
| Liquidity is locked in a bonding curve with no withdraw method | Post a public on-chain update every N days |
| Creator tokens (max 10%) vest on a cliff and schedule | Add X NEAR to the liquidity floor by a deadline |
| No wallet may exceed a set share during the launch window; the creator cannot buy | |
| The trade fee is fixed (max 2%) | |
| The treasury pays only declared accounts, within a per-period limit, with a public memo | |

Bonded oaths are backed by NEAR the creator stakes at launch. When a deadline passes, **anyone** can call `enforce`: the enforcer earns 5% of the stake and 95% is split across holders by balance. A kept oath returns the stake to the creator. No committee decides; the contract checks the clock.

## Try it in five minutes, no funds needed

All of these read live from NEAR testnet.

1. **Open the registry.** Go to https://oath-near.vercel.app/coins. You see every coin with its oath status, bond at stake and locked liquidity.
2. **See a kept promise.** Open [Kept Word ($KEPT)](https://oath-near.vercel.app/coin/kept.oathcoin.testnet). On the **Oaths** tab, oath 6 reads **Kept**: the creator added 1 NEAR to the floor and reclaimed the stake.
3. **See a broken promise.** Open [First Oath ($FIRST)](https://oath-near.vercel.app/coin/first.oathcoin.testnet). Its creator promised a daily update and missed it on 3 Nov 2026. The oath reads **Broken**, the **Activity** tab shows who enforced it, and "Paid to holders" shows the stake that went to holders.
4. **Verify without trusting us.** On any coin, open **Verify**. The page reads the chain directly and shows zero access keys, the global code hash, factory registration and a solvency check.
5. **Read the audit.** Open **Audit** for a grade from A to D. The same rules run in a WASI program on NEAR OutLayer ([auditor/](auditor)).
6. **Ask the auditor.** Open **Ask the auditor** and click a suggested question. A model on NEAR AI Cloud answers inside a TEE. The server checks four things before showing the answer, and the page lists each one: the request and response hashes match the signed text, the signature recovers to the enclave key, that key is in the model's attestation report, and the report is bound to a fresh nonce.
7. **Read a coin with one HTTP request:**
   ```bash
   curl -s https://rpc.testnet.fastnear.com -H 'Content-Type: application/json' -d '{
     "jsonrpc":"2.0","id":"oath","method":"query",
     "params":{"request_type":"call_function","finality":"optimistic",
       "account_id":"kept.oathcoin.testnet","method_name":"get_certificate","args_base64":"e30="}}' \
     | jq -r '.result.result | implode | fromjson | .bonded'
   ```
   You see the bonded oath with `"status": "kept"` and `"reclaimed": true`.
8. **Check the keys yourself:**
   ```bash
   near account list-keys kept.oathcoin.testnet network-config testnet now
   ```
   The list is empty.

## Try it with a testnet wallet

Get free testnet NEAR from the [faucet](https://near-faucet.io), then connect a wallet such as Meteor or HOT on the site.

1. **Buy.** On a coin page, enter 0.2 NEAR and press **Buy**. The quote shows tokens out, the fee and a 1% slippage guard. Your balance appears under **Your position**.
2. **Sell.** Switch to **Sell** and press **Max**. NEAR returns from the locked reserve.
3. **Launch a coin.** Go to **Launch**. Fill in four steps and watch the certificate preview update. One transaction creates the coin, deposits the bond and seals the oaths. You land on your certificate with the wax seal stamped.
4. **Keep a promise.** As the creator, the **Creator desk** on your coin page lets you post an update, add to the floor and spend the treasury within its rules.
5. **Enforce one.** **Watch and earn** lists every broken oath across all coins. Press **Enforce** to earn 5% of the stake. Holders then press **Claim** on the coin page.

## Use it from an AI agent (MCP)

The [mcp/](mcp) package is an MCP server with nine tools: `list_coins`, `get_coin`, `verify_coin`, `audit_coin`, `find_enforceable`, `quote`, `get_holder`, `get_activity` and `enforce_oath`.

```bash
cd mcp && npm install && npm run build
```

Add it to Claude Code, Claude Desktop or any MCP client:

```json
{ "mcpServers": { "oath": { "command": "node", "args": ["/path/to/oath/mcp/dist/server.js"] } } }
```

Then ask: *"Is kept.oathcoin.testnet safe to buy? Verify it and audit it."* or *"Are there any OATH oaths I can enforce right now?"*

`enforce_oath` and the watcher bot sign only when `NEAR_ACCOUNT_ID` and `NEAR_PRIVATE_KEY` are set (see `mcp/.env.example`).

**Watcher bot.** It scans every coin and enforces broken oaths for the bounty:

```bash
node --env-file=.env dist/watch.js --interval 60    # or --once, or --dry-run
```

The broken oath on `first.oathcoin.testnet` was enforced by this bot.

## How it works

```
creator ──create_coin(bond)──> factory oathcoin.testnet
                                  │ creates <name>.oathcoin.testnet
                                  │ uses the global token code, adds NO access key
                                  v
buyers ──buy / sell──> coin contract ──holds── curve reserve, treasury, bond, payouts
watchers ──enforce──>      │          5% bounty ──> watcher
holders ──claim────>       │          95% of stake ──> holders, by balance
                           v
            web app / MCP / watcher read get_certificate over public RPC
```

- **Contracts** ([contracts/](contracts)): Rust, near-sdk 5.30. The token is NEP-141/145/148 with NEP-297 events (standard `oath`). The factory deploys each coin from a NEAR global contract, so every coin provably runs the same code.
- **Solvency** is tracked in the contract: balance must cover reserve + treasury + bond + unclaimed payouts + storage, and `get_certificate` reports it.
- **Web** ([web/](web)): Vite, React, TypeScript. Wallets through `@hot-labs/near-connect`. No backend is needed to read or trade.
- **NEAR AI** ([web/api/](web/api)): one serverless function for the attested auditor.
- **NEAR OutLayer** ([auditor/](auditor)): the audit as a `wasm32-wasip1` program. `mcp/dist/outlayer.js <coin>` runs it on `outlayer.testnet` and the result lands in the transaction outcome.
- **NEAR Intents**: the **Any chain** tab fetches live signed 1Click quotes for buying with tokens on other chains. 1Click is mainnet-only, so execution is disabled on this testnet build.

More detail: [docs/SPEC.md](docs/SPEC.md) and the in-app [How it works](https://oath-near.vercel.app/how) page.

## Repository layout

| Path | What |
| --- | --- |
| `contracts/token` | The coin contract: curve, oaths, vesting, treasury, payouts |
| `contracts/factory` | Creates keyless coin accounts on the global token code |
| `contracts/sandbox-tests` | End-to-end tests on a local NEAR sandbox |
| `web` | The web app and the `/api/ask` function |
| `mcp` | MCP server, watcher bot, OutLayer runner |
| `auditor` | The WASI auditor for OutLayer, plus parity fixtures |
| `docs` | Spec and screenshots |

## Run it locally

Requirements: Node 20+. Rust and `cargo-near` only if you build the contracts.

```bash
cd web
npm install
cp .env.example .env    # optional: NEAR_AI_API_KEY enables "Ask the auditor"
npm run dev             # http://localhost:5173, reads testnet
```

Contracts:

```bash
cd contracts/token && cargo near build non-reproducible-wasm
cd ../factory && cargo near build non-reproducible-wasm
```

## Tests

| Suite | Command | Covers |
| --- | --- | --- |
| Contract unit tests (31) | `cd contracts && cargo test` | Curve math, oaths, vesting, treasury, payouts, factory checks |
| Sandbox end-to-end (7) | `cd contracts/sandbox-tests && npm install && npm test` | Global code publish, keyless launch, trading, sealed rules, kept and broken oaths, enforce, claim |
| Web (6) | `cd web && npm test` | Audit rules on a live certificate, time formatting |
| MCP (6) | `cd mcp && npm test` | Every tool against testnet over stdio |
| Auditor parity (7) | `cd auditor && cargo build --release && parity/check.sh` | WASI auditor gives the same grade and findings as the web |
| Browser smoke | `cd web && node scripts/smoke.mjs` | Every page at desktop and phone width, no console errors, no sideways scroll |

CI runs all of them on every push.

## Limits and honest caveats

- The price can still fall. OATH removes betrayal, not risk.
- The wallet cap is a speed bump: one person can split buys across wallets.
- Bonded oaths cover what a contract can observe: on-chain updates and deposits. Off-chain promises are not enforceable here.
- Testnet only. Cross-chain buying through NEAR Intents shows real quotes but executes only on mainnet.

## License

[MIT](LICENSE)
