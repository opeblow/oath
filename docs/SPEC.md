# OATH — Product Specification

**One line:** OATH is a memecoin launchpad on NEAR where every promise the creator makes is a contract rule. Promises the code can prevent are made impossible to break. Promises the code can only observe are backed by a creator bond that is paid out to holders when broken.

## Problem
Memecoin buyers are routinely rugged: liquidity is pulled, team tokens are dumped, treasuries disappear, and "roadmap" promises are forgotten. Each promise lives in a tweet, so breaking it costs the creator nothing. Two judges call memecoins "a series of false promises masking a casino" (Lazzarin) and blame them for crypto's reputation (Polosukhin).

## Users
- **Creators** who want to prove they are not ruggers and get a trust advantage at launch.
- **Buyers** who want to know, before buying, exactly what the creator cannot do.
- **Watchers**: anyone who catches a broken promise earns a bounty for enforcing it.

## Core mechanics

### 1. Every coin is its own sealed contract
- The factory creates `<symbol>.<factory>` as a sub-account, deploys the OATH token code, initializes it, and adds **no access keys**. Nobody, not even the creator or the factory, can change the code or take the funds.
- The app checks this live through RPC: number of access keys (must be 0) and code hash (must match the published OATH code).

### 2. Locked liquidity by construction
- Buying and selling happen against a bonding curve built into the token contract (constant product with a virtual NEAR reserve).
- The NEAR paid in stays in the contract. No function withdraws the reserve; the only way out is selling tokens back. Pulling liquidity is impossible.

### 3. Oaths
Fixed at launch, readable by anyone, never editable.

**Sealed oaths (enforced; cannot be broken):**
| Oath | Rule the contract enforces |
|---|---|
| Liquidity locked | No reserve withdrawal exists; sells always pay from the reserve |
| Creator vesting | The creator's allocation unlocks linearly after a cliff; transfers or sells that would dip below the locked amount fail |
| Launch max wallet | During the launch window, no account may hold more than X% of supply (anti-sniper) |
| Fixed fee | The trade fee (bps) is set at launch and capped at 2% |
| Treasury rules | Fees accrue to a treasury. The creator can spend at most N NEAR per period, only to recipients declared at launch, and each spend needs a public memo |

**Bonded oaths (observable; slashable):**
| Oath | Broken when | Proof |
|---|---|---|
| Heartbeat | The creator misses a check-in window (a public on-chain update every N days until a set date) | Time since the last update > window |
| Floor top-up | The creator fails to add X NEAR to the reserve floor by the deadline | Deposited amount < promised at deadline |

Each bonded oath stakes part of the creator's bond (NEAR deposited at launch).
- **Breach**: anyone can call `enforce(oath_id)`. The enforcer gets 5% of that oath's stake; 95% is distributed to holders pro-rata (claimable NEAR, with the creator and the contract excluded). The oath is marked Broken forever on the certificate.
- **Kept**: after an oath's term ends unbroken, the creator can reclaim its stake, and the oath is marked Kept.

### 4. Trust score shown, not claimed
The certificate shows facts only: number of sealed oaths, bonded NEAR at stake, oaths kept or broken, access keys = 0, code hash verified. No subjective rating.

## Product surfaces (web app)
1. **Registry**: all coins with oaths kept/broken, bond at stake and reserve. Sorted by trust facts, not price.
2. **Launch**: a step-by-step form with a live certificate preview. One transaction creates the coin, deposits the bond and seals the oaths.
3. **Certificate (coin page)**: an engraved certificate with the oath list and live status; a verification panel (keys, code hash, reserve balance read from chain); a trade panel (buy/sell with live quote, slippage guard); a holder panel (balance, claimable payouts, claim); a creator panel (heartbeat, top-up, treasury spend, reclaim stakes); an enforce button that appears whenever an oath is breakable now; and an activity log of every on-chain event.
4. **Wallet**: NEAR wallets through a standard connector. Reading needs no wallet.

## Non-goals (v1)
- Holder-voted judgement of off-chain promises (needs an arbitration design; listed for v2).
- A cross-chain buy flow through NEAR Intents (mainnet-only; listed for v2 once mainnet launch is approved).
- Price charts as the hero. Prices are shown, but trust facts lead.

## Design
An engraved banknote / share-certificate look. Paper background, ink-black Libre Caslon display type, Libre Franklin for UI text, IBM Plex Mono for chain data. Guilloche line-work generated procedurally per coin (seeded by the contract address, so every certificate is unique). A red wax seal stamps when an oath is verified. No gradients, no dark-purple theme, no emojis.

## Tech
- Contracts: Rust, near-sdk 5.x, near-contract-standards (NEP-141, NEP-145, NEP-148, NEP-297 events). Tests: unit tests plus near-workspaces sandbox integration tests.
- Web: Vite, React and TypeScript. Static hosting on a free tier.
- Network: NEAR testnet. Free public RPC.
