import test from "node:test";
import assert from "node:assert/strict";
import { Sim } from "../src/sim.ts";
import type { SimEvent } from "../src/types.ts";

const noBots = () => new Sim({ bots: [false, false, false, false], seed: 3 });

function serveAndCollect(sim: Sim, steps: number): SimEvent[] {
  sim.setInput(0, { seq: 1, move: { x: 0, y: 0 }, serve: true, hit: { type: "drive", aim: { x: 0, y: 1 } } });
  sim.step();
  const evs = sim.drainEvents();
  for (let i = 0; i < steps; i++) {
    sim.step();
    evs.push(...sim.drainEvents());
  }
  return evs;
}

test("a legal serve clears the net, lands in the diagonal box, and wins the point when not returned", () => {
  const sim = noBots();
  sim.setInput(0, { seq: 1, move: { x: 0, y: 0 }, serve: true, hit: { type: "drive", aim: { x: 0, y: 1 } } });
  sim.step();
  const first = sim.drainEvents();
  assert.ok(first.some((e) => e.type === "serve"), "serve event fired");
  assert.ok(!first.some((e) => e.type === "fault"), "legal serve is not a fault");
  assert.equal(sim.serveActive, true);
  let point: SimEvent | undefined;
  let netTouched = false;
  for (let i = 0; i < 400 && !point; i++) {
    sim.step();
    for (const e of sim.drainEvents()) {
      if (e.type === "point") point = e;
      if (e.type === "net") netTouched = true;
    }
  }
  assert.equal(netTouched, false, "serve passes over the net, no net contact");
  assert.equal(sim.serveLanded, true, "serve landed in the diagonal service box");
  assert.ok(point && point.type === "point");
  if (point && point.type === "point") {
    assert.equal(point.team, 0, "server takes the point when the receiver never returns");
    assert.equal(point.reason, "double_bounce");
  }
});

test("a serve that lands beyond the service line is a fault and offers a second serve", () => {
  const sim = noBots();
  sim.setInput(0, { seq: 1, move: { x: 0, y: 0 }, serve: true, hit: { type: "drive", aim: { x: 0, y: 1 } } });
  sim.step();
  sim.drainEvents();
  sim.setInput(0, { seq: 2, move: { x: 0, y: 0 } });
  // Player 0 serves from the left, so the diagonal box is the right one
  // (x>0, y in [10,13]). Force a landing past the service line.
  sim.state.ball.pos = { x: 2.5, y: 13.2, z: 0.5 };
  sim.state.ball.vel = { x: 0, y: 6, z: -2.5 };
  let fault: SimEvent | undefined;
  for (let i = 0; i < 100 && !fault; i++) {
    sim.step();
    for (const e of sim.drainEvents()) if (e.type === "fault") fault = e;
  }
  assert.ok(fault && fault.type === "fault" && fault.serve === true);
  if (fault && fault.type === "fault") assert.equal(fault.reason, "serve_out");
  assert.equal(sim.state.serveNumber, 2, "second serve is offered");
  assert.equal(sim.state.phase, "serve");
});

test("two serve faults lose the point as a double fault", () => {
  const sim = noBots();
  sim.setInput(0, { seq: 1, move: { x: 0, y: 0 }, serve: true, hit: { type: "drive", aim: { x: 0, y: 1 } } });
  sim.step();
  sim.drainEvents();
  sim.setInput(0, { seq: 2, move: { x: 0, y: 0 } });
  const faultOnce = () => {
    sim.state.ball.pos = { x: 2.5, y: 13.2, z: 0.5 };
    sim.state.ball.vel = { x: 0, y: 6, z: -2.5 };
    for (let i = 0; i < 100; i++) {
      sim.step();
      for (const e of sim.drainEvents()) if (e.type === "point") return e;
    }
    return undefined;
  };
  assert.equal(faultOnce(), undefined, "first fault is not a point");
  assert.equal(sim.state.serveNumber, 2, "a second serve is offered");
  sim.setInput(0, { seq: 3, move: { x: 0, y: 0 }, serve: true, hit: { type: "drive", aim: { x: 0, y: 1 } } });
  sim.step();
  sim.drainEvents();
  sim.setInput(0, { seq: 4, move: { x: 0, y: 0 } });
  const point = faultOnce();
  assert.ok(point && point.type === "point");
  if (point && point.type === "point") {
    assert.equal(point.team, 1, "receivers win the double fault");
    assert.equal(point.reason, "double_fault");
  }
});

test("a net cord that still lands in the box is a let and does not consume the serve", () => {
  const sim = noBots();
  sim.setInput(0, { seq: 1, move: { x: 0, y: 0 }, serve: true, hit: { type: "drive", aim: { x: 0, y: 1 } } });
  sim.step();
  sim.drainEvents();
  sim.setInput(0, { seq: 2, move: { x: 0, y: 0 } });
  sim.state.bounce.netTouched = true;
  sim.state.ball.pos = { x: 2.4, y: 11.4, z: 1.4 };
  sim.state.ball.vel = { x: 0, y: 0, z: -3.5 };
  let letEvent: SimEvent | undefined;
  for (let i = 0; i < 120 && !letEvent; i++) {
    sim.step();
    for (const e of sim.drainEvents()) if (e.type === "let") letEvent = e;
  }
  assert.ok(letEvent && letEvent.type === "let");
  assert.equal(sim.state.serveNumber, 1, "a let replays the same serve number");
  assert.equal(sim.state.phase, "serve");
});

test("a serve that touches the wire fence after bouncing is a fault", () => {
  const sim = noBots();
  sim.setInput(0, { seq: 1, move: { x: 0, y: 0 }, serve: true, hit: { type: "drive", aim: { x: 0, y: 1 } } });
  sim.step();
  sim.drainEvents();
  sim.setInput(0, { seq: 2, move: { x: 0, y: 0 } });
  sim.serveLanded = true;
  sim.state.bounce.count = 1;
  sim.state.bounce.side = 1;
  sim.state.ball.pos = { x: 4.9, y: 12, z: 3.4 };
  sim.state.ball.vel = { x: 5, y: 0, z: 0 };
  let fault: SimEvent | undefined;
  for (let i = 0; i < 60 && !fault; i++) {
    sim.step();
    for (const e of sim.drainEvents()) if (e.type === "fault") fault = e;
  }
  assert.ok(fault && fault.type === "fault");
  if (fault && fault.type === "fault") assert.equal(fault.reason, "serve_fence_fault");
});
