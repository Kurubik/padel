// End-to-end check against the deployed public URL: two real browsers create
// and join a private room over https/wss and finish a point.
// Usage: PLAYWRIGHT_MODULE=<path>/playwright node scripts/verify-public.mjs
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/root/.openclaw/workspace/lottoresults/node_modules/playwright");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ART = join(ROOT, "artifacts");
const BASE = process.env.PADEL_URL || "https://padel.xtr.sh";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { base: BASE, steps: [], consoleErrors: [], pageErrors: [], shots: [] };
const errors = [];
const log = (s, ok, d) => { report.steps.push({ step: s, ok: !!ok, detail: d }); if (!ok) errors.push(s + ": " + d); };

async function center(page, sel) {
  const b = await page.locator(sel).first().boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function tapPad(page, dx = 0, dy = 0) {
  const c = await center(page, ".hitpad");
  await page.mouse.move(c.x, c.y); await page.mouse.down();
  if (dx || dy) await page.mouse.move(c.x + dx, c.y + dy, { steps: 4 });
  await page.mouse.up();
}
async function holdStick(page, dx, dy, ms) {
  const c = await center(page, ".stick");
  await page.mouse.move(c.x, c.y); await page.mouse.down();
  await page.mouse.move(c.x + dx, c.y + dy, { steps: 4 });
  await sleep(ms); await page.mouse.up();
}
const debug = (page) => page.evaluate(() => (window.padel ? window.padel.debug() : null));

await mkdir(ART, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const mk = async (tag) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    p.setDefaultTimeout(30000);
    p.on("console", (m) => { if (m.type() === "error") report.consoleErrors.push(tag + ": " + m.text()); });
    p.on("pageerror", (e) => report.pageErrors.push(tag + ": " + String(e.message)));
    await p.goto(BASE, { waitUntil: "load" });
    return { ctx, page: p };
  };
  const a = await mk("host");
  await sleep(2500);
  const healthOk = await a.page.evaluate(async (base) => {
    const r = await fetch(base + "/healthz");
    return { status: r.status, body: await r.json() };
  }, BASE);
  log("public /healthz is ok", healthOk.status === 200 && healthOk.body.ok === true, JSON.stringify(healthOk));
  await a.page.getByText("Play with Friends", { exact: true }).first().click();
  await sleep(3000);
  const code = (await a.page.locator(".lobby-panel h1").first().innerText()).trim();
  log("public room code issued over wss", /^[A-Z0-9]{5}$/.test(code), code);
  report.room = code;
  const b = await mk("guest");
  await b.page.goto(BASE + "/?room=" + code, { waitUntil: "load" });
  await sleep(3500);
  const db = await debug(b.page);
  log("guest joined over the public edge", !!db && db.code === code && db.seat !== 0, JSON.stringify(db));
  await a.page.getByText("Start match", { exact: true }).first().click();
  await sleep(2500);
  const da = await debug(a.page);
  log("match started with 4 seats (2 humans + bots)", !!da && da.players === 4, JSON.stringify(da));
  await tapPad(a.page, 0, -30);
  for (let i = 0; i < 45; i++) {
    const p = i % 2 === 0 ? a.page : b.page;
    await holdStick(p, (i % 4 - 2) * 14, -10, 80);
    await tapPad(p, 0, -18);
    await sleep(140);
  }
  const after = await debug(a.page);
  const scored = !!after && after.score && (after.score.points[0] + after.score.points[1] > 0 || after.score.games[0] + after.score.games[1] > 0);
  log("a point was decided by the public server", scored, JSON.stringify(after));
  await a.page.screenshot({ path: join(ART, "public-room-host.png") });
  report.shots.push("artifacts/public-room-host.png");
  await a.ctx.close();
  await b.ctx.close();
} finally {
  await browser.close();
}
await writeFile(join(ART, "public-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: errors.length === 0, errors, steps: report.steps, consoleErrors: report.consoleErrors, pageErrors: report.pageErrors }, null, 2));
if (errors.length) process.exitCode = 1;
