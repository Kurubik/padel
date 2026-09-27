import type { Difficulty, MatchState, PlayerInput, ShotType } from "./types.ts";
import type { Rng } from "./rng.ts";
import { clamp, dist2, len2, norm2 } from "./math.ts";
import { COURT, clampPlayer, teamOfY } from "./geometry.ts";
import type { Vec2 } from "./math.ts";

export type LandingPrediction = { x: number; y: number; time: number } | null;
export type Predict = (maxSeconds: number) => LandingPrediction;

export type BotMemory = {
  decisionAt: number;
  target: Vec2;
  hitCooldown: number;
  serveAt: number;
};

export const newBotMemory = (): BotMemory => ({ decisionAt: -1, target: { x: 0, y: 0 }, hitCooldown: 0, serveAt: -1 });

type Profile = {
  speed: number;
  reaction: number;
  aimError: number;
  positionError: number;
  smashProb: number;
  lobProb: number;
  volleyProb: number;
  missChance: number;
};

/**
 * Two recognisable difficulty levels. Both move with the same physics and are
 * clamped to a finite speed, so neither can teleport or react instantly: only
 * reaction latency, speed, aim error and shot choice differ.
 */
export const BOT_PROFILES: Record<Difficulty, Profile> = {
  rookie: {
    speed: 3.5,
    reaction: 0.36,
    aimError: 0.22,
    positionError: 0.85,
    smashProb: 0.12,
    lobProb: 0.22,
    volleyProb: 0.25,
    missChance: 0.14,
  },
  pro: {
    speed: 4.7,
    reaction: 0.12,
    aimError: 0.055,
    positionError: 0.18,
    smashProb: 0.55,
    lobProb: 0.3,
    volleyProb: 0.6,
    missChance: 0.012,
  },
};

export const HUMAN_SPEED = 4.3;

/** Reads as: which teammate should take the incoming ball, and where. */
function designateHitter(state: MatchState, landing: LandingPrediction, team: number): number {
  const mates = state.players.filter((p) => p.team === team);
  if (!landing) return mates[0].index;
  let best = mates[0].index;
  let bestD = Infinity;
  for (const m of mates) {
    const d = Math.hypot(m.pos.x - landing.x, m.pos.y - landing.y);
    if (d < bestD) {
      bestD = d;
      best = m.index;
    }
  }
  return best;
}

function chooseShot(state: MatchState, index: number, profile: Profile, rng: Rng): ShotType {
  const p = state.players[index];
  const ball = state.ball;
  const distNet = Math.abs(ball.pos.y - COURT.netY);
  const bounced = state.bounce.count > 0;
  if (ball.pos.z > 1.45 && rng.chance(profile.smashProb)) return "smash";
  if (!bounced && distNet < 2.4 && rng.chance(profile.volleyProb)) return "volley";
  if (bounced && ball.pos.z > 0.9 && rng.chance(profile.lobProb)) return "lob";
  if (bounced && ball.pos.y < 4.5 && p.team === 1) return "lob";
  if (bounced && ball.pos.y > 15.5 && p.team === 0) return "lob";
  return "drive";
}

/** Aim at the space furthest from the opposing pair, clamped inside the court. */
function chooseAim(state: MatchState, index: number, profile: Profile, rng: Rng): Vec2 {
  const p = state.players[index];
  const opponents = state.players.filter((q) => q.team !== p.team);
  const targetY = p.team === 0 ? COURT.length - 3.2 : 3.2;
  let bestX = 0;
  let bestScore = -Infinity;
  for (const x of [-3.4, -1.6, 1.6, 3.4]) {
    let s = Infinity;
    for (const o of opponents) s = Math.min(s, Math.hypot(o.pos.x - x, o.pos.y - targetY));
    if (s > bestScore) {
      bestScore = s;
      bestX = x;
    }
  }
  const a = Math.atan2(targetY - p.pos.y, bestX - p.pos.x) + rng.range(-profile.aimError, profile.aimError);
  return { x: Math.cos(a), y: Math.sin(a) };
}

/**
 * Pure bot policy: given the authoritative state it returns the input for one
 * seat. Deterministic under a seeded rng so the same match replays identically.
 */
export function computeBotInput(
  state: MatchState,
  index: number,
  predict: Predict,
  memory: BotMemory,
  rng: Rng,
): PlayerInput {
  const p = state.players[index];
  const profile = BOT_PROFILES[p.difficulty];
  const seq = state.tick;
  if (state.phase === "point" || state.phase === "match") return { seq, move: { x: 0, y: 0 } };
  if (memory.hitCooldown > 0) memory.hitCooldown -= 1 / 60;

  if (state.phase === "serve") {
    if (state.server === index) {
      if (memory.serveAt < 0) memory.serveAt = state.time + rng.range(0.5, 1.2);
      if (state.time >= memory.serveAt) {
        memory.serveAt = -1;
        const aim = chooseAim(state, index, profile, rng);
        return { seq, move: { x: 0, y: 0 }, serve: true, hit: { type: "drive", aim } };
      }
    }
    const home = p.team === 0 ? { x: p.side === 1 ? 2.2 : -2.2, y: 4.5 } : { x: p.side === 1 ? 2.2 : -2.2, y: COURT.length - 4.5 };
    return { seq, move: seek(p, home, profile) };
  }

  const landing = predict(3.2);
  const hitter = designateHitter(state, landing, p.team);
  const ball = state.ball;

  if (landing && p.team === teamOfY(ball.pos.y) && landing.y > 0) {
    // Ball is travelling into our half.
    if (hitter !== index) {
      // Support: cover the net / middle rather than crowding the hitter.
      const support = p.team === 0 ? { x: p.side === 1 ? 2.6 : -2.6, y: 7.4 } : { x: p.side === 1 ? 2.6 : -2.6, y: COURT.length - 7.4 };
      return { seq, move: seek(p, support, profile) };
    }
    if (state.time >= memory.decisionAt) {
      memory.decisionAt = state.time + profile.reaction;
      const ex = rng.range(-profile.positionError, profile.positionError);
      const ey = rng.range(-profile.positionError, profile.positionError);
      const behind = p.team === 0 ? -0.55 : 0.55;
      const raw = { x: landing.x + ex, y: landing.y + behind + ey };
      memory.target = clampPlayer(raw.x, raw.y, p.team);
    }
    const onSide = teamOfY(ball.pos.y) === p.team;
    const d = dist2(p.pos, ball.pos);
    const reach = state.config.assist ? 1.32 : 1.2;
    const canHit = onSide && d <= reach + 0.25 && ball.pos.z <= 2.35 && memory.hitCooldown <= 0;
    if (canHit && rng.chance(1 - profile.missChance)) {
      memory.hitCooldown = 0.35;
      const shot = chooseShot(state, index, profile, rng);
      const aim = chooseAim(state, index, profile, rng);
      return { seq, move: { x: 0, y: 0 }, hit: { type: shot, aim } };
    }
    return { seq, move: seek(p, memory.target, profile) };
  }

  // Ball not coming to us: recover to a sensible court position.
  const home = p.team === 0
    ? { x: p.side === 1 ? 2.2 : -2.2, y: state.hitsThisRally === 0 ? 5.6 : 4.2 }
    : { x: p.side === 1 ? 2.2 : -2.2, y: state.hitsThisRally === 0 ? COURT.length - 5.6 : COURT.length - 4.2 };
  return { seq, move: seek(p, home, profile) };
}

function seek(p: { pos: Vec2; team: number }, target: Vec2, profile: Profile): Vec2 {
  const d = { x: target.x - p.pos.x, y: target.y - p.pos.y };
  if (len2(d) < 0.18) return { x: 0, y: 0 };
  return norm2(d);
}
