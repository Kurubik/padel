import type { SimEvent } from "./types.ts";
import { COURT, diagonalServeBox, inBox, netHeightAt, teamOfY } from "./geometry.ts";
import { solveServeVelocity } from "./rules.ts";
import { clamp, norm2, v3, type Vec2 } from "./math.ts";
import { makeRng, type Rng } from "./rng.ts";
import type { ShotType } from "./types.ts";

export type DrillKind = "wall" | "serve";

export type DrillBall = { x: number; y: number; z: number; vx: number; vy: number; vz: number; floorBounces: number };
export type DrillState = {
  kind: DrillKind;
  player: { x: number; y: number; facing: number; swing: number };
  ball: DrillBall;
  /** Consecutive controlled returns (wall) or legal serves (serve drill). */
  streak: number;
  best: number;
  attempts: number;
  messageKey: string;
  /** Set when a serve drill ball lands legally so the UI can flash. */
  lastGood: boolean;
  /** True while a swing now would connect — the UI lights the hit pad on it. */
  canHit: boolean;
};

const PLAYER_SPEED = 4.4;
/**
 * Drill contact window. Deliberately more generous than the match reach (1.34 m):
 * a training drill must be winnable with one thumb on a phone, and drills are
 * never presented as official play.
 */
const DRILL_REACH = 1.95;
const DRILL_MAX_HIT_HEIGHT = 2.7;

/**
 * Training drills. Wall practice feeds balls that the single player must return
 * into their own wall/glass and control; the serve variant counts legal serves
 * into the diagonal box. Neither is an official match.
 */
export class WallDrill {
  state: DrillState;
  private rng: Rng;
  private readonly team = 0 as const;
  private readonly side = 1 as const;

  constructor(kind: DrillKind = "wall", seed = 7) {
    this.rng = makeRng(seed);
    this.state = {
      kind,
      player: { x: 2.4, y: 16.4, facing: Math.PI / 2, swing: 0 },
      ball: { x: 0, y: 0, z: 0.5, vx: 0, vy: 0, vz: 0, floorBounces: 0 },
      streak: 0,
      best: 0,
      attempts: 0,
      messageKey: "",
      lastGood: true,
      canHit: false,
    };
    this.feed();
  }

  /** Advance one fixed step. Returns events for sound / effects. `move` is a stick vector. */
  update(move: Vec2, hit?: { type: ShotType; aim: Vec2 }, dt = 1 / 60): SimEvent[] {
    const events: SimEvent[] = [];
    const s = this.state;
    const mag = Math.hypot(move.x, move.y);
    const scale = mag > 1 ? 1 / mag : 1;
    s.player.x = clamp(s.player.x + move.x * scale * PLAYER_SPEED * dt, -4.7, 4.7);
    s.player.y = clamp(s.player.y + move.y * scale * PLAYER_SPEED * dt, 10.7, 19.6);
    if (s.player.swing > 0) s.player.swing = Math.max(0, s.player.swing - dt);
    if (hit) this.tryHit(hit, events);
    this.stepBall(dt, events);
    const b = s.ball;
    s.canHit = Math.hypot(b.x - s.player.x, b.y - s.player.y) <= DRILL_REACH && b.z > 0 && b.z <= DRILL_MAX_HIT_HEIGHT;
    return events;
  }

  private tryHit(hit: { type: ShotType; aim: Vec2 }, events: SimEvent[]): void {
    const s = this.state;
    const b = s.ball;
    const d = Math.hypot(b.x - s.player.x, b.y - s.player.y);
    if (d > DRILL_REACH || b.z > DRILL_MAX_HIT_HEIGHT || b.z <= 0) return;
    s.player.swing = 0.28;
    const dir = norm2({ x: hit.aim.x, y: hit.aim.y });
    const speed = hit.type === "lob" ? 8.5 : hit.type === "smash" ? 16 : 12.5;
    const elev = hit.type === "lob" ? 0.7 : hit.type === "smash" ? -0.25 : 0.12;
    b.vx = dir.x * speed * Math.cos(elev);
    b.vy = dir.y * speed * Math.cos(elev);
    b.vz = speed * Math.sin(elev);
    b.floorBounces = 0;
    s.attempts++;
    s.streak++;
    s.best = Math.max(s.best, s.streak);
    s.messageKey = "";
    events.push({ type: "hit", player: 0, shot: hit.type, pos: v3(b.x, b.y, b.z), quality: clamp(1 - Math.abs(d - 0.6), 0.3, 1) });
  }

  private stepBall(dt: number, events: SimEvent[]): void {
    const s = this.state;
    const b = s.ball;
    const sub = Math.max(1, Math.ceil((Math.abs(b.vz) + Math.hypot(b.vx, b.vy)) * dt / 0.03));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      const r = COURT.ballRadius;
      b.vz += COURT.gravity * h;
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.z += b.vz * h;
      if (b.z <= r && b.vz <= 0) {
        b.z = r;
        b.vz = -b.vz * COURT.floorRestitution;
        b.vx *= COURT.floorFriction;
        b.vy *= COURT.floorFriction;
        events.push({ type: "floor", pos: v3(b.x, b.y, 0), side: teamOfY(b.y), speed: Math.abs(b.vz) });
        b.floorBounces++;
        if (s.kind === "serve") {
          this.judgeServe(b.x, b.y);
        } else if (b.floorBounces > 1) {
          this.miss("drill.keepUp");
        }
      }
      if (Math.abs(b.x) + r > COURT.halfWidth) {
        b.x = Math.sign(b.x) * (COURT.halfWidth - r);
        if (b.z < COURT.glassHeight) {
          b.vx = -b.vx * COURT.glassRestitution;
          events.push({ type: "glass", pos: v3(b.x, b.y, b.z), speed: Math.abs(b.vx) });
        } else {
          b.vx = -b.vx * COURT.fenceRestitution;
          events.push({ type: "fence", pos: v3(b.x, b.y, b.z), speed: Math.abs(b.vx) });
        }
      }
      if (b.y + r > COURT.length) {
        b.y = COURT.length - r;
        if (b.z < COURT.glassHeight) {
          b.vy = -b.vy * COURT.glassRestitution;
          events.push({ type: "glass", pos: v3(b.x, b.y, b.z), speed: Math.abs(b.vy) });
        } else {
          b.vy = -b.vy * COURT.fenceRestitution;
          events.push({ type: "fence", pos: v3(b.x, b.y, b.z), speed: Math.abs(b.vy) });
        }
      }
      if (b.z > COURT.fenceTopHeight && b.y > COURT.netY) this.miss("drill.overTheTop");
      if ((b.y - COURT.netY) * (b.y - COURT.netY) < 1e-9) continue;
      if (b.y - r < 0) {
        b.y = r;
        b.vy = -b.vy * COURT.glassRestitution;
      }
    }
  }

  private judgeServe(x: number, y: number): void {
    const s = this.state;
    const sp = { x: 2.1, y: COURT.serviceLineHigh + 0.7 };
    const box = diagonalServeBox(this.team, sp.x);
    s.lastGood = inBox(box, x, y);
    if (s.lastGood) {
      s.streak++;
      s.best = Math.max(s.best, s.streak);
      s.attempts++;
      s.messageKey = "drill.serveGood";
    } else {
      s.streak = 0;
      s.attempts++;
      s.messageKey = "drill.serveOut";
    }
    this.feed();
  }

  private miss(key: string): void {
    const s = this.state;
    s.streak = 0;
    s.messageKey = key;
    this.feed();
  }

  private feed(): void {
    const s = this.state;
    s.ball.floorBounces = 0;
    if (s.kind === "serve") {
      const sp = { x: 2.1, y: COURT.serviceLineHigh + 0.7 };
      s.player.x = sp.x;
      s.player.y = sp.y;
      // The target is the diagonal box (across both the net and the centre line).
      const box = diagonalServeBox(this.team, sp.x);
      this.launch(sp.x, sp.y, 0.55, (box.xMin + box.xMax) / 2, (box.yMin + box.yMax) / 2 + 0.4);
      return;
    }
    // Feed gently toward wherever the player stands: the first contact of a
    // rally drill should never require a sprint.
    const tx = clamp(s.player.x + this.rng.range(-1.0, 1.0), -4.2, 4.2);
    const ty = clamp(s.player.y + this.rng.range(-1.1, 0.5), 12, 19.2);
    const sx = clamp(tx + this.rng.range(-2.4, 2.4), -4.2, 4.2);
    this.launchArc(sx, 11.2, 0.95, tx, ty, 1.05);
  }

  /** Simple ballistic feed: no net to clear, so no serve solver involved. */
  private launchArc(sx: number, sy: number, sz: number, tx: number, ty: number, T: number): void {
    const s = this.state;
    const r = COURT.ballRadius;
    s.ball.x = sx;
    s.ball.y = sy;
    s.ball.z = sz;
    s.ball.vx = (tx - sx) / T;
    s.ball.vy = (ty - sy) / T;
    s.ball.vz = (r - sz - 0.5 * COURT.gravity * T * T) / T;
  }

  private launch(sx: number, sy: number, sz: number, tx: number, ty: number): void {
    const s = this.state;
    const xc = sx + (tx - sx) * ((COURT.netY - sy) / (ty - sy));
    const sv = solveServeVelocity(sx, sy, sz, tx, ty, netHeightAt(xc));
    s.ball.x = sx;
    s.ball.y = sy;
    s.ball.z = sz;
    s.ball.vx = sv.vx;
    s.ball.vy = sv.vy;
    s.ball.vz = sv.vz;
  }
}
