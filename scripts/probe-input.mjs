import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/root/.openclaw/workspace/lottoresults/node_modules/playwright");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = 18750;
const BASE = "http://127.0.0.1:" + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = async (name, fn, ms = 6000) => {
  const t0 = Date.now();
  try { const v = await Promise.race([fn(), sleep(ms).then(() => { throw new Error("timeout " + name); })]); console.log("OK   " + name + " " + (Date.now() - t0) + "ms", v === undefined ? "" : JSON.stringify(v).slice(0, 120)); return v; }
  catch (e) { console.log("HANG " + name + " " + (Date.now() - t0) + "ms :: " + String(e.message).slice(0, 160)); return null; }
};
const server = spawn(process.execPath, [join(ROOT, "server/src/index.ts")], { env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" }, stdio: "ignore" });
for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + "/healthz"); if (r.ok) break; } catch {} await sleep(200); }
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
page.on("pageerror", (e) => console.log("PAGEERROR " + String(e.message).slice(0, 160)));
await T("goto", () => page.goto(BASE + "/?fx=low", { waitUntil: "load" }));
await sleep(2000);
await T("click Play vs Bot", () => page.getByText("Play vs Bot", { exact: true }).first().click());
await sleep(500);
await T("click 2v2", () => page.getByText("2 v 2 match", { exact: true }).first().click());
await sleep(1500);
const got = page.getByText("Got it");
if (await got.count()) await T("dismiss onboarding", () => got.first().click());
await T("debug", async () => await page.evaluate(() => window.padel.debug()));
const box = await T("hitpad box", () => page.locator(".hitpad").first().boundingBox());
if (box) {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await T("mouse.move", () => page.mouse.move(cx, cy));
  await T("mouse.down", () => page.mouse.down());
  await T("mouse.up", () => page.mouse.up());
  await sleep(400);
  await T("debug after tap", async () => await page.evaluate(() => window.padel.debug()));
  await T("screenshot", () => page.screenshot({ path: "/tmp/probe-shot.png" }), 15000);
}
await browser.close();
server.kill("SIGTERM");
