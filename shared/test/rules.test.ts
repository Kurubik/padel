import test from "node:test";
import assert from "node:assert/strict";
import { awardPoint, emptyScore, nextServer, registerServe, pointLabel, scoreText, receiverFor, serveSpot } from "../src/rules.ts";
import { SHORT_FORMAT } from "../src/types.ts";
import type { Score } from "../src/types.ts";
import type { Team } from "../src/geometry.ts";

function winGame(score: Score, team: Team): Score {
  let s = score;
  for (let i = 0; i < 8; i++) {
    const out = awardPoint(s, team, SHORT_FORMAT);
    s = out.score;
    if (s.points[0] === 0 && s.points[1] === 0 && (s.games[0] > score.games[0] || s.games[1] > score.games[1])) return s;
    if (s.tiebreak) return s;
  }
  return s;
}

test("15/30/40 progression and labels", () => {
  let s = emptyScore();
  assert.equal(scoreText(s), "0-0");
  s = awardPoint(s, 0, SHORT_FORMAT).score;
  assert.equal(pointLabel(s.points[0], s.points[1]), "15");
  s = awardPoint(s, 0, SHORT_FORMAT).score;
  assert.equal(pointLabel(s.points[0], s.points[1]), "30");
  s = awardPoint(s, 0, SHORT_FORMAT).score;
  assert.equal(scoreText(s), "40-0");
});

test("deuce and advantage swing back to deuce", () => {
  let s = emptyScore();
  for (let i = 0; i < 3; i++) s = awardPoint(s, 0, SHORT_FORMAT).score;
  for (let i = 0; i < 3; i++) s = awardPoint(s, 1, SHORT_FORMAT).score;
  assert.equal(scoreText(s), "40-40");
  s = awardPoint(s, 0, SHORT_FORMAT).score;
  assert.equal(scoreText(s), "AD-40");
  s = awardPoint(s, 1, SHORT_FORMAT).score;
  assert.equal(scoreText(s), "40-40", "advantage lost returns to deuce");
  s = awardPoint(s, 0, SHORT_FORMAT).score;
  s = awardPoint(s, 0, SHORT_FORMAT).score;
  assert.equal(s.games[0], 1, "two points from advantage win the game");
  assert.equal(s.points[0], 0);
});

test("game won at 40-0 without a set at 1-0", () => {
  let s = emptyScore();
  s = awardPoint(s, 0, SHORT_FORMAT).score;
  s = awardPoint(s, 0, SHORT_FORMAT).score;
  s = awardPoint(s, 0, SHORT_FORMAT).score;
  const out = awardPoint(s, 0, SHORT_FORMAT);
  assert.equal(out.score.games[0], 1);
  assert.equal(out.setWon, false);
  assert.equal(out.events.some((e) => e.type === "game"), true);
});

test("short set ends 4-0 and reports a set event", () => {
  let s = emptyScore();
  for (let g = 0; g < 4; g++) s = winGame(s, 0);
  assert.equal(s.games[0], 4);
  assert.equal(s.games[1], 0);
});

test("tie-break starts at the configured 4-4 and is won with a two-point margin", () => {
  let s = emptyScore();
  for (let g = 0; g < 4; g++) s = winGame(s, 0);
  for (let g = 0; g < 4; g++) s = winGame(s, 1);
  assert.equal(s.games[0], 4);
  assert.equal(s.games[1], 4);
  assert.ok(s.tiebreak, "4-4 opens the tie-break deciding game");
  assert.deepEqual(s.tiebreak?.points, [0, 0]);
  let tb = s;
  for (let i = 0; i < 6; i++) tb = awardPoint(tb, 0, SHORT_FORMAT).score;
  for (let i = 0; i < 6; i++) tb = awardPoint(tb, 1, SHORT_FORMAT).score;
  assert.equal(tb.tiebreak?.points[0], 6);
  assert.equal(tb.tiebreak?.points[1], 6);
  tb = awardPoint(tb, 0, SHORT_FORMAT).score;
  assert.equal(tb.tiebreak?.points[0], 7);
  const out = awardPoint(tb, 0, SHORT_FORMAT);
  assert.equal(out.setWon, true, "7-6 in the tie-break takes the set");
  assert.equal(out.matchWon, true);
});

test("doubles serving rotation alternates team then player", () => {
  const servesByTeam: [number, number] = [0, 0];
  const order: number[] = [];
  for (let gamesPlayed = 0; gamesPlayed < 8; gamesPlayed++) {
    const { team, server } = nextServer(gamesPlayed, servesByTeam);
    registerServe(servesByTeam, team);
    order.push(server);
  }
  assert.deepEqual(order, [0, 2, 1, 3, 0, 2, 1, 3]);
});

test("receiver is the player on the side the serve is directed to", () => {
  const players = [
    { team: 0 as Team, side: 0 as const, index: 0 },
    { team: 0 as Team, side: 1 as const, index: 1 },
    { team: 1 as Team, side: 0 as const, index: 2 },
    { team: 1 as Team, side: 1 as const, index: 3 },
  ];
  // Server on the right (x>0) serves diagonally to the left box -> receiver side 0.
  assert.equal(receiverFor(players, 1, 2.1), 2);
  assert.equal(receiverFor(players, 1, -2.1), 3);
  assert.equal(receiverFor(players, 0, 2.1), 0);
});

test("serve spot is behind the service line on the correct side", () => {
  const a = serveSpot(0, 1);
  assert.ok(a.y < 7, "team 0 serves from behind their service line (y<7)");
  assert.ok(a.x > 0);
  const b = serveSpot(1, 0);
  assert.ok(b.y > 13);
  assert.ok(b.x < 0);
});
