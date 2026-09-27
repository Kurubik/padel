// PADEL//CLUB acceptance gates. Every step must be true for the run to pass.
// Usage: PLAYWRIGHT_MODULE=<path>/playwright node scripts/verify-gates.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/root/.openclaw/workspace/lottoresults/node_modules/playwright");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ART = join(ROOT, "artifacts");
const PORT = 19100 + (process.pid % 300);
const BASE = "http://127.0.0.1:" + PORT;
const FX = "fx=low";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [], consoleErrors: [], pageErrors: [], rooms: {}, layout: {}, drill: {}, seats: {} };
const errors = [];
function log(step, ok, detail) { report.steps.push({ step, ok: !!ok, detail }); console.log((ok ? "PASS " : "FAIL ") + step + " :: " + String(detail).slice(0, 240)); if (!ok) errors.push(step + ": " + detail); }
async function guard(name, fn, ms = 15000) {
  try { return await Promise.race([fn(), sleep(ms).then(() => { throw new Error("timeout " + name); })]); }
  catch (e) { console.log("  guard-fail " + name + " :: " + String(e.message).slice(0, 120)); return null; }
}
async function startServer() {
  const child = spawn(process.execPath, [join(ROOT, "server/src/index.ts")], { env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" }, stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + "/healthz"); if (r.ok) return child; } catch { /* wait */ } await sleep(200); }
  throw new Error("server did not start");
}
async function mk(browser, tag, url, vp) {
  const view = vp || { width: 390, height: 844 };
  const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: 1, hasTouch: true, isMobile: view.width < 500 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(25000);
  page.on("console", (m) => { if (m.type() === "error") report.consoleErrors.push(tag + ": " + m.text()); });
  page.on("pageerror", (e) => report.pageErrors.push(tag + ": " + String(e.message)));
  await guard("goto " + tag, () => page.goto(url, { waitUntil: "load" }), 30000);
  return { ctx, page };
}
const debug = (page) => guard("debug", () => page.evaluate(() => (window.padel ? window.padel.debug() : null)), 9000);
async function center(page, sel) {
  await page.waitForSelector(sel, { timeout: 20000 });
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error("no box " + sel);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
}
async function tapPad(page, dx = 0, dy = 0) {
  const c = await guard("hitpad", () => center(page, ".hitpad"), 12000);
  if (!c) return;
  await guard("tap", async () => { await page.mouse.move(c.x, c.y); await page.mouse.down(); if (dx || dy) await page.mouse.move(c.x + dx, c.y + dy, { steps: 2 }); await page.mouse.up(); }, 9000);
}
/** Screen-space stick offset that drives the player along a court-space direction. */
function screenFromCourt(d, dir) {
  const b = d && d.basis;
  if (!b) return { x: 0, y: 0 };
  const a1 = b.right.x, b1 = -b.fwd.x, c1 = b.right.y, d1 = -b.fwd.y;
  const det = a1 * d1 - b1 * c1;
  if (Math.abs(det) < 1e-6) return { x: 0, y: 0 };
  return { x: (d1 * dir.x - b1 * dir.y) / det, y: (-c1 * dir.x + a1 * dir.y) / det };
}
async function stickMove(page, dir, ms) {
  const c = await guard("stick", () => center(page, ".stick"), 12000);
  if (!c) return;
  const r = c.w * 0.34;
  await guard("stick move", async () => {
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + dir.x * r, c.y + dir.y * r, { steps: 3 });
    await sleep(ms);
    await page.mouse.up();
  }, 12000);
}
async function clickText(page, text) { return guard("click " + text, () => page.getByText(text, { exact: true }).first().click(), 20000); }
async function waitFor(pred, ms, every = 500) { const t0 = Date.now(); for (;;) { const v = await pred(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); } }
/** Start a 2v2 bot match and return the first debug snapshot in play mode. */
async function startBot(page) {
  await clickText(page, "Play vs Bot");
  await sleep(400);
  await clickText(page, "2 v 2 match");
  await sleep(1200);
  const got = page.getByText("Got it");
  if (await got.count()) { await guard("onboard", () => got.first().click(), 12000); await sleep(250); }
  return waitFor(async () => { const d = await debug(page); return d && d.mode === "bot" ? d : null; }, 20000);
}
/** Steer to the feed ball and swing until the drill credits one controlled return. */
async function earnDrillReturn(page, maxSteps = 70) {
  let last = null;
  let missing = 0;
  for (let i = 0; i < maxSteps; i++) {
    const d = await debug(page);
    if (!d || !d.drill) {
      // Entering the drill mode can lag behind the click on a busy page.
      if (++missing > 40) return { streak: 0, note: "no drill state" };
      await sleep(400);
      continue;
    }
    last = d.drill;
    if (d.drill.streak > 0) return { streak: d.drill.streak, best: d.drill.best, note: "controlled return earned" };
    const dx = d.drill.ball.x - d.drill.player.x;
    const dy = d.drill.ball.y - d.drill.player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1.15) {
      await stickMove(page, screenFromCourt(d, { x: dx / dist, y: dy / dist }), 120);
    } else if (d.drill.canHit) {
      await tapPad(page, 0, -16);
      await sleep(170);
    } else {
      await sleep(120);
    }
  }
  return { streak: last ? last.streak : 0, note: "attempts exhausted" };
}
async function main() {
  await mkdir(ART, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio", "--disable-audio-output"] });
  try {
    // 1-3. Home renders everywhere, with a live rally behind the menu.
    for (const vp of [{ width: 320, height: 640, tag: "320x640" }, { width: 390, height: 844, tag: "390x844" }, { width: 844, height: 390, tag: "landscape" }]) {
      const h = await mk(browser, "home-" + vp.tag, BASE + "/?" + FX, vp);
      await sleep(1600);
      const over = await page0(h.page);
      const samples = [];
      for (let i = 0; i < 6; i++) { samples.push(await debug(h.page)); await sleep(550); }
      const moved = samples.some((d, i) => i > 0 && samples[i - 1] && d && samples[i - 1].ball && d.ball && (Math.abs(samples[i - 1].ball.x - d.ball.x) + Math.abs(samples[i - 1].ball.y - d.ball.y)) > 0.05);
      const fourBots = samples.some((d) => d && d.demo && d.demo.players === 4);
      const rallied = samples.some((d) => d && d.demo && d.demo.phase === "rally");
      log("home renders " + vp.tag, over.brand && !over.bad, JSON.stringify(over));
      log("home hero shows a live rally " + vp.tag, fourBots && moved && rallied, JSON.stringify({ fourBots, moved, rallied, last: samples[samples.length - 1] && samples[samples.length - 1].demo }));
      await h.ctx.close();
    }
    // 4. Rules: seven illustrated lessons and the corrected pair-positioning advice.
    {
      const r = await mk(browser, "rules", BASE + "/?" + FX);
      await sleep(1200);
      await clickText(r.page, "Rules");
      await sleep(700);
      const lessons = await guard("lessons", () => r.page.locator(".lesson").count(), 9000);
      const text = await guard("rules text", () => r.page.locator(".lesson").last().innerText(), 9000) || "";
      const fit = await guard("fit", () => r.page.evaluate(() => { const p = document.querySelector(".lesson .panel, .panel"); return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, panel: p ? Math.round(p.getBoundingClientRect().right) : 0 }; }), 9000);
      const pairWording = /pair/i.test(text) && !/one up/i.test(text);
      log("rules show seven lessons", lessons === 7, "count=" + lessons);
      log("rules lesson 7 teaches pair movement", pairWording, text.slice(0, 150));
      log("rules fit the viewport", !!fit && fit.sw <= fit.iw + 1, JSON.stringify(fit));
      await r.ctx.close();
    }
    // 5-7. Match layout at three viewports: score visible, avatar above the pads.
    for (const vp of [{ width: 390, height: 844, tag: "390x844" }, { width: 320, height: 640, tag: "320x640" }, { width: 844, height: 390, tag: "landscape" }]) {
      const b = await mk(browser, "bot-" + vp.tag, BASE + "/?" + FX, vp);
      const play = await startBot(b.page);
      if (!play) { log("bot match starts " + vp.tag, false, "no play state"); await b.ctx.close(); continue; }
      await sleep(600);
      const shot = await debug(b.page);
      const L = shot.layout;
      report.layout[vp.tag] = L;
      log("bot match starts with four players " + vp.tag, play.players === 4, JSON.stringify({ players: play.players }));
      log("score chips do not collide with the buttons " + vp.tag, !!(L && L.hudClear), JSON.stringify(L));
      log("local player stays above the touch pads " + vp.tag, !!(L && L.playerVisible), JSON.stringify(L));
      if (vp.tag === "390x844") {
        await tapPad(b.page, 0, -30);
        await sleep(500);
        let scored = null;
        for (let i = 0; i < 40 && !scored; i++) {
          const d = await debug(b.page);
          if (d && d.score && (d.score.points[0] + d.score.points[1] > 0 || d.score.games[0] + d.score.games[1] > 0)) scored = d;
          if (d && d.layout && !d.layout.playerVisible) log("player visible during rally", false, JSON.stringify(d.layout));
          await stickMove(b.page, { x: i % 2 ? 1 : -1, y: -0.3 }, 70);
          await tapPad(b.page, 0, -14);
          await sleep(110);
        }
        log("a point is scored in bot mode", !!scored, scored ? JSON.stringify(scored.score) : "timed out");
        const ball = scored && scored.ball;
        log("ball stays inside the court", !!ball && Math.abs(ball.x) <= 5.6 && ball.y >= -0.5 && ball.y <= 20.5, JSON.stringify(ball));
      }
      await b.ctx.close();
    }
    // 8. Wall drill: real pointer input must earn a controlled return.
    {
      const w = await mk(browser, "wall", BASE + "/?" + FX);
      await sleep(1500);
      const setupDrill = async () => {
        await clickText(w.page, "Wall Practice");
        await sleep(700);
        await clickText(w.page, "Wall drill");
        await sleep(900);
        return waitFor(async () => { const d = await debug(w.page); return d && d.drill ? d : null; }, 12000);
      };
      let d0 = await setupDrill();
      if (!d0) {
        await guard("drill retry goto", () => w.page.goto(BASE + "/?" + FX, { waitUntil: "load" }), 25000);
        await sleep(1800);
        d0 = await setupDrill();
      }
      log("wall drill mode runs", !!d0 && d0.mode === "wall", JSON.stringify({ mode: d0 && d0.mode }));
      log("wall drill player visible above the pads", !!(d0 && d0.layout && d0.layout.playerVisible), JSON.stringify(d0 && d0.layout));
      const earned = await earnDrillReturn(w.page);
      report.drill = earned;
      log("wall drill earns a controlled return from pointer input", earned.streak >= 1, JSON.stringify(earned));
      await w.ctx.close();
    }
    // 9. Two clients: explicit welcome on both, distinct seats, correct teams, server point.
    {
      const a = await mk(browser, "roomA", BASE + "/?" + FX);
      await sleep(1000);
      await clickText(a.page, "Play with Friends");
      const wa = await waitFor(async () => { const d = await debug(a.page); return d && d.code ? d : null; }, 20000);
      const code = wa && wa.code ? wa.code : "";
      report.rooms.two = code;
      log("room code issued", /^[A-Z0-9]{5}$/.test(code), code);
      const b = await mk(browser, "roomB", BASE + "/?" + FX + "&room=" + code);
      const wb = await waitFor(async () => { const d = await debug(b.page); return d && d.code === code ? d : null; }, 25000);
      log("guest welcomed explicitly", !!wb, JSON.stringify(wb && { seat: wb.seat, code: wb.code }));
      log("guest has a distinct seat", !!wb && wb.seat !== wa.seat, "a=" + (wa && wa.seat) + " b=" + (wb && wb.seat));
      const lobbyTeams = await guard("lobby", () => a.page.evaluate(() => [...document.querySelectorAll(".lobby-panel .pillrow .tag")].map((n) => n.textContent || "")), 10000) || [];
      const coral = lobbyTeams.filter((t) => /Coral/.test(t)).length;
      const ice = lobbyTeams.filter((t) => /Ice/.test(t)).length;
      report.seats.lobbyTwo = lobbyTeams;
      log("lobby shows two per team", coral === 2 && ice === 2, JSON.stringify(lobbyTeams));
      await clickText(a.page, "Start match");
      const playing = await waitFor(async () => { const d = await debug(a.page); return d && d.mode === "online" && d.players === 4 ? d : null; }, 30000);
      log("two-client match starts", !!playing, JSON.stringify(playing && { players: playing.players, connected: playing.connected }));
      const teams = (playing && playing.teams) || [];
      const teamOk = teamPairOk(teams);
      report.seats.match = teams;
      log("snapshot teams follow the pair split", teamOk, JSON.stringify(teams));
      await tapPad(a.page, 0, -30);
      const scored = await waitFor(async () => { const d = await debug(a.page); return d && d.score && (d.score.points[0] + d.score.points[1] > 0) ? d : null; }, 45000, 700);
      log("online point decided by the server", !!scored, scored ? JSON.stringify(scored.score) : "timed out");
      await a.ctx.close(); await b.ctx.close();
    }
    // 10. Four clients: explicit welcome on each, four seats, teams, and a refused fifth.
    {
      const host = await mk(browser, "host4", BASE + "/?" + FX);
      await sleep(1000);
      await clickText(host.page, "Play with Friends");
      const wh = await waitFor(async () => { const d = await debug(host.page); return d && d.code ? d : null; }, 20000);
      const code = wh && wh.code ? wh.code : "";
      report.rooms.four = code;
      const clients = [host];
      for (let i = 0; i < 3; i++) clients.push(await mk(browser, "guest4-" + i, BASE + "/?" + FX + "&room=" + code));
      const welcomed = [];
      for (const c of clients) {
        welcomed.push(await waitFor(async () => { const d = await debug(c.page); return d && d.code === code ? d : null; }, 25000));
      }
      const seats = welcomed.map((w) => (w ? w.seat : -1));
      report.seats.browserFour = seats;
      log("every client was welcomed", welcomed.every((w) => !!w && w.code === code), JSON.stringify(seats));
      log("four clients hold four distinct seats", new Set(seats).size === 4 && seats.every((s) => s >= 0), JSON.stringify(seats));
      const welcomeTeams = welcomed.map((w) => (w && w.teams) || []);
      const allTeamOk = welcomeTeams.length === 4 && welcomeTeams.every((t) => teamPairOk(t));
      log("every client's roster shows the correct pair teams", allTeamOk, JSON.stringify(welcomeTeams[0] || []));
      const tags = await guard("lobby4", () => host.page.evaluate(() => [...document.querySelectorAll(".lobby-panel .pillrow .tag")].map((n) => n.textContent || "")), 10000) || [];
      const coral = tags.filter((t) => /Coral/.test(t)).length;
      const ice = tags.filter((t) => /Ice/.test(t)).length;
      report.seats.lobbyFour = tags;
      log("four-player lobby is two Coral and two Ice", coral === 2 && ice === 2, JSON.stringify(tags));
      const fifth = await mk(browser, "fifth", BASE + "/?" + FX + "&room=" + code);
      // A refused client must boot but never receive a room code.
      const d5 = await waitFor(async () => { const d = await debug(fifth.page); return d || null; }, 30000, 700);
      report.seats.fifth = d5 ? { code: d5.code, seat: d5.seat } : null;
      log("fifth client is refused in the browser", !!d5 && d5.code === "", JSON.stringify(report.seats.fifth));
      const tagsAfter = await guard("lobby4 after", () => host.page.evaluate(() => [...document.querySelectorAll(".lobby-panel .pillrow .tag")].map((n) => n.textContent || "")), 10000) || [];
      const humans4 = tagsAfter.length === 4 && !tagsAfter.some((t) => /offline/.test(t));
      log("host still holds four humans after the refusal", humans4, JSON.stringify(tagsAfter));
      await fifth.ctx.close();
      await clickText(host.page, "Start match");
      const playing4 = await waitFor(async () => { const d = await debug(host.page); return d && d.players === 4 && d.connected === 4 ? d : null; }, 30000);
      log("four-human match runs with four connected seats", !!playing4, JSON.stringify(playing4 && { connected: playing4.connected, players: playing4.players }));
      log("four-client snapshot teams follow the pair split", teamPairOk((playing4 && playing4.teams) || []), JSON.stringify(playing4 && playing4.teams));
      for (const c of clients) await c.ctx.close();
    }
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }
  await writeFile(join(ART, "gates-report.json"), JSON.stringify(report, null, 2));
  const total = report.steps.length;
  const passed = report.steps.filter((s) => s.ok).length;
  console.log("SUMMARY " + JSON.stringify({ ok: errors.length === 0, passed, total, errors, consoleErrors: report.consoleErrors, pageErrors: report.pageErrors }));
  if (errors.length) process.exitCode = 1;
}
function teamPairOk(teams) {
  if (!teams || teams.length !== 4) return false;
  return teams.every((t) => (t.seat < 2 ? t.team === 0 : t.team === 1));
}
async function page0(page) {
  // Wait for a laid-out document: an early evaluate can report innerWidth 0.
  await waitFor(async () => { const ok = await guard("layout ready", () => page.evaluate(() => window.innerWidth > 0 && document.body.scrollHeight > 0), 8000); return ok ? true : null; }, 20000, 400);
  const brand = await guard("brand", () => page.locator("h1").first().innerText(), 9000) || "";
  const geo = await guard("geo", () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, sh: document.documentElement.scrollHeight, ih: window.innerHeight })), 9000) || { sw: 1, iw: 0, sh: 1, ih: 0 };
  return { brand: /PADEL/.test(brand), bad: geo.sw > geo.iw + 1 || geo.sh > geo.ih + 1, geo };
}
main().catch(async (e) => { console.log("FATAL " + String((e && e.stack) || e).slice(0, 500)); await writeFile(join(ART, "gates-report.json"), JSON.stringify({ ...report, fatal: String(e) }, null, 2)); process.exit(2); });
