# Contributing

Thanks for helping. OATH is small on purpose, so keep changes focused.

## Setup

```bash
cd web && npm install && npm run dev        # app on http://localhost:5173 (testnet)
cd mcp && npm install && npm run build      # MCP server and watcher
cd contracts && cargo test                  # contract unit tests (Rust + cargo-near)
```

## Before you open a pull request

- `cd web && npm run typecheck && npm test && npm run build`
- `cd mcp && npm run build && npm test`
- `cd contracts && cargo test`, and for contract changes `cd contracts/sandbox-tests && npm test`
- If you change audit rules, change both `web/src/lib/audit.ts` and `auditor/src/main.rs`, regenerate `auditor/parity/expected.json`, and run `auditor/parity/check.sh`.

## Style

- Plain words in the UI and docs. No emojis.
- Every number shown to users comes from the chain. Nothing is simulated.
- Contract changes must keep the guarantees in [SECURITY.md](SECURITY.md).

## Changing the token contract

Coins run a published global contract. A code change means a new global hash, so existing coins keep the old code. Bump the hash in `web/src/lib/config.ts`, `mcp/src/oath.ts` and the factory.

By contributing you agree your work is released under the [MIT License](LICENSE) and that you follow the [Code of Conduct](CODE_OF_CONDUCT.md).
