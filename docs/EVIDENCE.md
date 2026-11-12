# OATH evidence

Every claim in the [README](../README.md) is listed here with a link or a command that checks it. Nothing on this page needs a wallet, an API key or testnet funds.

All values were read from NEAR testnet on 12 Nov 2026. Commands use `curl`, `jq` and, where noted, the [`near` CLI](https://github.com/near/near-cli-rs).

## Status of each part

| Part | Status | Network |
| --- | --- | --- |
| Factory and token contracts | Live | NEAR testnet |
| Two demo coins, `$KEPT` and `$FIRST` | Live | NEAR testnet |
| Trading, vesting, treasury rules, bonded oaths, enforcement, payouts | Live | NEAR testnet |
| Web app at https://oath-near.vercel.app | Live | Reads testnet |
| Watcher bot | Live, every 20 minutes on GitHub Actions | NEAR testnet |
| MCP server (9 tools) | Live, runs locally over stdio | Reads testnet |
| AI auditor with TEE verification | Live | NEAR AI Cloud |
| OutLayer audit | Live, one recorded transaction | NEAR testnet |
| NEAR Intents cross-chain buy | Quotes only. 1Click has no testnet, so nothing executes | Mainnet quotes |
| Mainnet deployment | Not available | - |
| Third-party security audit | Not available | - |
| Time-dependent unit tests | Simulated clock (near-sdk mocked VM) | Local |
| End-to-end tests | Real nearcore 2.14 sandbox, real 65 second waits | Local sandbox |

## 1. Addresses

| What | Account | Explorer |
| --- | --- | --- |
| Factory | `oathcoin.testnet` | [link](https://testnet.nearblocks.io/address/oathcoin.testnet) |
| Publisher of the token code | `oathcode.testnet` (also the watcher bot) | [link](https://testnet.nearblocks.io/address/oathcode.testnet) |
| Coin with a kept oath | `kept.oathcoin.testnet` | [link](https://testnet.nearblocks.io/address/kept.oathcoin.testnet) |
| Coin with a broken oath | `first.oathcoin.testnet` | [link](https://testnet.nearblocks.io/address/first.oathcoin.testnet) |
| Creator of both demo coins | `oathdemo.testnet` | [link](https://testnet.nearblocks.io/address/oathdemo.testnet) |
| Demo holder | `oathbuyer.testnet` | [link](https://testnet.nearblocks.io/address/oathbuyer.testnet) |

Both demo coins were created by the project's own accounts to demonstrate the two outcomes. They are demonstrations, not organic usage.

## 2. One published code hash

The token code is a NEAR global contract with hash `DjVgSpu5TjKGe4BDjmLpQGGpLB5d7U1xRjSCoLsouKmi`.

- Published in [`AYUEwJyL...`](https://testnet.nearblocks.io/txns/AYUEwJyLxmAhe5CJFEU6ufJaWHrudZFhbBxfCDDDBa5D) (`DEPLOY_GLOBAL_CONTRACT` by `oathcode.testnet`, 2 Nov 2026 23:04 UTC).
- The factory stores this hash at initialisation and has no method to change it ([`contracts/factory/src/lib.rs`](../contracts/factory/src/lib.rs)).

```bash
RPC=https://rpc.testnet.fastnear.com
view() { curl -s $RPC -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"e30=\"}}" | jq -r '.result.result | implode | fromjson'; }
account() { curl -s $RPC -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"$1\",\"finality\":\"final\",\"account_id\":\"$2\"}}" | jq .result; }

view oathcoin.testnet get_token_code_hash
# "DjVgSpu5TjKGe4BDjmLpQGGpLB5d7U1xRjSCoLsouKmi"

account view_account kept.oathcoin.testnet  | jq -r .global_contract_hash
account view_account first.oathcoin.testnet | jq -r .global_contract_hash
# DjVgSpu5TjKGe4BDjmLpQGGpLB5d7U1xRjSCoLsouKmi   (both)
```

The later commands on this page reuse `view` and `account`.

## 3. Zero access keys

```bash
for a in oathcoin.testnet kept.oathcoin.testnet first.oathcoin.testnet; do
  echo "$a: $(account view_access_key_list $a | jq '.keys | length') keys"
done
# oathcoin.testnet: 0 keys
# kept.oathcoin.testnet: 0 keys
# first.oathcoin.testnet: 0 keys
```

- Coins never had a key. The factory creates each one in a single batch (create account, fund storage, use global code, call `new`) that contains no `add_key` action.
- The factory had one deployment key. It was deleted in [`A4nuSsLe...`](https://testnet.nearblocks.io/txns/A4nuSsLeQYRDbUW7swhHXwGJBwFXGBfXBk6TyuPmR9AK) (`DELETE_KEY`, 3 Nov 2026 10:52 UTC). Since then nobody can redeploy the factory or change how coins are made.

With the `near` CLI: `near account list-keys kept.oathcoin.testnet network-config testnet now`.

## 4. `$KEPT`: a promise that was kept

Oath: *add 1 NEAR to the liquidity floor*, with 1 NEAR staked on it.

| Step | Time (UTC, 3 Nov 2026) | Transaction |
| --- | --- | --- |
| Launch with a 1 NEAR bond | 09:44:11 | [`7k3Hn9gV...`](https://testnet.nearblocks.io/txns/7k3Hn9gVooq7ecHY86SiU9ZPgEbPBvmrA5MpA6APsaEQ) |
| A holder buys | 09:44:33 | [`7PBs1mfz...`](https://testnet.nearblocks.io/txns/7PBs1mfz4ZpA5JTSr8uF8B4rmbnHKmpr8ZoeGs3icXbj) |
| Creator adds 1 NEAR to the floor | 09:44:37 | [`4JYKCk6b...`](https://testnet.nearblocks.io/txns/4JYKCk6bBR53p8XRMENsvvmo2WTKY5nVx9fMknGZRuKE) |
| Creator takes the 1 NEAR stake back | 09:44:41 | [`GmC1YE3H...`](https://testnet.nearblocks.io/txns/GmC1YE3HkSKFgoaJ8uShXCoQ4ksUSLAwDFdhVpWjSrU6) |

```bash
view kept.oathcoin.testnet get_certificate | jq '{oath: .bonded[0] | {kind, status, reclaimed, deposited}, bond_locked, floor_added: .curve.floor_added}'
# { "oath": { "kind": "floor_top_up", "status": "kept", "reclaimed": true,
#             "deposited": "1000000000000000000000000" },
#   "bond_locked": "0", "floor_added": "1000000000000000000000000" }
```

## 5. `$FIRST`: a promise that was broken, enforced and paid out

Oath: *post an update every 1 day*, with 1 NEAR staked on it. The creator never posted one.

| Step | Time (UTC) | Transaction |
| --- | --- | --- |
| Launch with a 1 NEAR bond | 2 Nov 23:05:25 | [`3PWhvgCY...`](https://testnet.nearblocks.io/txns/3PWhvgCYkxQCosQY2tTZTM2Zh7q8RQNQeCgBfhyj3W86) |
| A holder buys with 0.5 NEAR | 2 Nov 23:05:56 | [`8Nd1hhFr...`](https://testnet.nearblocks.io/txns/8Nd1hhFrSmPAFRuvohnqe4tDD9CfjaZP3NiBwbyXBQFH) |
| First update due, none posted | 3 Nov 23:05:26 | - |
| **Enforcement** by the watcher bot `oathcode.testnet` | 3 Nov 23:35:30 | [`88bNY37J...`](https://testnet.nearblocks.io/txns/88bNY37JkfkdPLSUHZruLGDWeirLvGASxduNfDxP6zr2) |
| **Holder claim** by `oathbuyer.testnet` | 3 Nov 23:35:36 | [`4rAZzNT3...`](https://testnet.nearblocks.io/txns/4rAZzNT388pFpAL6CRVCfnRkuBVgPyWzL1nFK82B8Lce) |

The enforcement was signed by the watcher bot's account, `oathcode.testnet`, 30 minutes after the deadline. The creator had no way to stop it: `enforce` is open to any account.

Where the 1 NEAR stake went, in yoctoNEAR:

| Destination | Amount | Share |
| --- | --- | --- |
| Enforcer `oathcode.testnet` | `50000000000000000000000` (0.05 NEAR) | 5% |
| Holder `oathbuyer.testnet`, the only holder | `949999999999999999999999` | 95%, less 1 yoctoNEAR of rounding |
| Liquidity floor (rounding dust) | `1` | - |
| Creator `oathdemo.testnet` | `0` | Excluded by the contract |
| **Total** | `1000000000000000000000000` | 1 NEAR |

```bash
view first.oathcoin.testnet get_certificate | jq '{oath: .bonded[0] | {kind, status, enforced_by, stake}, payouts_distributed, dust_in_floor: .curve.floor_added, bond_locked, solvent: .accounting.solvent}'
# { "oath": { "kind": "heartbeat", "status": "broken", "enforced_by": "oathcode.testnet",
#             "stake": "1000000000000000000000000" },
#   "payouts_distributed": "949999999999999999999999", "dust_in_floor": "1",
#   "bond_locked": "0", "solvent": true }

curl -s $RPC -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"first.oathcoin.testnet","method_name":"get_activity","args_base64":"eyJmcm9tIjowLCJsaW1pdCI6MTB9"}}' \
  | jq -r '.result.result | implode | fromjson | .[] | "\(.kind)\t\(.account)\t\(.near)"'
# claim    oathbuyer.testnet  949999999999999999999999
# enforce  oathcode.testnet   1000000000000000000000000
# buy      oathbuyer.testnet  497150000000000000000000
# launch   oathdemo.testnet   1000000000000000000000000
```

To read the receipts of the enforcement transaction itself (the public RPC keeps only recent transactions, so use the archival endpoint):

```bash
curl -s https://archival-rpc.testnet.fastnear.com -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"EXPERIMENTAL_tx_status","params":{"tx_hash":"88bNY37JkfkdPLSUHZruLGDWeirLvGASxduNfDxP6zr2","sender_account_id":"oathcode.testnet","wait_until":"NONE"}}' \
  | jq '.result | {returned_bounty: (.status.SuccessValue | @base64d), logs: [.receipts_outcome[].outcome.logs[]]}'
```

## 6. Solvency

The contract reports its own books: `liabilities = reserve + treasury + bond_locked + unclaimed_payouts`, and `solvent = balance >= liabilities + storage_cost`. The balance can be checked against the account independently:

```bash
for c in kept first; do
  view $c.oathcoin.testnet get_accounting | jq -c '{contract_balance, liabilities, storage_cost, solvent}'
  account view_account $c.oathcoin.testnet | jq -r .amount
done
```

On 12 Nov 2026: `$KEPT` held 2.000 NEAR against 1.497 NEAR of liabilities and 0.017 NEAR of storage. `$FIRST` held 1.000 NEAR against 0.497 NEAR of liabilities and 0.017 NEAR of storage.

## 7. OutLayer audit

The audit rules are compiled to a WASI program and executed by NEAR OutLayer. The result is the return value of the transaction.

- Transaction: [`FyPm12aT...`](https://testnet.nearblocks.io/txns/FyPm12aTefgv2PQxt9LchVkLwiScwEqC59hWp475eZs3) (`request_execution` on `outlayer.testnet`, 3 Nov 2026 10:31 UTC). Result for `kept.oathcoin.testnet`: 7 findings ok, 0 warnings, 0 risks.
- The program OutLayer fetched is pinned by its SHA-256, `54d4fee5a4d4b531de21556783984dce0af2aa89d536ddfd16a7096fae5df3e4`:

```bash
curl -s https://oath-near.vercel.app/auditor/oath-audit.wasm | sha256sum
# 54d4fee5a4d4b531de21556783984dce0af2aa89d536ddfd16a7096fae5df3e4

curl -s https://archival-rpc.testnet.fastnear.com -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"EXPERIMENTAL_tx_status","params":{"tx_hash":"FyPm12aTefgv2PQxt9LchVkLwiScwEqC59hWp475eZs3","sender_account_id":"oathcode.testnet","wait_until":"NONE"}}' \
  | jq -r '.result.status.SuccessValue | @base64d | fromjson | {coin_id, counts}'
# { "coin_id": "kept.oathcoin.testnet", "counts": { "note": 0, "ok": 7, "risk": 0, "warn": 0 } }
```

Limits: this is one recorded run. The audit is requested on demand (`node dist/outlayer.js <coin>` in `mcp/`), it is not triggered automatically for each coin. The WASI program and the web audit are kept in agreement by 7 parity fixtures in [`auditor/parity`](../auditor/parity), checked in CI.

## 8. TEE verification of the AI auditor

"Ask the auditor" sends the coin's live certificate and the question to a model on NEAR AI Cloud. Before showing the answer the server ([`web/api/_lib/ask.ts`](../web/api/_lib/ask.ts), [`verify.ts`](../web/api/_lib/verify.ts)) makes four checks:

| Check | What is verified |
| --- | --- |
| `hashes_match` | The signed text equals `<model>:<sha256(request body)>:<sha256(response body)>`, computed locally |
| `signature_valid` | The ECDSA signature recovers to the signing address NEAR AI reports |
| `signer_in_report` | That address appears in a fresh attestation report for the model |
| `nonce_bound` | The report carries the random 32-byte nonce the server just generated |

To see it: open [$FIRST](https://oath-near.vercel.app/coin/first.oathcoin.testnet), tab **Ask the auditor**, click a question. The four results, the signer address, the signed text and the signature are shown under the answer.

Limits, stated plainly:

- The checks run on OATH's server, not in the browser. A visitor trusts the server to report them honestly, or re-runs them from the signed text and signature shown.
- The server checks that the signing key is in NEAR AI's attestation report bound to its nonce. It does not itself validate the hardware quote (Intel TDX / NVIDIA) inside that report.
- The model explains facts that come from the certificate. It cannot change a status, a grade or any on-chain value. The A to D grade is produced by fixed rules in [`web/src/lib/audit.ts`](../web/src/lib/audit.ts), not by the model.
- The endpoint is rate limited (6 questions a minute per address) and depends on NEAR AI Cloud being available.

## 9. Tests and CI

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), four jobs on every push to `main` and every pull request. Runs: [GitHub Actions](https://github.com/opeblow/oath/actions/workflows/ci.yml).

| Suite | Tests | Command | Clock |
| --- | --- | --- | --- |
| Token unit tests | 58 | `cd contracts && cargo test -p oath-token` | Simulated |
| Factory unit tests | 5 | `cd contracts && cargo test -p oath-factory` | Simulated |
| Sandbox end-to-end | 11 | `cd contracts/sandbox-tests && npm i && npm test` | Real (nearcore 2.14) |
| Web | 6 | `cd web && npm test` | - |
| MCP tools over stdio | 6 | `cd mcp && npm run build && npm test` | Live testnet reads |
| Auditor parity | 7 | `cd auditor && cargo build --release && parity/check.sh` | - |
| Browser smoke | all pages, 2 widths | `cd web && node scripts/smoke.mjs` | - |

What the contract tests pin down, by property:

| Property | Tests |
| --- | --- |
| A broken oath is enforced exactly once | `a_broken_oath_cannot_be_enforced_twice`, sandbox "an enforced oath is final" |
| Several broken oaths are enforced independently | `each_broken_oath_is_enforced_separately_and_the_pools_add_up`, sandbox "two broken oaths, two holders" |
| Holders are paid by balance; each claims once | `three_holders_claim_in_proportion_to_their_balances`, `a_payout_is_claimed_only_once` |
| The creator gets nothing from their own broken oath | `the_creator_earns_nothing_from_their_own_broken_oath` |
| Rounding dust goes to the floor; nothing is over-paid | `payout_rounding_dust_goes_to_the_floor` |
| Bond accounting | `bond_accounting_follows_each_oath` |
| Conservation of NEAR across a full lifecycle | `every_yocto_is_accounted_for_through_a_full_lifecycle`, sandbox "the real account balance of every coin covers its books" |
| Vesting boundaries | `vesting_lock_is_full_until_the_cliff_and_zero_at_the_end`, `creator_can_move_exactly_the_vested_amount`, `creator_cannot_move_one_unit_more_than_vested` |
| Treasury restrictions | `treasury_cap_resets_each_period`, `treasury_cannot_reach_the_reserve_or_the_bond`, `only_the_creator_spends_the_treasury`, `treasury_spend_needs_a_public_memo` |
| Expired and unexpired promises | `heartbeat_deadline_is_exclusive`, `a_late_heartbeat_cannot_rescue_a_missed_one`, `a_missed_heartbeat_stays_enforceable_after_the_term_ends`, `a_late_floor_deposit_does_not_save_the_oath` |
| Reclaiming kept bonds | `a_kept_stake_is_reclaimed_only_once`, `a_broken_oath_cannot_be_reclaimed`, `only_the_creator_reclaims_a_kept_stake` |
| Failed launches roll back | sandbox "a launch that fails to initialise leaves no account and no registry entry" |

A defect the tests found: when two oaths on one coin are enforced before a holder claims, the last claim can revert on a 1 yoctoNEAR rounding shortfall in the `unclaimed` counter (`contracts/token/src/lib.rs`, `claim`). The sandbox test therefore claims after each enforcement, and the README lists this under known behaviours. The deployed code is keyless and was not changed.

All tests are in [`contracts/token/src/tests.rs`](../contracts/token/src/tests.rs) and [`contracts/sandbox-tests/test/oath.test.mjs`](../contracts/sandbox-tests/test/oath.test.mjs).

## 10. Submission snapshot

The submitted state is the annotated tag [`hackathon-submission`](https://github.com/opeblow/oath/tree/hackathon-submission), which points to commit `5fc01ae1e38bda2a323f54b6c95f4cf7df3238eb`.

```bash
git ls-remote --tags https://github.com/opeblow/oath hackathon-submission'^{}'
# 5fc01ae1e38bda2a323f54b6c95f4cf7df3238eb	refs/tags/hackathon-submission^{}
```

Commits after the tag change documentation, tests and the demo recording script. The deployed contracts are keyless and cannot be changed by any later commit.
