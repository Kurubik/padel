// Quality screenshots at the shipping quality level (shadows + full DPR).
// Usage: PLAYWRIGHT_MODULE=<path>/playwright node scripts/shot-scenes.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/root/.openclaw/workspace/lottoresults/node_modules/playwright");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ART = join(ROOT, "artifacts");
const PORT = 19560;
const BASE = "http://127.0.0.1:" + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [join(ROOT, "server/src/index.ts")], { env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" }, stdio: "ignore" });
for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + "/healthz"); if (r.ok) break; } catch {} await sleep(200); }
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"] });
const debug = (p) => p.evaluate(() => (window.padel ? window.padel.debug() : null));
async function mk(vp) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: vp.width < 500 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(25000);
  await page.goto(BASE, { waitUntil: "load" });
  return { ctx, page };
}
async function tap(page, cx, cy, dx, dy) {
  await page.mouse.move(cx, cy); await page.mouse.down();
  if (dx || dy) await page.mouse.move(cx + dx, cy + dy, { steps: 3 });
  await page.mouse.up();
}
await mkdir(ART, { recursive: true });
// Hero: home screens with the live attract rally.
for (const vp of [{ width: 320, height: 640, tag: "320x640" }, { width: 390, height: 844, tag: "390x844" }, { width: 844, height: 390, tag: "landscape" }]) {
  const h = await mk(vp);
  await sleep(4200);
  await h.page.screenshot({ path: join(ART, "home-" + vp.tag + ".png") });
  console.log("SHOT home-" + vp.tag);
  await h.ctx.close();
}
// Rules.
{
  const r = await mk({ width: 390, height: 844 });
  await sleep(1200);
  await r.page.getByText("Rules", { exact: true }).first().click();
  await sleep(900);
  await r.page.screenshot({ path: join(ART, "rules-390x844.png") });
  console.log("SHOT rules-390x844");
  await r.ctx.close();
}
// Bot rally + score card.
{
  const b = await mk({ width: 390, height: 844 });
  await sleep(1200);
  await b.page.getByText("Play vs Bot", { exact: true }).first().click();
  await sleep(400);
  await b.page.getByText("2 v 2 match", { exact: true }).first().click();
  await sleep(1300);
  const got = b.page.getByText("Got it");
  if (await got.count()) { await got.first().click(); await sleep(250); }
  await sleep(500);
  const pad = await b.page.locator(".hitpad").first().boundingBox();
  await tap(b.page, pad.x + pad.width / 2, pad.y + pad.height / 2, 0, -28);
  for (let i = 0; i < 8; i++) {
    const st = await b.page.locator(".stick").first().boundingBox();
    await b.page.mouse.move(st.x + st.width / 2, st.y + st.height / 2);
    await b.page.mouse.down();
    await b.page.mouse.move(st.x + st.width / 2 + (i % 2 ? 22 : -22), st.y + st.height / 2 - 14, { steps: 3 });
    await sleep(90);
    await b.page.mouse.up();
    await tap(b.page, pad.x + pad.width / 2, pad.y + pad.height / 2, 0, -16);
    await sleep(260);
  }
  await b.page.screenshot({ path: join(ART, "rally-390x844.png") });
  console.log("SHOT rally-390x844 " + JSON.stringify(await debug(b.page)).slice(0, 90));
  await b.ctx.close();
}
// Wall drill mid-play.
{
  const w = await mk({ width: 390, height: 844 });
  await sleep(1200);
  await w.page.getByText("Wall Practice", { exact: true }).first().click();
  await sleep(400);
  await w.page.getByText("Wall drill", { exact: true }).first().click();
  await sleep(1600);
  for (let i = 0; i < 22; i++) {
    const d = await debug(w.page);
    const dr = d && d.drill;
    if (!dr) break;
    const st = await w.page.locator(".stick").first().boundingBox();
    if (dr.canHit) {
      const pad = await w.page.locator(".hitpad").first().boundingBox();
      await w.page.screenshot({ path: join(ART, "wall-390x844.png") });
      console.log("SHOT wall-390x844 streak=" + dr.streak + " canHit=" + dr.canHit);
      await tap(w.page, pad.x + pad.width / 2, pad.y + pad.height / 2, 0, -18);
      break;
    }
    const dx = dr.ball.x - dr.player.x, dy = dr.ball.y - dr.player.y;
    const dist = Math.hypot(dx, dy) || 1;
    await w.page.mouse.move(st.x + st.width / 2, st.y + st.height / 2);
    await w.page.mouse.down();
    await w.page.mouse.move(st.x + st.width / 2 + (dx / dist) * 30, st.y + st.height / 2 + (dy / dist) * 30, { steps: 3 });
    await sleep(150);
    await w.page.mouse.up();
  }
  await w.ctx.close();
}
// Four-client room in play.
{
  const host = await mk({ width: 390, height: 844 });
  await sleep(1200);
  await host.page.getByText("Play with Friends", { exact: true }).first().click();
  const code = await (async () => { for (let i = 0; i < 30; i++) { const d = await debug(host.page); if (d && d.code) return d.code; await sleep(500); } return ""; })();
  const guests = [];
  for (let i = 0; i < 3; i++) {
    const g = await mk({ width: 390, height: 844 });
    await g.page.goto(BASE + "/?room=" + code, { waitUntil: "load" });
    guests.push(g);
  }
  for (let i = 0; i < 30; i++) { const d = await debug(guests[2].page); if (d && d.code === code) break; await sleep(600); }
  await host.page.getByText("Start match", { exact: true }).first().click();
  await sleep(3000);
  const pad = await host.page.locator(".hitpad").first().boundingBox();
  await tap(host.page, pad.x + pad.width / 2, pad.y + pad.height / 2, 0, -28);
  await sleep(2600);
  await host.page.screenshot({ path: join(ART, "room4-390x844.png") });
  console.log("SHOT room4-390x844 code=" + code + " " + JSON.stringify(await debug(host.page)).slice(0, 90));
  await host.ctx.close();
  for (const g of guests) await g.ctx.close();
}
await browser.close();
server.kill("SIGTERM");
console.log("SCENES DONE");
