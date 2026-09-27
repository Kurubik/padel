// Interactive acceptance run using the app's own low-FX path (?fx=low) on a
// headless software-GL box, plus the bot/manual flows.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/root/.openclaw/workspace/lottoresults/node_modules/playwright");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ART = join(ROOT, "artifacts");
const PORT = 18600 + (process.pid % 300);
const BASE = "http://127.0.0.1:" + PORT;
const FX = "?fx=low";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [], consoleErrors: [], pageErrors: [], shots: [], rooms: {} };
const errors = [];
function log(step, ok, detail) { report.steps.push({ step, ok: !!ok, detail }); console.log((ok ? "PASS " : "FAIL ") + step + " :: " + String(detail).slice(0, 200)); if (!ok) errors.push(step + ": " + detail); }
async function startServer() {
  const child = spawn(process.execPath, [join(ROOT, "server/src/index.ts")], { env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" }, stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + "/healthz"); if (r.ok) return child; } catch { /* wait */ } await sleep(200); }
  throw new Error("server did not start");
}
async function center(page, sel) { const b = await page.locator(sel).first().boundingBox(); if (!b) throw new Error("no " + sel); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function tapPad(page, dx = 0, dy = 0) { const c = await center(page, ".hitpad"); await page.mouse.move(c.x, c.y); await page.mouse.down(); if (dx || dy) await page.mouse.move(c.x + dx, c.y + dy, { steps: 2 }); await page.mouse.up(); }
async function holdStick(page, dx, dy, ms) { const c = await center(page, ".stick"); await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + dx, c.y + dy, { steps: 2 }); await sleep(ms); await page.mouse.up(); }
const debug = (page) => page.evaluate(() => (window.padel ? window.padel.debug() : null));
async function mk(browser, tag, url) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.on("console", (m) => { if (m.type() === "error") report.consoleErrors.push(tag + ": " + m.text()); });
  page.on("pageerror", (e) => report.pageErrors.push(tag + ": " + String(e.message)));
  await page.goto(url, { waitUntil: "load" });
  return { ctx, page };
}
async function waitScore(page, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const d = await debug(page);
    if (d && d.score && (d.score.points[0] + d.score.points[1] > 0 || d.score.games[0] + d.score.games[1] > 0)) return d;
    await sleep(800);
  }
  return null;
}
async function main() {
  await mkdir(ART, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio", "--disable-audio-output"] });
  try {
    {
      console.log("== bot flow ==");
      const a = await mk(browser, "bot", BASE + "/" + FX);
      await sleep(1800);
      await a.page.getByText("Play vs Bot", { exact: true }).first().click();
      await sleep(400);
      await a.page.getByText("2 v 2 match", { exact: true }).first().click();
      await sleep(1200);
      const got = a.page.getByText("Got it");
      if (await got.count()) { await got.first().click(); await sleep(200); }
      const d0 = await debug(a.page);
      log("bot 2v2 active with 4 players", !!d0 && d0.mode === "bot" && d0.players === 4, JSON.stringify(d0));
      await tapPad(a.page, 0, -30);
      await sleep(800);
      for (let i = 0; i < 6; i++) { await holdStick(a.page, i % 2 ? 20 : -20, -12, 70); await tapPad(a.page, 0, -16); await sleep(120); }
      const d1 = await debug(a.page);
      const ball = d1 && d1.ball;
      log("ball stays inside the court", !!ball && Math.abs(ball.x) <= 5.6 && ball.y >= -0.5 && ball.y <= 20.5 && ball.z >= -0.1 && ball.z <= 6, JSON.stringify(ball));
      await a.page.screenshot({ path: join(ART, "rally-390x844.png") });
      report.shots.push("artifacts/rally-390x844.png");
      const scored = await waitScore(a.page, 45000);
      log("a point was scored in bot mode", !!scored, scored ? JSON.stringify(scored.score) : "timed out");
      await a.page.screenshot({ path: join(ART, "score-390x844.png") });
      report.shots.push("artifacts/score-390x844.png");
      await a.ctx.close();
    }
    {
      console.log("== wall drill ==");
      const w = await mk(browser, "wall", BASE + "/" + FX);
      await sleep(1200);
      await w.page.getByText("Wall Practice", { exact: true }).first().click();
      await sleep(400);
      await w.page.getByText("Wall drill", { exact: true }).first().click();
      await sleep(1500);
      let best = 0;
      for (let i = 0; i < 12; i++) { await holdStick(w.page, (i % 4 - 2) * 12, -6, 50); await tapPad(w.page, 0, -18); await sleep(220); const n = Number(await w.page.locator(".scorebar .chip.a .pts").first().innerText()); if (Number.isFinite(n)) best = Math.max(best, n); }
      const d = await debug(w.page);
      log("wall drill mode runs", !!d && d.mode === "wall", JSON.stringify(d));
      log("wall drill counted controlled returns", best > 0, "best=" + best);
      await w.page.screenshot({ path: join(ART, "wall-390x844.png") });
      report.shots.push("artifacts/wall-390x844.png");
      await w.ctx.close();
    }
    {
      console.log("== two-client room ==");
      const a = await mk(browser, "roomA", BASE + "/" + FX);
      await sleep(1200);
      await a.page.getByText("Play with Friends", { exact: true }).first().click();
      await sleep(2500);
      const code = (await a.page.locator(".lobby-panel h1").first().innerText()).trim();
      report.rooms.two = code;
      log("room code issued", /^[A-Z0-9]{5}$/.test(code), code);
      const b = await mk(browser, "roomB", BASE + "/" + FX + "&room=" + code);
      await sleep(3000);
      const db = await debug(b.page);
      log("second client joined the room", !!db && db.code === code && db.seat !== 0, JSON.stringify(db));
      const seatB = db ? db.seat : -1;
      await a.page.getByText("Start match", { exact: true }).first().click();
      await sleep(2500);
      const db2 = await debug(b.page);
      log("guest receives authoritative snapshots", !!db2 && db2.players === 4, JSON.stringify(db2));
      await tapPad(a.page, 0, -30);
      const dA = await waitScore(a.page, 45000);
      log("online point decided by the server", !!dA, dA ? JSON.stringify(dA.score) : "timed out");
      await a.page.screenshot({ path: join(ART, "room-host-390x844.png") });
      report.shots.push("artifacts/room-host-390x844.png");
      await b.page.close();
      await sleep(1200);
      const b2 = await b.ctx.newPage();
      b2.setDefaultTimeout(30000);
      await b2.goto(BASE + "/" + FX + "&room=" + code, { waitUntil: "load" });
      await sleep(3000);
      const db3 = await debug(b2);
      log("reconnect reclaims the same seat", !!db3 && db3.seat === seatB, "before=" + seatB + " after=" + JSON.stringify(db3));
      await a.ctx.close(); await b.ctx.close();
    }
    {
      console.log("== four-client room ==");
      const host = await mk(browser, "host4", BASE + "/" + FX);
      await sleep(1200);
      await host.page.getByText("Play with Friends", { exact: true }).first().click();
      await sleep(2500);
      const code = (await host.page.locator(".lobby-panel h1").first().innerText()).trim();
      report.rooms.four = code;
      const others = [];
      for (let i = 0; i < 3; i++) others.push(await mk(browser, "guest4-" + i, BASE + "/" + FX + "&room=" + code));
      await sleep(4000);
      const seats = [await debug(host.page)];
      for (const o of others) seats.push(await debug(o.page));
      const uniq = new Set(seats.map((s) => s && s.seat));
      log("four distinct human seats", uniq.size === 4, JSON.stringify(seats.map((s) => s && s.seat)));
      await host.page.getByText("Start match", { exact: true }).first().click();
      await sleep(2500);
      const hd = await debug(host.page);
      log("four-human match started", !!hd && hd.connected === 4, JSON.stringify(hd));
      await tapPad(host.page, 0, -30);
      const after = await waitScore(host.page, 40000);
      log("four-player authoritative score moves", !!after, after ? JSON.stringify(after) : "timed out");
      await host.page.screenshot({ path: join(ART, "room4-390x844.png") });
      report.shots.push("artifacts/room4-390x844.png");
      await host.ctx.close();
      for (const o of others) await o.ctx.close();
    }
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }
  await writeFile(join(ART, "gates-report.json"), JSON.stringify(report, null, 2));
  console.log("SUMMARY " + JSON.stringify({ ok: errors.length === 0, errors, consoleErrors: report.consoleErrors, pageErrors: report.pageErrors, rooms: report.rooms }));
  if (errors.length) process.exitCode = 1;
}
main().catch(async (e) => { console.log("FATAL " + String((e && e.stack) || e).slice(0, 500)); await writeFile(join(ART, "gates-report.json"), JSON.stringify({ ...report, fatal: String(e) }, null, 2)); process.exit(2); });
