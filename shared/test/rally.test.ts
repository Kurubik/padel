import test from "node:test";
import assert from "node:assert/strict";
import { Sim } from "../src/sim.ts";
import type { SimEvent } from "../src/types.ts";

const noBots = () => new Sim({ bots: [false, false, false, false], seed: 11 });

function rallyState(sim: Sim) {
  sim.state.phase = "rally";
  sim.serveActive = false;
  sim.serveLanded = false;
  sim.state.lastHitTeam = 0;
  sim.state.lastHitPlayer = 0;
  sim.state.bounce = { count: 0, side: null, x: 0, y: 0, wallTouched: false, wallBeforeFloor: false, fenceTouched: false, netTouched: false, struckSide: null };
}

function run(sim: Sim, steps: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < steps; i++) {
    sim.step();
    out.push(...sim.drainEvents());
  }
  return out;
}

test("a ball that hits the opponent wall before bouncing is a wall-before-bounce fault", () => {
  const sim = noBots();
  rallyState(sim);
  sim.state.ball = { pos: { x: 0, y: 15, z: 1.0 }, vel: { x: 0, y: 12, z: 2 }, live: true };
  const events = run(sim, 200);
  assert.ok(events.some((e) => e.type === "glass"), "back glass was struck");
  const point = events.find((e) => e.type === "point");
  assert.ok(point && point.type === "point");
  if (point && point.type === "point") {
    assert.equal(point.reason, "wall_before_bounce");
    assert.equal(point.team, 1, "the opponent wins the point");
  }
});

test("a legal return may bounce first and then use the wall", () => {
  const sim = noBots();
  rallyState(sim);
  sim.state.ball = { pos: { x: 0, y: 17, z: 0.5 }, vel: { x: 0, y: 8, z: -1 }, live: true };
  const events = run(sim, 240);
  assert.ok(events.some((e) => e.type === "floor" && e.side === 1), "ball bounced in the opponent court first");
  assert.ok(events.some((e) => e.type === "glass"), "wall rebound happened after the bounce");
  assert.equal(events.some((e) => e.type === "point" && e.reason === "wall_before_bounce"), false);
  const point = events.find((e) => e.type === "point");
  assert.ok(point && point.type === "point");
  if (point && point.type === "point") assert.equal(point.reason, "double_bounce");
});

test("the second floor bounce ends the point for the team on that side", () => {
  const sim = noBots();
  rallyState(sim);
  sim.state.ball = { pos: { x: 0, y: 18, z: 0.4 }, vel: { x: 0, y: 0, z: -1 }, live: true };
  const point = run(sim, 200).find((e) => e.type === "point");
  assert.ok(point && point.type === "point");
  if (point && point.type === "point") {
    assert.equal(point.reason, "double_bounce");
    assert.equal(point.team, 0, "the striker wins when the receiver lets it bounce twice");
  }
});

test("a ball returning to the striker's own court is an own-court fault", () => {
  const sim = noBots();
  rallyState(sim);
  sim.state.ball = { pos: { x: 0, y: 5, z: 0.5 }, vel: { x: 0, y: -3, z: -2 }, live: true };
  const point = run(sim, 200).find((e) => e.type === "point");
  assert.ok(point && point.type === "point");
  if (point && point.type === "point") {
    assert.equal(point.reason, "own_court");
    assert.equal(point.team, 1);
  }
});

test("a volley before the bounce is legal and does not award a point", () => {
  const sim = noBots();
  rallyState(sim);
  sim.state.ball = { pos: { x: 2.0, y: 12.0, z: 0.6 }, vel: { x: 0, y: 5, z: 0 }, live: true };
  sim.state.players[3].pos = { x: 2.0, y: 12.15 };
  sim.setInput(3, { seq: 5, move: { x: 0, y: 0 }, hit: { type: "volley", aim: { x: 0, y: -1 } } });
  sim.step();
  const events = sim.drainEvents();
  assert.ok(events.some((e) => e.type === "hit" && e.player === 3), "the volley connects");
  assert.equal(events.some((e) => e.type === "point"), false, "a clean volley is not a fault");
  assert.equal(sim.state.lastHitTeam, 1);
});

test("a ball that leaves the court over the fence is an out-of-court fault", () => {
  const sim = noBots();
  rallyState(sim);
  sim.state.ball = { pos: { x: 0, y: 19.99, z: 4.2 }, vel: { x: 0, y: 5, z: 0 }, live: true };
  const point = run(sim, 200).find((e) => e.type === "point");
  assert.ok(point && point.type === "point");
  if (point && point.type === "point") {
    assert.equal(point.reason, "out_of_court");
    assert.equal(point.team, 1);
  }
});
