// Real-browser verification for PADEL//CLUB (acceptance gates 3 and 4).
// Usage: PLAYWRIGHT_MODULE=<path>/playwright node scripts/verify-browser.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const pwPath = process.env.PLAYWRIGHT_MODULE || "/root/.openclaw/workspace/lottoresults/node_modules/playwright";
const { chromium } = require(pwPath);

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ART = join(ROOT, "artifacts");
const PORT = 18200 + (process.pid % 300);
const BASE = "http://127.0.0.1:" + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = { consoleErrors: [], pageErrors: [], steps: [], shots: [], overflow: [], fps: [], rooms: {} };
const errors = [];
function log(step, ok, detail) { report.steps.push({ step, ok: !!ok, detail }); if (!ok) errors.push(step + ": " + detail); }
function attach(page, tag) {
  page.on("console", (m) => { if (m.type() === "error") report.consoleErrors.push(tag + ": " + m.text()); });
  page.on("pageerror", (e) => report.pageErrors.push(tag + ": " + String(e.message)));
}
async function startServer() {
  const child = spawn(process.execPath, [join(ROOT, "server/src/index.ts")], { env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + "/healthz"); if (r.ok) return child; } catch { /* wait */ } await sleep(200); }
  throw new Error("server did not start");
}
async function center(page, sel) {
  const box = await page.locator(sel).first().boundingBox();
  if (!box) throw new Error("no box for " + sel);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, w: box.width, h: box.height };
}
async function tapPad(page, dx = 0, dy = 0) {
  const c = await center(page, ".hitpad");
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  if (dx || dy) await page.mouse.move(c.x + dx, c.y + dy, { steps: 4 });
  await page.mouse.up();
}
async function holdStick(page, dx, dy, ms) {
  const c = await center(page, ".stick");
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx, c.y + dy, { steps: 4 });
  await sleep(ms);
  await page.mouse.up();
}
async function debug(page) { return page.evaluate(() => (window.padel ? window.padel.debug() : null)); }
async function tapText(page, text) { await page.getByText(text, { exact: true }).first().click(); }
async function shot(page, name, w, h) { await page.screenshot({ path: join(ART, name + ".png") }); report.shots.push({ name, w, h, file: "artifacts/" + name + ".png" }); }
async function overflowCheck(page, label) {
  const res = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, scrollH: document.documentElement.scrollHeight, innerH: window.innerHeight }));
  const bad = res.scrollW > res.innerW + 1 || res.scrollH > res.innerH + 1;
  report.overflow.push({ label, ...res, bad });
  return bad;
}

async function main() {
  await mkdir(ART, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    for (const vp of [{ w: 320, h: 640, tag: "320x640" }, { w: 390, h: 844, tag: "390x844" }, { w: 844, h: 390, tag: "landscape" }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2, hasTouch: true, isMobile: vp.w < 500 });
      const page = await ctx.newPage();
      page.setDefaultTimeout(25000);
      attach(page, "home-" + vp.tag);
      await page.goto(BASE, { waitUntil: "load" });
      await sleep(1400);
      await shot(page, "home-" + vp.tag, vp.w, vp.h);
      const bad = await overflowCheck(page, "home-" + vp.tag);
      log("home renders " + vp.tag, !bad, bad ? "overflow" : "ok");
      const brand = await page.locator("h1").first().innerText();
      log("brand present " + vp.tag, /PADEL/.test(brand), brand);
      const padBox = await center(page, ".hitpad").catch(() => null);
      await tapText(page, "Rules");
      await sleep(600);
      const lessons = await page.locator(".lesson").count();
      log("rules lessons " + vp.tag, lessons === 7, "count=" + lessons);
      await shot(page, "rules-" + vp.tag, vp.w, vp.h);
      void padBox;
      await ctx.close();
    }

    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
      const page = await ctx.newPage();
      page.setDefaultTimeout(25000);
      attach(page, "bot");
      await page.goto(BASE, { waitUntil: "load" });
      await sleep(800);
      await tapText(page, "Play vs Bot");
      await sleep(400);
      await tapText(page, "2 v 2 match");
      await sleep(1000);
      const onboard = page.getByText("Got it");
      if (await onboard.count()) { await onboard.first().click(); await sleep(300); }
      const d0 = await debug(page);
      log("bot mode active", d0 && d0.mode === "bot", JSON.stringify(d0));
      log("bot court has four players", !!d0 && d0.players === 4, JSON.stringify(d0));
      const controls = await page.evaluate(() => { const s = document.querySelector(".stick"); const h = document.querySelector(".hitpad"); const l = document.querySelector(".lob"); const r = (n) => { const b = n.getBoundingClientRect(); return Math.min(b.width, b.height); }; return { stick: r(s), hitpad: r(h), lob: r(l) }; });
      log("touch targets >= 44px", controls.stick >= 44 && controls.hitpad >= 44 && controls.lob >= 44, JSON.stringify(controls));
      await tapPad(page, 0, -30);
      await sleep(500);
      for (let i = 0; i < 30; i++) { await holdStick(page, i % 2 ? 26 : -26, -16, 90); await tapPad(page, (i % 3 - 1) * 26, -20); await sleep(200); }
      const d1 = await debug(page);
      report.fps.push(d1 && d1.fps);
      log("bot fps >= 15 (headless software GL)", !!d1 && d1.fps >= 15, "fps=" + (d1 && d1.fps));
      const ball = d1 && d1.ball;
      const inBounds = !!ball && Math.abs(ball.x) <= 5.6 && ball.y >= -0.5 && ball.y <= 20.5 && ball.z >= -0.1 && ball.z <= 6;
      log("ball stays within court bounds", inBounds, JSON.stringify(ball));
      await shot(page, "rally-390x844", 390, 844);
      let scored = null;
      for (let i = 0; i < 120 && !scored; i++) {
        await holdStick(page, (i % 5 - 2) * 12, -10, 70);
        await tapPad(page, (i % 4 - 2) * 20, -18);
        await sleep(110);
        const d = await debug(page);
        if (d && d.score && (d.score.games[0] + d.score.games[1] > 0 || d.score.points[0] + d.score.points[1] > 0)) scored = d.score;
      }
      log("a point was scored vs bot", !!scored, JSON.stringify(scored));
      await shot(page, "score-390x844", 390, 844);
      await ctx.close();
    }

    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
      const page = await ctx.newPage();
      page.setDefaultTimeout(25000);
      attach(page, "wall");
      await page.goto(BASE, { waitUntil: "load" });
      await sleep(700);
      await tapText(page, "Wall Practice");
      await sleep(400);
      await tapText(page, "Wall drill");
      await sleep(1300);
      let best = 0;
      for (let i = 0; i < 44; i++) {
        await holdStick(page, (i % 4 - 2) * 16, -8, 60);
        await tapPad(page, 0, -22);
        await sleep(170);
        const n = Number(await page.locator(".scorebar .chip.a .pts").first().innerText());
        if (Number.isFinite(n)) best = Math.max(best, n);
      }
      const d = await debug(page);
      log("wall drill runs", d && d.mode === "wall", JSON.stringify(d));
      log("wall drill counted controlled returns", best > 0, "best streak=" + best);
      await shot(page, "wall-390x844", 390, 844);
      await ctx.close();
    }

    {
      const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
      const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
      const a = await ctxA.newPage();
      const b = await ctxB.newPage();
      a.setDefaultTimeout(25000);
      b.setDefaultTimeout(25000);
      attach(a, "roomA"); attach(b, "roomB");
      await a.goto(BASE, { waitUntil: "load" });
      await sleep(700);
      await tapText(a, "Play with Friends");
      await sleep(1600);
      const code = (await a.locator(".lobby-panel h1").first().innerText()).trim();
      log("room code issued", /^[A-Z0-9]{5}$/.test(code), code);
      report.rooms.two = code;
      await b.goto(BASE + "/?room=" + code, { waitUntil: "load" });
      await sleep(1800);
      const db = await debug(b);
      log("second client joined the room", !!db && db.code === code, JSON.stringify(db));
      log("second client has its own seat", !!db && db.seat !== 0, JSON.stringify(db));
      const seatB = db ? db.seat : -1;
      await tapText(a, "Start match");
      await sleep(1400);
      const db2 = await debug(b);
      log("guest receives 4-player snapshots", !!db2 && db2.players === 4, JSON.stringify(db2));
      await tapPad(a, 0, -30);
      for (let i = 0; i < 50; i++) { const p = i % 2 === 0 ? a : b; await holdStick(p, (i % 4 - 2) * 14, -10, 80); await tapPad(p, 0, -18); await sleep(130); }
      const dA = await debug(a);
      const pointSeen = !!dA && dA.score && (dA.score.points[0] + dA.score.points[1] > 0 || dA.score.games[0] + dA.score.games[1] > 0);
      log("online point scored by the server", pointSeen, JSON.stringify(dA));
      await shot(a, "room-host-390x844", 390, 844);
      await shot(b, "room-guest-390x844", 390, 844);
      await b.close();
      await sleep(1400);
      const b2 = await ctxB.newPage();
      attach(b2, "roomB2");
      await b2.goto(BASE + "/?room=" + code, { waitUntil: "load" });
      await sleep(2000);
      const db3 = await debug(b2);
      log("reconnect reclaims the same seat", !!db3 && db3.seat === seatB, "before=" + seatB + " after=" + JSON.stringify(db3));
      await ctxA.close(); await ctxB.close();
    }

    {
      const ctxs = [];
      const pages = [];
      const hostCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true });
      ctxs.push(hostCtx);
      const host = await hostCtx.newPage();
      host.setDefaultTimeout(25000);
      attach(host, "room4-host");
      await host.goto(BASE, { waitUntil: "load" });
      await sleep(700);
      await tapText(host, "Play with Friends");
      await sleep(1600);
      const code = (await host.locator(".lobby-panel h1").first().innerText()).trim();
      report.rooms.four = code;
      pages.push(host);
      for (let i = 0; i < 3; i++) {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true });
        ctxs.push(ctx);
        const p = await ctx.newPage();
        attach(p, "room4-" + i);
        await p.goto(BASE + "/?room=" + code, { waitUntil: "load" });
        pages.push(p);
      }
      await sleep(2400);
      const seats = [];
      for (const p of pages) seats.push(await debug(p));
      const unique = new Set(seats.map((s) => s && s.seat));
      log("four humans occupy four distinct seats", unique.size === 4, JSON.stringify(seats.map((s) => s && s.seat)));
      const fifthCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
      const fifth = await fifthCtx.newPage();
      attach(fifth, "room4-fifth");
      await fifth.goto(BASE + "/?room=" + code, { waitUntil: "load" });
      await sleep(1600);
      const d5 = await debug(fifth);
      log("fifth client is refused when full", !!d5 && d5.seat === 0, JSON.stringify(d5));
      await fifthCtx.close();
      await tapText(host, "Start match");
      await sleep(1600);
      const hd = await debug(host);
      log("four-human match started", !!hd && hd.connected === 4, JSON.stringify(hd));
      await tapPad(host, 0, -30);
      await sleep(2200);
      const after = await debug(host);
      log("four-player snapshots flow", !!after && after.players === 4, JSON.stringify(after));
      await shot(host, "room4-390x844", 390, 844);
      for (const c of ctxs) await c.close();
    }
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }
  await writeFile(join(ART, "browser-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: errors.length === 0, errors, steps: report.steps.length, shots: report.shots.length, consoleErrors: report.consoleErrors, pageErrors: report.pageErrors, fps: report.fps }, null, 2));
  if (errors.length) process.exitCode = 1;
}

main().catch(async (e) => {
  await writeFile(join(ART, "browser-report.json"), JSON.stringify({ ...report, fatal: String((e && e.stack) || e) }, null, 2));
  console.error("FATAL", e);
  process.exit(2);
});
