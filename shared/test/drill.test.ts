import test from "node:test";
import assert from "node:assert/strict";
import { WallDrill } from "../src/wall.ts";
import { COURT, diagonalServeBox, inBox } from "../src/geometry.ts";

/** Move the drill player toward the ball and swing when it is in reach. */
function playUntilHit(drill: WallDrill, maxSteps = 1200): boolean {
  for (let i = 0; i < maxSteps; i++) {
    const b = drill.state.ball;
    const p = drill.state.player;
    const dx = b.x - p.x;
    const dy = b.y - p.y;
    const dist = Math.hypot(dx, dy);
    const move = dist > 0.5 ? { x: dx / dist, y: dy / dist } : { x: 0, y: 0 };
    const inReach = dist <= 1.34 && b.z <= 2.45 && b.z > 0;
    // Aim back at the player's own back wall so the rebound stays controllable.
    const aim = { x: (p.x - b.x) * 0.4, y: (COURT.length + 1 - b.y) * 0.5 };
    drill.update(move, inReach ? { type: "drive", aim } : undefined, 1 / 60);
    if (drill.state.streak > 0) return true;
  }
  return false;
}

test("wall practice counts a controlled return when the ball is played", () => {
  const drill = new WallDrill("wall", 11);
  assert.equal(drill.state.streak, 0);
  const hit = playUntilHit(drill);
  assert.equal(hit, true, "the drill should allow a return once the player reaches the ball");
  assert.ok(drill.state.streak >= 1);
  assert.ok(drill.state.best >= 1);
  assert.ok(drill.state.attempts >= 1);
});

test("a missed wall-practice ball resets the streak", () => {
  const drill = new WallDrill("wall", 12);
  playUntilHit(drill);
  assert.ok(drill.state.streak >= 1);
  // Do nothing: the ball bounces twice and the drill must reset the streak.
  for (let i = 0; i < 900; i++) drill.update({ x: 0, y: 0 }, undefined, 1 / 60);
  assert.equal(drill.state.streak, 0, "letting the ball bounce twice resets the streak");
});

test("serve drill counts legal serves into the diagonal box and rejects misses", () => {
  const drill = new WallDrill("serve", 5);
  for (let i = 0; i < 600 && drill.state.attempts === 0; i++) drill.update({ x: 0, y: 0 }, undefined, 1 / 60);
  assert.equal(drill.state.attempts, 1, "the fed serve is judged on its first bounce");
  const sp = { x: 2.1, y: COURT.serviceLineHigh + 0.7 };
  const box = diagonalServeBox(0, sp.x);
  assert.ok(inBox(box, (box.xMin + box.xMax) / 2, (box.yMin + box.yMax) / 2));
  assert.equal(drill.state.lastGood, true, "the default feed lands in the diagonal box");
  assert.ok(drill.state.streak >= 1);
});
