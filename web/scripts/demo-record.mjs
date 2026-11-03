// Records the OATH demo video from the live site: each scene is filmed in a real browser,
// then trimmed and joined with crossfades by ffmpeg into one 1080p MP4 with burned-in captions.
// Usage: node scripts/demo-record.mjs [baseUrl] [outFile]
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] ?? "https://oath-near.vercel.app";
const OUT = process.argv[3] ?? "oath-demo.mp4";
const W = 1600;
const H = 900;
const WORK = join(process.cwd(), ".demo-work");
const FADE = 0.45;

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const FONTS = "https://fonts.googleapis.com/css2?family=Libre+Caslon+Display&family=Libre+Caslon+Text:ital@0;1&family=Libre+Franklin:wght@400;600&display=swap";
const SEAL = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 100 100"><polygon fill="#b3261e" points="${Array.from({ length: 28 }, (_, i) => {
  const a = (i / 28) * Math.PI * 2;
  const r = 48 + (i % 2 === 0 ? 1.8 : -1.2) + Math.sin(i * 1.7) * 0.9;
  return `${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`;
}).join(" ")}"/><circle cx="50" cy="50" r="42" fill="none" stroke="#f3eee3" stroke-width="0.6" opacity="0.6"/><circle cx="50" cy="50" r="27" fill="none" stroke="#f3eee3" stroke-width="0.9"/><circle cx="50" cy="50" r="25" fill="none" stroke="#f3eee3" stroke-width="0.4" stroke-dasharray="1 1.4"/><text x="50" y="57" text-anchor="middle" font-family="Libre Caslon Display, Georgia, serif" font-size="20" fill="#f3eee3">OATH</text></svg>`;

const CARD_CSS = `
  *{box-sizing:border-box;margin:0}
  body{background:#f3eee3;color:#1b1915;height:100vh;display:grid;place-items:center;font-family:'Libre Franklin',sans-serif;overflow:hidden}
  .frame{position:fixed;inset:18px;border:1.5px solid #1b1915}.frame:after{content:"";position:absolute;inset:6px;border:1px solid #c9bda3}
  .wrap{text-align:center;display:grid;gap:22px;justify-items:center;padding:0 80px}
  .l{font-family:'Libre Caslon Display',Georgia,serif;font-size:76px;line-height:1.08;opacity:0;transform:translateY(14px);transition:all .7s cubic-bezier(.2,.8,.2,1)}
  .s{font-family:'Libre Caslon Text',Georgia,serif;font-style:italic;font-size:34px;color:#3b372f;opacity:0;transition:opacity .7s}
  .e{font-size:15px;letter-spacing:.32em;text-transform:uppercase;color:#7d6b48;opacity:0;transition:opacity .7s}
  .red{color:#b3261e}.on{opacity:1!important;transform:none!important}
  .seal{opacity:0;transform:scale(1.6) rotate(-14deg);transition:all .55s cubic-bezier(.2,1.4,.4,1)}
  .strike{position:relative}.strike:after{content:"";position:absolute;left:-2%;right:102%;top:55%;height:5px;background:#b3261e;transition:right .6s ease}
  .strike.cut:after{right:-2%}
`;

// ------------------------------------------------------------------ page helpers injected into the site

const OVERLAY = `
(() => {
  if (window.__demo) return;
  window.__demo = true;
  const st = document.createElement('style');
  st.textContent = \`
    #demo-cap{position:fixed;left:50%;bottom:44px;transform:translate(-50%,16px);max-width:1180px;width:max-content;z-index:99999;
      background:#1b1915;color:#f3eee3;padding:18px 30px 20px;border-radius:2px;font:600 30px/1.3 'Libre Franklin',sans-serif;
      box-shadow:0 18px 50px -20px rgba(0,0,0,.6);opacity:0;transition:all .45s cubic-bezier(.2,.8,.2,1);text-align:center}
    #demo-cap.on{opacity:1;transform:translate(-50%,0)}
    #demo-cap small{display:block;font:600 13px/1 'Libre Franklin',sans-serif;letter-spacing:.28em;text-transform:uppercase;color:#d9a19b;margin-bottom:9px}
    #demo-cur{position:fixed;left:0;top:0;width:26px;height:26px;z-index:100000;pointer-events:none;transition:transform .75s cubic-bezier(.3,.7,.2,1)}
    #demo-cur.click:after{content:"";position:absolute;left:-14px;top:-14px;width:54px;height:54px;border-radius:50%;border:3px solid #b3261e;animation:demoPing .5s ease-out forwards}
    @keyframes demoPing{from{transform:scale(.3);opacity:1}to{transform:scale(1.2);opacity:0}}
    .demo-hl{outline:4px solid #b3261e!important;outline-offset:6px;transition:outline-color .3s}
    html{scroll-behavior:auto!important}
  \`;
  document.head.appendChild(st);
  const cap = document.createElement('div'); cap.id = 'demo-cap'; document.body.appendChild(cap);
  const cur = document.createElement('div'); cur.id = 'demo-cur';
  cur.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.4-3.4-6.9L4 19z" fill="#1b1915" stroke="#f3eee3" stroke-width="1.3"/></svg>';
  cur.style.transform = 'translate(' + (innerWidth * 0.62) + 'px,' + (innerHeight * 0.58) + 'px)';
  document.body.appendChild(cur);
})();`;

async function setup(page) {
  await page.addInitScript({ content: `document.addEventListener('DOMContentLoaded',()=>{${OVERLAY}})` });
}

async function caption(page, text, eyebrow = "") {
  await page.evaluate(
    ([t, e]) => {
      const c = document.getElementById("demo-cap");
      if (!c) return;
      c.classList.remove("on");
      setTimeout(() => {
        c.innerHTML = (e ? `<small>${e}</small>` : "") + t;
        c.classList.add("on");
      }, c.textContent ? 260 : 0);
    },
    [text, eyebrow],
  );
  await page.waitForTimeout(500);
}

async function hideCaption(page) {
  await page.evaluate(() => document.getElementById("demo-cap")?.classList.remove("on"));
}

async function moveTo(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  const x = box.x + Math.min(box.width / 2, 120);
  const y = box.y + box.height / 2;
  await page.evaluate(([x, y]) => (document.getElementById("demo-cur").style.transform = `translate(${x}px,${y}px)`), [x, y]);
  await page.waitForTimeout(800);
  await page.mouse.move(x, y);
}

async function click(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await moveTo(page, locator);
  await page.evaluate(() => {
    const c = document.getElementById("demo-cur");
    c.classList.remove("click");
    void c.offsetWidth;
    c.classList.add("click");
  });
  await locator.click();
  await page.waitForTimeout(350);
}

async function scrollTo(page, y, ms = 1400) {
  await page.evaluate(
    ([target, ms]) =>
      new Promise((done) => {
        const start = scrollY;
        const t0 = performance.now();
        const step = (t) => {
          const p = Math.min(1, (t - t0) / ms);
          const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          scrollTo(0, start + (target - start) * e);
          p < 1 ? requestAnimationFrame(step) : done();
        };
        requestAnimationFrame(step);
      }),
    [y, ms],
  );
}

async function scrollToEl(page, locator, offset = 140, ms = 1300) {
  const y = await locator.evaluate((el, off) => el.getBoundingClientRect().top + scrollY - off, offset);
  await scrollTo(page, Math.max(0, y), ms);
}

async function highlight(page, locator) {
  await locator.evaluate((el) => el.classList.add("demo-hl"));
}

// ------------------------------------------------------------------ scenes

const scenes = [];
const scene = (name, run) => scenes.push({ name, run });

scene("hook", async (page, mark) => {
  await page.setContent(`<html><head><link rel="stylesheet" href="${FONTS}"><style>${CARD_CSS}</style></head><body><div class="frame"></div>
    <div class="wrap"><div class="e" id="e">Every memecoin launch</div>
    <div class="l" id="a">"Liquidity is locked."</div><div class="l" id="b">"The team won't dump."</div><div class="l" id="c">"We ship every week."</div>
    <div class="s" id="d">None of it is enforced.</div></div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  mark("start");
  const on = (id) => page.evaluate((i) => document.getElementById(i).classList.add("on"), id);
  await on("e");
  await page.waitForTimeout(500);
  for (const id of ["a", "b", "c"]) {
    await on(id);
    await page.waitForTimeout(800);
  }
  await page.evaluate(() => ["a", "b", "c"].forEach((i) => document.getElementById(i).classList.add("strike")));
  await page.waitForTimeout(50);
  for (const id of ["a", "b", "c"]) {
    await page.evaluate((i) => document.getElementById(i).classList.add("cut"), id);
    await page.waitForTimeout(260);
  }
  await page.evaluate(() => (document.getElementById("d").style.color = "#b3261e"));
  await on("d");
  await page.waitForTimeout(1900);
  mark("end");
});

scene("reveal", async (page, mark) => {
  await page.setContent(`<html><head><link rel="stylesheet" href="${FONTS}"><style>${CARD_CSS}</style></head><body><div class="frame"></div>
    <div class="wrap"><div class="seal" id="s">${SEAL(170)}</div><div class="l" id="a" style="font-size:96px;letter-spacing:.12em">OATH</div>
    <div class="s" id="b">Memecoins that keep their word.</div><div class="e" id="c">Every promise is a contract rule &nbsp;·&nbsp; on NEAR</div></div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  mark("start");
  await page.waitForTimeout(250);
  await page.evaluate(() => document.getElementById("s").classList.add("on"));
  await page.waitForTimeout(550);
  for (const id of ["a", "b", "c"]) {
    await page.evaluate((i) => document.getElementById(i).classList.add("on"), id);
    await page.waitForTimeout(420);
  }
  await page.waitForTimeout(1500);
  mark("end");
});

scene("landing", async (page, mark) => {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  mark("start");
  await caption(page, "A launchpad where a creator's promises are enforced by code.", "OATH on NEAR");
  await page.waitForTimeout(2300);
  await scrollToEl(page, page.locator(".betrayals"), 170, 1800);
  await caption(page, "Rugs, dumps, snipes, broken roadmaps. Each one is blocked or bonded.");
  await page.waitForTimeout(2600);
  mark("end");
});

scene("registry", async (page, mark) => {
  await page.goto(`${BASE}/coins`, { waitUntil: "networkidle" });
  await page.locator(".coin-row .pill").first().waitFor();
  await page.waitForTimeout(1500);
  mark("start");
  await caption(page, "Two real coins on NEAR testnet. One kept its word. One did not.", "The registry");
  await page.waitForTimeout(1200);
  await moveTo(page, page.locator(".coin-row").first());
  await page.waitForTimeout(1600);
  mark("end");
});

scene("kept", async (page, mark) => {
  await page.goto(`${BASE}/coin/kept.oathcoin.testnet`, { waitUntil: "networkidle" });
  await page.locator(".cert-name").waitFor();
  await page.waitForTimeout(1200);
  mark("start");
  await caption(page, "Every coin gets a certificate of oaths, read live from the chain.", "Kept Word, $KEPT");
  await page.waitForTimeout(2400);
  const kept = page.locator(".oath").filter({ hasText: "Add 1 NEAR to the floor" });
  await scrollToEl(page, kept, 260, 1600);
  await highlight(page, kept.locator(".pill"));
  await caption(page, "Kept. The creator added 1 NEAR to the floor, so the 1 NEAR stake went back to them.");
  await page.waitForTimeout(3000);
  mark("end");
});

scene("verify", async (page, mark) => {
  await page.goto(`${BASE}/coin/kept.oathcoin.testnet`, { waitUntil: "networkidle" });
  await page.locator(".tabs").waitFor();
  await scrollToEl(page, page.locator(".tabs"), 120, 10);
  await page.waitForTimeout(600);
  mark("start");
  await click(page, page.getByRole("tab", { name: "Verify", exact: true }));
  await page.getByText("No access keys").waitFor();
  await page.locator(".verify-ok").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  await caption(page, "Zero access keys. Not the creator, not us: nobody can touch the money.", "Verify it yourself");
  await page.waitForTimeout(3200);
  mark("end");
});

scene("broken", async (page, mark) => {
  await page.goto(`${BASE}/coin/first.oathcoin.testnet`, { waitUntil: "networkidle" });
  await page.locator(".cert-name").waitFor();
  await page.waitForTimeout(1200);
  mark("start");
  const beat = page.locator(".oath").filter({ hasText: "Show up every" });
  await scrollToEl(page, beat, 300, 1500);
  await highlight(page, beat.locator(".pill"));
  await caption(page, "This creator promised a public update every day, and missed one.", "First Oath, $FIRST");
  await page.waitForTimeout(2800);
  await click(page, page.getByRole("tab", { name: "Activity", exact: true }));
  await page.locator(".activity li").first().waitFor();
  await page.waitForTimeout(400);
  await caption(page, "Our watcher bot enforced it automatically. 5% bounty to the enforcer, 95% to holders.");
  await page.waitForTimeout(3000);
  const paid = page.locator(".fact").filter({ hasText: "Paid to holders" });
  await scrollToEl(page, paid, 330, 1200);
  await highlight(page, paid);
  await caption(page, "Breaking a promise now costs the creator. Holders get paid.");
  await page.waitForTimeout(2800);
  mark("end");
});

scene("audit", async (page, mark) => {
  await page.goto(`${BASE}/coin/first.oathcoin.testnet`, { waitUntil: "networkidle" });
  await page.locator(".tabs").waitFor();
  await scrollToEl(page, page.locator(".tabs"), 120, 10);
  await page.waitForTimeout(600);
  mark("start");
  await click(page, page.getByRole("tab", { name: "Audit", exact: true }));
  await page.getByText("Grade").first().waitFor();
  await caption(page, "An instant audit with a grade. The same rules run verifiably on NEAR OutLayer.", "Audit");
  await page.waitForTimeout(3400);
  mark("end");
});

scene("ask", async (page, mark) => {
  await page.goto(`${BASE}/coin/kept.oathcoin.testnet`, { waitUntil: "networkidle" });
  await page.locator(".tabs").waitFor();
  await scrollToEl(page, page.locator(".tabs"), 120, 10);
  await page.waitForTimeout(600);
  mark("start");
  await click(page, page.getByRole("tab", { name: "Ask the auditor", exact: true }));
  await caption(page, "Ask anything. A private AI model on NEAR AI Cloud reads the live certificate.", "Ask the auditor");
  await click(page, page.getByRole("button", { name: "Can the creator take the liquidity?" }));
  await page.waitForTimeout(1500);
  mark("cut");
  await page.locator(".ask-answer").waitFor({ timeout: 120000 });
  mark("resume");
  await page.waitForTimeout(300);
  await scrollToEl(page, page.locator(".ask-answer"), 160, 900);
  await caption(page, "Answered inside a TEE. Signature and attestation checked before you see it.");
  await page.waitForTimeout(2600);
  await scrollToEl(page, page.locator(".attest"), 260, 900);
  await highlight(page, page.locator(".attest"));
  await page.waitForTimeout(2300);
  mark("end");
});

scene("watch", async (page, mark) => {
  await page.goto(`${BASE}/watch`, { waitUntil: "networkidle" });
  await page.locator(".facts").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1000);
  mark("start");
  await caption(page, "Anyone can catch a broken promise and get paid for it. No committee.", "Watch and earn");
  await page.waitForTimeout(1600);
  await scrollTo(page, 420, 1500);
  await page.waitForTimeout(1400);
  mark("end");
});

scene("launch", async (page, mark) => {
  await page.goto(`${BASE}/launch`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  mark("start");
  await caption(page, "Launch your own. Watch the certificate fill in as you type.", "Launch");
  const name = page.getByPlaceholder("Pepe Keeps Promises");
  await click(page, name);
  await name.pressSequentially("Honest Dog", { delay: 85 });
  const sym = page.getByPlaceholder("PKP", { exact: true });
  await click(page, sym);
  await sym.pressSequentially("HDOG", { delay: 110 });
  await page.waitForTimeout(600);
  await caption(page, "One transaction creates the coin, deposits the bond and seals every oath.");
  await page.waitForTimeout(2800);
  mark("end");
});

scene("agents", async (page, mark) => {
  await page.goto(`${BASE}/agents`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  mark("start");
  await caption(page, "Built for AI agents too: an MCP server with 9 tools, from audit to enforce.", "For agents");
  await page.waitForTimeout(1200);
  await scrollTo(page, 700, 1800);
  await page.waitForTimeout(1000);
  mark("end");
});

scene("end", async (page, mark) => {
  await page.setContent(`<html><head><link rel="stylesheet" href="${FONTS}"><style>${CARD_CSS}</style></head><body><div class="frame"></div>
    <div class="wrap"><div class="seal" id="s">${SEAL(130)}</div><div class="l" id="a" style="font-size:84px;letter-spacing:.12em">OATH</div>
    <div class="s" id="b">Memecoins that keep their word.</div>
    <div class="e" id="c" style="font-size:20px;letter-spacing:.14em;color:#1b1915">oath-near.vercel.app &nbsp;·&nbsp; github.com/opeblow/oath</div>
    <div class="e" id="d">Built at NEAR HACKATHON 2026</div></div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  mark("start");
  await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById("s").classList.add("on"));
  await page.waitForTimeout(450);
  for (const id of ["a", "b", "c", "d"]) {
    await page.evaluate((i) => document.getElementById(i).classList.add("on"), id);
    await page.waitForTimeout(380);
  }
  await page.waitForTimeout(2600);
  mark("end");
});

// ------------------------------------------------------------------ record

const browser = await chromium.launch();
const clips = [];
for (const s of scenes) {
  const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: WORK, size: { width: W, height: H } } });
  const page = await context.newPage();
  const t0 = Date.now();
  const marks = {};
  await setup(page);
  try {
    await s.run(page, (k) => (marks[k] = (Date.now() - t0) / 1000));
  } catch (e) {
    console.error(`scene ${s.name} failed: ${e.message}`);
    await context.close();
    await browser.close();
    process.exit(1);
  }
  await page.waitForTimeout(300);
  const video = page.video();
  await context.close();
  const src = await video.path();
  clips.push({ name: s.name, src, marks });
  console.log(`recorded ${s.name.padEnd(9)} ${JSON.stringify(marks)}`);
}
await browser.close();

// ------------------------------------------------------------------ edit

const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
const parts = [];
for (const c of clips) {
  const { start, end, cut, resume } = c.marks;
  const ranges = cut && resume ? [[start, cut], [resume, end]] : [[start, end]];
  ranges.forEach(([a, b], i) => {
    const out = join(WORK, `${c.name}-${i}.mp4`);
    ff(["-ss", a.toFixed(3), "-to", b.toFixed(3), "-i", c.src, "-vf", "scale=1920:1080:flags=lanczos,fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-an", out]);
    const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString().trim());
    parts.push({ out, dur, hard: i > 0 });
  });
}

// Chain crossfades (a hard cut is used inside the Ask scene where the wait was removed).
const inputs = parts.flatMap((p) => ["-i", p.out]);
let filter = "";
let last = "[0:v]";
let offset = parts[0].dur;
for (let i = 1; i < parts.length; i++) {
  const fade = parts[i].hard ? 0.12 : FADE;
  offset -= fade;
  const label = i === parts.length - 1 ? "[v]" : `[x${i}]`;
  filter += `${last}[${i}:v]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(3)}${label};`;
  last = label;
  offset += parts[i].dur;
}
writeFileSync(join(WORK, "filter.txt"), filter.replace(/;$/, ""));
const tmp = join(WORK, "final.mp4");
ff([...inputs, "-/filter_complex", join(WORK, "filter.txt"), "-map", "[v]", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp]);
renameSync(tmp, OUT);
const total = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", OUT]).toString().trim();
console.log(`wrote ${OUT} (${Number(total).toFixed(1)}s)`);
