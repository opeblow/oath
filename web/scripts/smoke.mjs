// Visits every page in a real browser, fails on console errors, and saves screenshots for the docs.
// Usage: node scripts/smoke.mjs [baseUrl]   (default http://localhost:5173)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:5173";
const out = new URL("../../docs/screenshots/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
mkdirSync(out, { recursive: true });

const pages = [
  ["landing", "/", "A memecoin that"],
  ["registry", "/coins", "Every coin, every oath."],
  ["coin", "/coin/kept.oathcoin.testnet", "Kept Word"],
  ["coin-first", "/coin/first.oathcoin.testnet", "First Oath"],
  ["launch", "/launch", "Swear your coin"],
  ["watch", "/watch", "Catch a broken promise"],
  ["how", "/how", "Promises as contract rules."],
  ["agents", "/agents", "Built to be read by machines."],
  ["notfound", "/nope", "No such page."],
];
const tabs = [["coin-verify", "Verify", "No access keys"], ["coin-audit", "Audit", "Grade"], ["coin-activity", "Activity", "Sworn"]];

const browser = await chromium.launch();
let failed = 0;
for (const width of [1280, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: width < 500 ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/favicon|near-connect|wallet|manifest|ERR_/i.test(m.text()) && errors.push(m.text()));
  for (const [name, path, text] of pages) {
    errors.length = 0;
    await page.goto(base + path, { waitUntil: "networkidle" });
    let ok = true;
    try {
      await page.getByText(text, { exact: false }).first().waitFor({ timeout: 15000 });
    } catch {
      ok = false;
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (!ok || errors.length || overflow) failed++;
    console.log(`${width}px ${name.padEnd(11)} ${ok ? "ok" : "MISSING TEXT"}${overflow ? " HORIZONTAL-SCROLL" : ""}${errors.length ? " ERRORS: " + errors.join(" | ") : ""}`);
    await page.screenshot({ path: `${out}${name}${width < 500 ? "-mobile" : ""}.png`, fullPage: width >= 500 && name !== "landing" ? false : false });
    if (name === "coin" && width >= 500) {
      for (const [tname, label, expect] of tabs) {
        await page.getByRole("tab", { name: label, exact: true }).click();
        let tok = true;
        try {
          await page.getByText(expect).first().waitFor({ timeout: 15000 });
        } catch {
          tok = false;
          failed++;
        }
        console.log(`${width}px ${tname.padEnd(11)} ${tok ? "ok" : "MISSING TEXT"}`);
        await page.locator(".tab-body").screenshot({ path: `${out}${tname}.png` });
      }
    }
  }
  await ctx.close();
}
await browser.close();
console.log(failed ? `FAILED: ${failed}` : "ALL PAGES OK");
process.exit(failed ? 1 : 0);
