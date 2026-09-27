import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/root/.openclaw/workspace/lottoresults/node_modules/playwright");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = 19360;
const BASE = "http://127.0.0.1:" + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [join(ROOT, "server/src/index.ts")], { env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" }, stdio: "ignore" });
for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + "/healthz"); if (r.ok) break; } catch {} await sleep(200); }
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"] });
for (const vp of [{ width: 844, height: 390 }, { width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, hasTouch: true, isMobile: vp.width < 500 });
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
  await sleep(2500);
  const d = await page.evaluate(() => window.padel.debug());
  const pos = await page.evaluate(() => null);
  const hum = await page.evaluate(() => { const a = window.padel.debug(); return a && a.teams; });
  console.log("RESULT " + JSON.stringify({ vp: vp.width + "x" + vp.height, cam: d.camera && { pos: d.camera.pos, fov: d.camera.fov, aspect: d.camera.aspect, band: d.camera.band, near: d.camera.near && [Math.round(d.camera.near.x), Math.round(d.camera.near.y)], mid: d.camera.mid && [Math.round(d.camera.mid.x), Math.round(d.camera.mid.y)], far: d.camera.far && [Math.round(d.camera.far.x), Math.round(d.camera.far.y)], canvas: d.camera.canvas }, padsTop: d.layout && d.layout.padsTop, scoreBottom: d.layout && d.layout.scoreBottom, player: d.layout && d.layout.player, playerVisible: d.layout && d.layout.playerVisible, hudClear: d.layout && d.layout.hudClear, teams: hum }));
  await ctx.close();
}
await browser.close();
server.kill("SIGTERM");
