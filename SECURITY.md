# Security

OATH contracts hold user funds on NEAR testnet. Please report vulnerabilities privately.

## Reporting

Open a [private security advisory](https://github.com/opeblow/oath/security/advisories/new) on GitHub. Include the contract or file, the steps to reproduce, and the impact. Please do not open a public issue for a vulnerability.

You will get a reply within 72 hours.

## Scope

- `contracts/token` and `contracts/factory`, including the deployed factory `oathcoin.testnet` and coins it created
- `web/api` (the NEAR AI auditor function)
- `mcp` (MCP server, watcher bot)

## Design guarantees worth testing

- A coin account has no access keys and runs only the published global code.
- No method moves the curve reserve except `sell`.
- The contract balance always covers reserve, treasury, bond, unclaimed payouts and storage.
- Creator tokens cannot move below the vesting lock.
- A bonded oath can be enforced only after its deadline, exactly once.

## Known limits

The launch-window wallet cap can be bypassed with many wallets. This is documented, not a vulnerability.
