# Privacy

OATH has no accounts, cookies or analytics.

- **Wallet.** Connecting a wallet shares your public NEAR account ID with the page so it can show your balance. OATH never sees your keys. Transactions are signed in your wallet.
- **Chain data.** Everything the app shows is public data read from NEAR RPC nodes. Those providers can see your IP address, as with any RPC request.
- **Ask the auditor.** Your question and the coin's public certificate are sent to NEAR AI Cloud and processed inside a trusted execution environment. OATH's server does not store questions or answers. A short-lived per-IP counter limits abuse and is kept in memory only.
- **Any chain quotes.** The Any chain tab requests quotes from the NEAR Intents 1Click API. No personal data is sent beyond the quote parameters.
- **Hosting.** The hosting provider may keep standard request logs.

Questions: open an issue at https://github.com/opeblow/oath/issues.
