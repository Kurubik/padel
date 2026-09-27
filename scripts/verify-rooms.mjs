// Guarded run for the remaining gates: wall drill, two-client room,
// four-client room. Every browser op has a hard timeout so nothing hangs.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/root/.openclaw/workspace/lottoresults/node_modules/playwright");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ART = join(ROOT, "artifacts");
const PORT = 18800 + (process.pid % 200);
const BASE = "http://127.0.0.1:" + PORT;
const FX = "?fx=low";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [], consoleErrors: [], pageErrors: [], shots: [], rooms: {} };
const errors = [];
function log(step, ok, detail) { report.steps.push({ step, ok: !!ok, detail }); console.log((ok ? "PASS " : "FAIL ") + step + " :: " + String(detail).slice(0, 180)); if (!ok) errors.push(step + ": " + detail); }
async function guard(name, fn, ms = 12000) {
  try { return await Promise.race([fn(), sleep(ms).then(() => { throw new Error("timeout " + name); })]); }
  catch (e) { console.log("GUARD-FAIL " + name + " :: " + String(e.message).slice(0, 120)); return null; }
}
async function startServer() {
  const child = spawn(process.execPath, [join(ROOT, "server/src/index.ts")], { env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" }, stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + "/healthz"); if (r.ok) return child; } catch { /* wait */ } await sleep(200); }
  throw new Error("server did not start");
}
const debug = (page) => guard("debug", () => page.evaluate(() => (window.padel ? window.padel.debug() : null)), 8000);
async function tapPad(page, dx = 0, dy = 0) {
  const b = await guard("hitpad box", () => page.locator(".hitpad").first().boundingBox(), 8000);
  if (!b) return;
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await guard("mouse", async () => { await page.mouse.move(cx, cy); await page.mouse.down(); if (dx || dy) await page.mouse.move(cx + dx, cy + dy, { steps: 2 }); await page.mouse.up(); }, 8000);
}
async function clickText(page, text) { return guard("click " + text, () => page.getByText(text, { exact: true }).first().click(), 15000); }
async function mk(browser, tag, url) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on("console", (m) => { if (m.type() === "error") report.consoleErrors.push(tag + ": " + m.text()); });
  page.on("pageerror", (e) => report.pageErrors.push(tag + ": " + String(e.message)));
  await guard("goto " + tag, () => page.goto(url, { waitUntil: "load" }), 25000);
  return { ctx, page };
}
async function waitFor(pred, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const d = await pred(); if (d) return d; await sleep(600); } return null; }
async function waitScore(page, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const d = await debug(page); if (d && d.score && (d.score.points[0] + d.score.points[1] > 0 || d.score.games[0] + d.score.games[1] > 0)) return d; await sleep(700); }
  return null;
}
async function main() {
  await mkdir(ART, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio", "--disable-audio-output"] });
  try {
    {
      console.log("== wall drill ==");
      const w = await mk(browser, "wall", BASE + "/" + FX);
      await sleep(1000);
      await clickText(w.page, "Wall Practice");
      await sleep(400);
      await clickText(w.page, "Wall drill");
      await sleep(1500);
      const d0 = await debug(w.page);
      log("wall drill mode runs", !!d0 && d0.mode === "wall", JSON.stringify(d0));
      for (let i = 0; i < 40; i++) {
        const d = await debug(w.page);
        const dr = d && d.drill;
        if (dr) {
          const dx = dr.ball.x - dr.player.x;
          const dy = dr.ball.y - dr.player.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0.6) {
            const b = await guard("stick box", () => w.page.locator(".stick").first().boundingBox(), 8000);
            if (b) {
              const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
              const s = 40 / dist;
              await guard("steer", async () => { await w.page.mouse.move(cx, cy); await w.page.mouse.down(); await w.page.mouse.move(cx + dx * s, cy + dy * s, { steps: 2 }); await sleep(120); await w.page.mouse.up(); }, 8000);
              continue;
            }
          }
        }
        await tapPad(w.page, 0, -18);
        await sleep(200);
        const st = await guard("streak read", () => w.page.locator(".scorebar .chip.a .pts").first().textContent(), 8000);
        if (Number(st) > 0) break;
      }
      const streak = await guard("streak read", () => w.page.locator(".scorebar .chip.a .pts").first().textContent(), 8000);
      const n = Number(streak);
      log("wall drill counted controlled returns", Number.isFinite(n) && n > 0, "streak=" + streak);
      await guard("wall shot", () => w.page.screenshot({ path: join(ART, "wall-390x844.png") }), 15000);
      report.shots.push("artifacts/wall-390x844.png");
      await w.ctx.close();
    }
    {
      console.log("== two-client room ==");
      const a = await mk(browser, "roomA", BASE + "/" + FX);
      await sleep(1000);
      await clickText(a.page, "Play with Friends");
      await sleep(2500);
      const code = ((await guard("code read", () => a.page.locator(".lobby-panel h1").first().textContent(), 8000)) || "").trim();
      report.rooms.two = code;
      log("room code issued", /^[A-Z0-9]{5}$/.test(code), code);
      const b = await mk(browser, "roomB", BASE + "/" + FX + "&room=" + code);
      await sleep(3000);
      const db = await debug(b.page);
      log("second client joined the room", !!db && db.code === code && db.seat !== 0, JSON.stringify(db));
      const seatB = db ? db.seat : -1;
      await clickText(a.page, "Start match");
      await sleep(2500);
      const db2 = await debug(b.page);
      log("guest receives authoritative snapshots", !!db2 && db2.players === 4, JSON.stringify(db2));
      await tapPad(a.page, 0, -30);
      const dA = await waitScore(a.page, 45000);
      log("online point decided by the server", !!dA, dA ? JSON.stringify(dA.score) : "timed out");
      await guard("room shot", () => a.page.screenshot({ path: join(ART, "room-host-390x844.png") }), 15000);
      report.shots.push("artifacts/room-host-390x844.png");
      await b.page.close();
      await sleep(1200);
      const b2 = await b.ctx.newPage();
      b2.setDefaultTimeout(20000);
      await guard("reconnect goto", () => b2.goto(BASE + "/" + FX + "&room=" + code, { waitUntil: "load" }), 25000);
      await sleep(3000);
      const db3 = await debug(b2);
      log("reconnect reclaims the same seat", !!db3 && db3.seat === seatB, "before=" + seatB + " after=" + JSON.stringify(db3));
      await a.ctx.close(); await b.ctx.close();
    }
    {
      console.log("== four-client room ==");
      const host = await mk(browser, "host4", BASE + "/" + FX);
      await sleep(1000);
      await clickText(host.page, "Play with Friends");
      await sleep(2500);
      const code = ((await guard("code4 read", () => host.page.locator(".lobby-panel h1").first().textContent(), 8000)) || "").trim();
      report.rooms.four = code;
      const others = [];
      for (let i = 0; i < 3; i++) others.push(await mk(browser, "guest4-" + i, BASE + "/" + FX + "&room=" + code));
      const seats = [await waitFor(async () => { const d = await debug(host.page); return d && d.code === code ? d : null; }, 15000)];
      for (const o of others) seats.push(await waitFor(async () => { const d = await debug(o.page); return d && d.code === code && d.seat !== 0 ? d : null; }, 15000));
      const uniq = new Set(seats.map((s) => s && s.seat));
      log("four distinct human seats", uniq.size === 4, JSON.stringify(seats.map((s) => s && s.seat)));
      await clickText(host.page, "Start match");
      await sleep(2500);
      const hd = await debug(host.page);
      log("four-human match started", !!hd && hd.connected === 4, JSON.stringify(hd));
      await tapPad(host.page, 0, -30);
      const after = await waitScore(host.page, 40000);
      log("four-player authoritative score moves", !!after, after ? JSON.stringify(after) : "timed out");
      await guard("room4 shot", () => host.page.screenshot({ path: join(ART, "room4-390x844.png") }), 15000);
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
main().catch(async (e) => { console.log("FATAL " + String((e && e.stack) || e).slice(0, 500)); process.exit(2); });
