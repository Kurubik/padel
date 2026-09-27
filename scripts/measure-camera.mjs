// Camera sweep: measures where the local player and the court land relative to
// the HUD at each viewport, so framing is chosen from data, not by eye.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/root/.openclaw/workspace/lottoresults/node_modules/playwright");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = 19250;
const BASE = "http://127.0.0.1:" + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [join(ROOT, "server/src/index.ts")], { env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" }, stdio: "ignore" });
for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + "/healthz"); if (r.ok) break; } catch {} await sleep(200); }
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"] });
const debug = (p) => p.evaluate(() => (window.padel ? window.padel.debug() : null));
async function attempt(vp, which, preset) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, hasTouch: true, isMobile: vp.w < 500 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(25000);
  await page.goto(BASE + "/?fx=low", { waitUntil: "load" });
  await sleep(1200);
  await page.getByText("Play vs Bot", { exact: true }).first().click();
  await sleep(400);
  await page.getByText("2 v 2 match", { exact: true }).first().click();
  await sleep(1200);
  const got = page.getByText("Got it");
  if (await got.count()) { await got.first().click(); await sleep(200); }
  await page.evaluate(([w, v]) => window.padel.setCamera(w, v), [which, preset]);
  await sleep(1400);
  const d = await debug(page);
  await ctx.close();
  return d && d.layout;
}
const cases = [
  { vp: { w: 390, h: 844 }, which: "portrait", presets: [
    { h: 17.4, z: -1.2, lookZ: 8.3 }, { h: 19.5, z: -1.0, lookZ: 7.6 },
    { h: 21.5, z: -0.5, lookZ: 7.0 }, { h: 23.5, z: 0.4, lookZ: 6.4 },
    { h: 20.5, z: -3.0, lookZ: 8.4 }, { h: 22.5, z: -2.0, lookZ: 7.6 } ] },
  { vp: { w: 320, h: 640 }, which: "portrait", presets: [ { h: 21.5, z: -0.5, lookZ: 7.0 }, { h: 23.5, z: 0.4, lookZ: 6.4 } ] },
  { vp: { w: 844, h: 390 }, which: "landscape", presets: [ { h: 13.6, z: -7.6, lookZ: 9.6 }, { h: 15.5, z: -6.0, lookZ: 9.0 }, { h: 17.5, z: -4.0, lookZ: 8.4 } ] },
];
for (const c of cases) {
  for (const pr of c.presets) {
    const L = await attempt(c.vp, c.which, pr);
    console.log(JSON.stringify({ viewport: c.vp.w + "x" + c.vp.h, preset: pr, padsTop: L && L.padsTop, scoreBottom: L && L.scoreBottom, player: L && L.player, playerVisible: L && L.playerVisible, hudClear: L && L.hudClear }));
  }
}
await browser.close();
server.kill("SIGTERM");
