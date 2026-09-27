import type { MatchConfig, Score, SimEvent } from "./types.ts";
import type { Team } from "./geometry.ts";
import { COURT, netHeightAt } from "./geometry.ts";
import { clamp } from "./math.ts";

export const emptyScore = (): Score => ({
  points: [0, 0],
  games: [0, 0],
  sets: [0, 0],
  tiebreak: null,
});

export const POINT_LABELS = ["0", "15", "30", "40", "AD"] as const;

/** Human label for one side's point count, given the other side (for 40/AD/deuce). */
export function pointLabel(points: number, other: number): string {
  if (points >= 4 && other >= 4) return "40";
  if (points >= 4) return "AD";
  return POINT_LABELS[Math.min(points, 3)];
}

/** Compact score text such as "40-30" or "AD-40". */
export function scoreText(score: Score): string {
  const [a, b] = score.points;
  if (score.tiebreak) return `${score.tiebreak.points[0]}-${score.tiebreak.points[1]}`;
  if (a >= 3 && b >= 3) {
    if (a === b) return "40-40";
    return a > b ? "AD-40" : "40-AD";
  }
  return `${pointLabel(a, b)}-${pointLabel(b, a)}`;
}

export type PointOutcome = {
  score: Score;
  events: SimEvent[];
  setWon: boolean;
  matchWon: boolean;
};

/**
 * Award a point to `team` and resolve game / set / match. Implements tennis
 * scoring (0-15-30-40, deuce and advantage) plus a 7-point tie-break with a
 * two-point margin at the configured tie-break game count.
 */
export function awardPoint(previous: Score, team: Team, config: MatchConfig): PointOutcome {
  const score: Score = {
    points: [previous.points[0], previous.points[1]],
    games: [previous.games[0], previous.games[1]],
    sets: [previous.sets[0], previous.sets[1]],
    tiebreak: previous.tiebreak ? { active: previous.tiebreak.active, points: [previous.tiebreak.points[0], previous.tiebreak.points[1]], target: previous.tiebreak.target } : null,
  };
  const other: Team = team === 0 ? 1 : 0;
  const events: SimEvent[] = [];

  if (score.tiebreak) {
    score.tiebreak.points[team]++;
    const [a, b] = score.tiebreak.points;
    if (a >= score.tiebreak.target || b >= score.tiebreak.target) {
      const hi = Math.max(a, b);
      const lo = Math.min(a, b);
      if (hi - lo >= 2) {
        const w: Team = a > b ? 0 : 1;
        score.games[w]++;
        score.tiebreak = null;
        score.points = [0, 0];
        events.push({ type: "game", team: w, games: [score.games[0], score.games[1]] });
        // The tie-break decides the set: 7-6 (or 8-6, ...) always takes it.
        score.sets[w]++;
        events.push({ type: "set", team: w });
        const matchWon = score.sets[w] >= config.setsToWin;
        if (matchWon) events.push({ type: "match", team: w });
        return { score, events, setWon: true, matchWon };
      }
    }
    return { score, events, setWon: false, matchWon: false };
  }

  score.points[team]++;
  const p = score.points;
  if (p[team] >= 4 && p[other] >= 4) {
    p[0] = 3;
    p[1] = 3;
    return { score, events, setWon: false, matchWon: false };
  }
  if (p[team] >= 4 && p[team] - p[other] >= 2) {
    // game won
    score.games[team]++;
    score.points = [0, 0];
    const g = score.games;
    const setWon = g[team] >= config.gamesToWinSet && g[team] - g[other] >= 2;
    if (setWon) {
      score.sets[team]++;
      events.push({ type: "set", team });
      const matchWon = score.sets[team] >= config.setsToWin;
      if (matchWon) events.push({ type: "match", team });
      return { score, events, setWon, matchWon };
    }
    if (g[0] === config.tiebreakAt && g[1] === config.tiebreakAt) {
      score.tiebreak = { active: true, points: [0, 0], target: 7 };
      events.push({ type: "game", team, games: [g[0], g[1]] });
      return { score, events, setWon: false, matchWon: false };
    }
    events.push({ type: "game", team, games: [g[0], g[1]] });
    return { score, events, setWon: false, matchWon: false };
  }
  return { score, events, setWon: false, matchWon: false };
}

/**
 * Doubles serving rotation. The serving team alternates every game; within a
 * team the two players alternate each time that team serves. Returns the global
 * player index of the next server.
 */
export function nextServer(gamesPlayed: number, servesByTeam: [number, number]): { team: Team; server: number } {
  const team: Team = (gamesPlayed % 2) as Team;
  const within = servesByTeam[team] % 2;
  return { team, server: team * 2 + within };
}

export function registerServe(servesByTeam: [number, number], team: Team): void {
  servesByTeam[team]++;
}

/**
 * The receiver is the player of the receiving team standing on the side the
 * serve is directed to (diagonally opposite the server).
 */
export function receiverFor(players: Array<{ team: Team; side: 0 | 1; index: number }>, receivingTeam: Team, serverX: number): number {
  const wantSide: 0 | 1 = serverX >= 0 ? 0 : 1;
  const onSide = players.find((p) => p.team === receivingTeam && p.side === wantSide);
  if (onSide) return onSide.index;
  const any = players.find((p) => p.team === receivingTeam);
  return any ? any.index : (receivingTeam === 0 ? 0 : 2);
}

/**
 * Solve an underarm serve launched from (x0,y0,z0) that must clear the net at
 * `netH` (plus margin) and land exactly on (tx,ty). The flight time is raised
 * until the net-clearance constraint holds, which is what makes the low strike
 * legal: launching below the waist, the arc must still pass over the net.
 */
export function solveServeVelocity(x0: number, y0: number, z0: number, tx: number, ty: number, netH: number): { vx: number; vy: number; vz: number; T: number } {
  const r = COURT.ballRadius;
  const dy = ty - y0;
  let T = 0.95;
  if (Math.abs(dy) > 1e-3) {
    const a = clamp((COURT.netY - y0) / dy, 0.05, 0.95);
    const need = netH + 0.15 - z0 - a * (r - z0);
    const denom = 4.905 * (a - a * a);
    const tMin = denom > 0 ? Math.sqrt(Math.max(0.04, need / denom)) : 0.9;
    const dist = Math.hypot(tx - x0, ty - y0);
    T = clamp(Math.max(tMin * 1.05, dist / 18), 0.7, 1.3);
  }
  return { vx: (tx - x0) / T, vy: dy / T, vz: (r - z0 - 0.5 * COURT.gravity * T * T) / T, T };
}

/** Default "behind the service line" serve spot for a player. */
export function serveSpot(team: Team, side: 0 | 1): { x: number; y: number } {
  const x = side === 1 ? 2.1 : -2.1;
  const y = team === 0 ? COURT.serviceLineLow - 0.7 : COURT.serviceLineHigh + 0.7;
  return { x, y };
}

/** Home/ready position for a player of a team on a given side. */
export function homeSpot(team: Team, side: 0 | 1): { x: number; y: number } {
  const x = side === 1 ? 2.5 : -2.5;
  const y = team === 0 ? 4.0 : COURT.length - 4.0;
  return { x, y };
}
