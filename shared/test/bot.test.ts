import test from "node:test";
import assert from "node:assert/strict";
import { Sim } from "../src/sim.ts";
import { BOT_PROFILES } from "../src/bot.ts";
import { COURT } from "../src/geometry.ts";

test("difficulty profiles are distinct and finite", () => {
  assert.ok(BOT_PROFILES.rookie.speed < BOT_PROFILES.pro.speed);
  assert.ok(BOT_PROFILES.rookie.reaction > BOT_PROFILES.pro.reaction);
  assert.ok(BOT_PROFILES.rookie.aimError > BOT_PROFILES.pro.aimError);
  for (const p of Object.values(BOT_PROFILES)) {
    assert.ok(p.speed > 0 && p.speed < 10);
    assert.ok(p.reaction > 0);
  }
});

test("bots never leave their own half and never teleport", () => {
  const sim = new Sim({ bots: [true, true, true, true], seed: 21, difficulty: ["rookie", "pro"] });
  const prev = sim.state.players.map((p) => ({ ...p.pos }));
  const dt = 1 / 60;
  let prevValid = false;
  for (let i = 0; i < 900; i++) {
    sim.step();
    const evs = sim.drainEvents();
    // Players are legitimately re-positioned between points; only continuous
    // rally movement is checked for teleporting.
    const rallyOk = sim.state.phase === "rally" && !evs.some((e) => e.type === "serve");
    for (const p of sim.state.players) {
      if (rallyOk && prevValid) {
        const ddx = p.pos.x - prev[p.index].x;
        const ddy = p.pos.y - prev[p.index].y;
        assert.ok(Math.hypot(ddx, ddy) <= Math.max(BOT_PROFILES.rookie.speed, BOT_PROFILES.pro.speed) * dt + 0.02, `bot ${p.index} teleported inside a rally`);
      }
      if (p.team === 0) assert.ok(p.pos.y <= COURT.netY + 0.01, "team 0 stays in its half");
      else assert.ok(p.pos.y >= COURT.netY - 0.01, "team 1 stays in its half");
      prev[p.index] = { ...p.pos };
    }
    prevValid = rallyOk;
  }
});

test("a bot serves and a four-bot rally produces hits", () => {
  const sim = new Sim({ bots: [true, true, true, true], seed: 99, difficulty: ["pro", "pro"] });
  let serves = 0;
  let hits = 0;
  for (let i = 0; i < 2400; i++) {
    sim.step();
    for (const e of sim.drainEvents()) {
      if (e.type === "serve") serves++;
      if (e.type === "hit") hits++;
    }
  }
  assert.ok(serves >= 1, "a bot serves");
  assert.ok(hits >= 3, "bots rally and strike the ball");
});
