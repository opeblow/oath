// Clicks a suggested question on the Ask tab and waits for a verified answer.
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://localhost:5173";
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 1400 } })).newPage();
await p.goto(`${base}/coin/kept.oathcoin.testnet`, { waitUntil: "networkidle" });
await p.getByRole("tab", { name: "Ask the auditor", exact: true }).click();
await p.getByRole("button", { name: "Can the creator take the liquidity?" }).click();
await p.locator(".ask-answer").waitFor({ timeout: 120000 });
const verified = await p.getByText("Verified", { exact: true }).count();
console.log((await p.locator(".ask-answer").textContent()).slice(0, 200));
console.log((await p.locator(".attest").textContent()).slice(0, 400));
await p.locator(".tab-body").screenshot({ path: "../docs/screenshots/coin-ask.png" });
await b.close();
console.log(verified ? "ASK OK (verified)" : "ASK NOT VERIFIED");
process.exit(verified ? 0 : 1);
