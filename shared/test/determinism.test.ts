import test from "node:test";
import assert from "node:assert/strict";
import { Sim, predictLanding } from "../src/sim.ts";

test("the same seed and inputs produce an identical match", () => {
  const a = new Sim({ bots: [false, true, true, true], seed: 4242 });
  const b = new Sim({ bots: [false, true, true, true], seed: 4242 });
  a.setInput(0, { seq: 1, move: { x: 0, y: 0 }, serve: true, hit: { type: "drive", aim: { x: 0, y: 1 } } });
  b.setInput(0, { seq: 1, move: { x: 0, y: 0 }, serve: true, hit: { type: "drive", aim: { x: 0, y: 1 } } });
  for (let i = 0; i < 1200; i++) {
    a.step();
    b.step();
    a.drainEvents();
    b.drainEvents();
  }
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test("different seeds diverge (the simulation is not accidentally constant)", () => {
  const a = new Sim({ bots: [true, true, true, true], seed: 1 });
  const b = new Sim({ bots: [true, true, true, true], seed: 2 });
  for (let i = 0; i < 1200; i++) {
    a.step();
    b.step();
    a.drainEvents();
    b.drainEvents();
  }
  assert.notDeepEqual(a.snapshot().ball.pos, b.snapshot().ball.pos);
});

test("predictLanding returns a plausible point inside the court", () => {
  const sim = new Sim({ bots: [false, false, false, false], seed: 8 });
  sim.state.phase = "rally";
  sim.state.ball = { pos: { x: 1, y: 12, z: 1.5 }, vel: { x: 0.5, y: 6, z: 0.5 }, live: true };
  const landing = predictLanding(sim.state, 3);
  assert.ok(landing, "a landing point is predicted");
  if (landing) {
    assert.ok(Math.abs(landing.x) <= 5.2);
    assert.ok(landing.y >= -0.2 && landing.y <= 20.2);
    assert.ok(landing.time > 0 && landing.time < 3);
  }
});
