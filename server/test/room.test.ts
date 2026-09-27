import test from "node:test";
import assert from "node:assert/strict";
import { Room } from "../src/rooms.ts";
import type { ServerMessage } from "@padel/shared";

function makeRoom() {
  const sent: Array<{ seat: number; msg: ServerMessage }> = [];
  const broadcast: ServerMessage[] = [];
  const room = new Room("TEST1", "short", {
    now: () => Date.now(),
    broadcast: (m) => broadcast.push(m),
    sendTo: (seat, m) => sent.push({ seat, msg: m }),
  }, 1234);
  return { room, sent, broadcast };
}

test("two humans join, get distinct seats, and the match starts with bot fill", () => {
  const { room, broadcast } = makeRoom();
  const a = room.join("Ana");
  const b = room.join("Bo");
  assert.ok(a && b);
  assert.equal(a!.seat, 0);
  assert.equal(b!.seat, 2, "the second human takes the opposite team first");
  assert.equal(a!.host, true);
  assert.equal(room.start(), true);
  assert.equal(room.started, true);
  const humans = room.seats.filter((s) => s.connected);
  assert.equal(humans.length, 2);
  assert.equal(room.seats.filter((s) => s.bot).length, 2, "empty seats become bots");
  assert.ok(broadcast.some((m) => m.t === "started"));
});

test("four humans occupy all four seats; a fifth join is rejected", () => {
  const { room } = makeRoom();
  const seats = ["A", "B", "C", "D"].map((n) => room.join(n));
  assert.deepEqual(seats.map((s) => s?.seat), [0, 2, 1, 3]);
  assert.equal(room.join("E"), null, "room is full");
});

test("a reconnect token reclaims the same seat after a drop", () => {
  const { room, broadcast } = makeRoom();
  const a = room.join("Ana")!;
  room.start();
  room.disconnect(a.seat);
  assert.equal(room.seats.find((s) => s.seat === a.seat)!.connected, false);
  const again = room.join("Ana", a.token);
  assert.ok(again);
  assert.equal(again!.seat, a.seat, "same seat is reclaimed");
  assert.equal(again!.token, a.token);
  assert.equal(room.seats.find((s) => s.seat === a.seat)!.connected, true);
  assert.ok(broadcast.some((m) => m.t === "room"));
});

test("inputs are clamped and the server scores points authoritatively", () => {
  const { room, broadcast } = makeRoom();
  const a = room.join("Ana")!;
  room.join("Bo");
  room.start();
  // Host (seat 0) serves. Wild values must be clamped, not crash.
  room.handleInput(a.seat, { t: "input", seq: 1, move: { x: 55, y: -90 }, serve: true, hit: { type: "drive", aim: { x: 0, y: 1 } } });
  let snapshotSeen = false;
  let point: { team: number; reason: string } | null = null;
  for (let i = 0; i < 4000; i++) {
    room.tick(1 / 60);
    for (const m of broadcast) {
      if (m.t === "snapshot") snapshotSeen = true;
      if (m.t === "events") {
        for (const e of m.events) if (e.type === "point") point = { team: e.team, reason: e.reason };
      }
    }
    broadcast.length = 0;
    if (point) break;
  }
  assert.equal(snapshotSeen, true, "snapshots are broadcast");
  assert.ok(point, "a point is decided by the server");
  assert.equal(room.sim.state.pointWinner, point!.team, "the server score owns the point");
  assert.equal(point!.team, 0, "the serving team wins when the return is never played");
});

test("lobby teams match the simulation teams (seats 0/1 -> 0, seats 2/3 -> 1)", () => {
  const { room } = makeRoom();
  ["A", "B", "C", "D"].forEach((n) => room.join(n));
  const info = room.seatsInfo();
  assert.deepEqual(info.map((s) => s.seat), [0, 1, 2, 3]);
  assert.deepEqual(info.map((s) => s.team), [0, 0, 1, 1], "lobby teams must follow the pair split the Sim uses");
  for (const s of info) {
    const simPlayer = room.sim.state.players.find((p) => p.index === s.seat);
    assert.ok(simPlayer, "seat " + s.seat + " exists in the simulation");
    assert.equal(s.team, simPlayer!.team, "lobby team for seat " + s.seat + " must equal the simulation team");
  }
  // And the broadcast carries the same mapping.
  const broadcast = room.seatsInfo();
  assert.deepEqual(broadcast.filter((s) => s.seat < 2).map((s) => s.team), [0, 0]);
  assert.deepEqual(broadcast.filter((s) => s.seat >= 2).map((s) => s.team), [1, 1]);
});

test("idle and empty rooms are reclaimable", () => {
  const { room } = makeRoom();
  assert.equal(room.isEmpty(), true);
  room.join("Ana");
  assert.equal(room.isEmpty(), false);
});
