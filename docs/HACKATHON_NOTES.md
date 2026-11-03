# Hackathon notes (kept from research)

## Rules that shape the build
- Deadline: 2026-11-14 23:59 UTC. Judging 2026-11-16 to 18. Live rules: https://nearhackathon.com/HACKATHON.md
- Track: `memecoins` (Memecoins With Mechanics). "Judged on the mechanic, not the chart." Also list `social` and `open` if they fit.
- Prizes per track: $10K / $3K / $2K. One $55K grand prize across all tracks.
- Required: public repo with a LICENSE, an X post (built at NEAR HACKATHON, @NEARProtocol, #NEARHackathon, video attached), one submission that cannot be edited.
- Claude Code and Codex screen first: the README must have "do X, see Y" steps a stranger can run with no funds. Humans decide.
- Testnet-only projects are eligible. No mandatory integrations. A hosted demo is a plus; keep it up until at least 2026-11-25.
- Never without explicit human confirmation: submitting, posting on X, making the repo public, mainnet transactions, committing secrets.

## What judges have said publicly about memecoins
- Eddy Lazzarin (a16z): "At best, it looks like a risky casino. Or a series of false promises masking a casino." "Memecoins aren't very technically interesting." (The Block, 2024-04-25)
- Illia Polosukhin (NEAR): memecoins damaged crypto's reputation and pushed AI researchers away (CoinDesk, 2026-03-03, paraphrased). He also said DAOs failed because they were "unbounded".
- Kain Warwick (Infinex): "Speculation is good. It's valuable." Memes link finance and culture (Cointelegraph, 2024-05-03).
- Mert Mumtaz (Helius): no admin keys, rigor, "straw houses will collapse" (2026-06).
- No public memecoin statements found from Haseeb Qureshi, Avichal Garg or Stepan Gershuni.

Product answer: a memecoin launchpad where creator promises are enforced by contract, backed by a slashable bond, with locked liquidity and no admin keys.

## Competitors in the memecoins track (as of 2026-11-02)
warband-near (hold-time voting), gremlin (streak coin), robinhoot-heist (crash game), Hot-Potato-Bomb (game), hack-near (no README). None of them address rugs or broken promises.

## Free infrastructure
- Testnet NEAR: free faucet. Public RPC: https://rpc.testnet.near.org (rate limited; fallbacks at https://docs.near.org/api/rpc/providers)
- NEAR Intents 1Click quotes: free without a key (mainnet only, no testnet).
