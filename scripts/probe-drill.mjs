import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/root/.openclaw/workspace/lottoresults/node_modules/playwright");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = 19460;
const BASE = "http://127.0.0.1:" + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [join(ROOT, "server/src/index.ts")], { env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" }, stdio: "ignore" });
for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + "/healthz"); if (r.ok) break; } catch {} await sleep(200); }
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
await page.goto(BASE + "/?fx=low", { waitUntil: "load" });
await sleep(1200);
await page.getByText("Wall Practice", { exact: true }).first().click();
await sleep(400);
await page.getByText("Wall drill", { exact: true }).first().click();
await sleep(1500);
function screenFromCourt(d, dir) {
  const b = d && d.basis;
  if (!b) return { x: 0, y: 0 };
  const a1 = b.right.x, b1 = -b.fwd.x, c1 = b.right.y, d1 = -b.fwd.y;
  const det = a1 * d1 - b1 * c1;
  if (Math.abs(det) < 1e-6) return { x: 0, y: 0 };
  return { x: (d1 * dir.x - b1 * dir.y) / det, y: (-c1 * dir.x + a1 * dir.y) / det };
}
async function stick(page, dir, ms) {
  const b = await page.locator(".stick").first().boundingBox();
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2, r = b.width * 0.34;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dir.x * r, cy + dir.y * r, { steps: 3 });
  await sleep(ms);
  await page.mouse.up();
}
for (let i = 0; i < 26; i++) {
  const d = await page.evaluate(() => window.padel.debug());
  const dr = d && d.drill;
  if (!dr) { console.log("NO DRILL STATE"); break; }
  const dx = dr.ball.x - dr.player.x, dy = dr.ball.y - dr.player.y;
  const dist = Math.hypot(dx, dy);
  const sdir = screenFromCourt(d, { x: dx / (dist || 1), y: dy / (dist || 1) });
  console.log("SAMPLE " + JSON.stringify({ i, player: [ +dr.player.x.toFixed(2), +dr.player.y.toFixed(2) ], ball: [ +dr.ball.x.toFixed(2), +dr.ball.y.toFixed(2), +dr.ball.z.toFixed(2) ], dist: +dist.toFixed(2), canHit: dr.canHit, streak: dr.streak, steer: [ +sdir.x.toFixed(2), +sdir.y.toFixed(2) ] }));
  if (dr.streak > 0) { console.log("EARNED " + dr.streak); break; }
  if (dr.canHit) {
    const c = await page.locator(".hitpad").first().boundingBox();
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await page.mouse.down();
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2 - 18, { steps: 2 });
    await page.mouse.up();
    await sleep(150);
  } else {
    await stick(page, sdir, 150);
  }
}
await browser.close();
server.kill("SIGTERM");
