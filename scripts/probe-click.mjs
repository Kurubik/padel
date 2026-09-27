import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/root/.openclaw/workspace/lottoresults/node_modules/playwright");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = 18311;
const BASE = "http://127.0.0.1:" + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [join(ROOT, "server/src/index.ts")], { env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { const r = await fetch(BASE + "/healthz"); if (r.ok) break; } catch {} await sleep(200); }
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await sleep(2000);
const info = await page.evaluate(() => {
  const spans = [...document.querySelectorAll("button span")];
  const target = spans.find((s) => s.textContent === "Rules");
  if (!target) return { found: false };
  const b = target.getBoundingClientRect();
  const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
  const top = document.elementFromPoint(cx, cy);
  return { found: true, rect: { x: b.x, y: b.y, w: b.width, h: b.height }, cx, cy, topTag: top ? top.tagName + "." + top.className : null, innerH: window.innerHeight };
});
console.log("PROBE", JSON.stringify(info));
let clickErr = null;
try {
  await page.getByText("Rules", { exact: true }).first().click({ timeout: 25000 });
} catch (e) { clickErr = String(e).split("\n").slice(0, 8).join(" | "); }
console.log("CLICK", clickErr ? "FAILED " + clickErr : "OK");
const lessons = await page.locator(".lesson").count();
console.log("LESSONS", lessons);
await browser.close();
server.kill("SIGTERM");
