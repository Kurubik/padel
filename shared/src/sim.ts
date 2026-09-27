import type { BallState, Difficulty, MatchConfig, MatchState, PlayerInput, PlayerState, PointReason, Score, ShotType, SimEvent, Snapshot, TeamMeta } from "./types.ts";
import { EMPTY_INPUT, SHORT_FORMAT } from "./types.ts";
import type { Team } from "./geometry.ts";
import { COURT, clampPlayer, diagonalServeBox, inBox, isInsideCourt, netHeightAt, serviceBoxes, teamOfY } from "./geometry.ts";
import { approach, clamp, dist2, len2, len3, norm2, v2, v3, type Vec2 } from "./math.ts";
import { emptyScore, awardPoint, receiverFor, serveSpot, homeSpot, registerServe, solveServeVelocity } from "./rules.ts";
import { makeRng, type Rng } from "./rng.ts";
import { computeBotInput, newBotMemory, HUMAN_SPEED, BOT_PROFILES, type BotMemory } from "./bot.ts";

export const SIM_DT = 1 / 60;
export const SIM_HZ = 60;
const POINT_PAUSE = 2.4;
const ACCEL = 26;
const REACH = 1.2;
const REACH_ASSIST = 1.34;
const MAX_HIT_HEIGHT = 2.45;

export type SimOptions = {
  seed?: number;
  config?: MatchConfig;
  teams?: [TeamMeta, TeamMeta];
  /** Override which seats are bots; defaults to all non-human seats. */
  bots?: boolean[];
  difficulty?: [Difficulty, Difficulty];
  /** 1v1 practice format: one player per team instead of a doubles pair. */
  singles?: boolean;
  /** Seconds the point card holds before the next serve (default 2.4). */
  pointPause?: number;
};

const defaultTeams = (): [TeamMeta, TeamMeta] => [
  { name: "NIGHT", players: ["P1", "P2"] },
  { name: "DUSK", players: ["P3", "P4"] },
];

function freshBounce() {
  return { count: 0, side: null as Team | null, x: 0, y: 0, wallTouched: false, wallBeforeFloor: false, fenceTouched: false, netTouched: false, struckSide: null as Team | null };
}

/**
 * Authoritative padel match simulation. Fixed-step, deterministic and
 * serialisable. Both the browser (offline modes) and the Node room server use
 * exactly this class, so the rules are identical online and offline.
 */
export class Sim {
  private readonly pointPause: number;
  state: MatchState;
  readonly rng: Rng;
  readonly botRng: Rng;
  private inputs: Array<PlayerInput | undefined> = [];
  private botMemory = new Map<number, BotMemory>();
  events: SimEvent[] = [];
  serveActive = false;
  serveLanded = false;
  autoBots = true;

  constructor(opts: SimOptions = {}) {
    const config = opts.config ?? { ...SHORT_FORMAT };
    const teams = opts.teams ?? defaultTeams();
    this.pointPause = opts.pointPause ?? POINT_PAUSE;
    const perTeam = opts.singles ? 1 : 2;
    const botsDefault = opts.bots ?? [false, false, false, false].slice(0, perTeam * 2);
    const difficulty = opts.difficulty ?? ["pro", "pro"];
    const players: PlayerState[] = [];
    for (let t = 0 as Team; t <= 1; t++) {
      for (let s = 0; s < perTeam; s++) {
        const index = players.length;
        const bot = botsDefault[index] ?? false;
        const home = homeSpot(t, (opts.singles ? 1 : s) as 0 | 1);
        players.push({
          index,
          team: t,
          name: teams[t].players[s] ?? `P${index + 1}`,
          side: (opts.singles ? 1 : s & 1) as 0 | 1,
          bot,
          difficulty: difficulty[t],
          connected: !bot,
          pos: { x: home.x, y: home.y },
          vel: { x: 0, y: 0 },
          facing: t === 0 ? Math.PI / 2 : -Math.PI / 2,
          swing: 0,
          lastCue: null,
        });
      }
    }
    const seed = opts.seed ?? 1;
    this.rng = makeRng(seed);
    this.botRng = makeRng(seed ^ 0x9e3779b9);
    this.state = {
      config,
      seed,
      players,
      ball: { pos: v3(0, 10, 0.6), vel: v3(), live: false },
      phase: "serve",
      servingTeam: 0,
      server: 0,
      serveNumber: 1,
      gamesPlayed: 0,
      servesByTeam: [0, 0],
      score: emptyScore(),
      bounce: freshBounce(),
      lastHitPlayer: null,
      lastHitTeam: null,
      hitsThisRally: 0,
      rallyStartAt: 0,
      pointReason: null,
      pointWinner: null,
      winner: null,
      receiver: 2,
      pauseTimer: 0,
      serveWasLet: false,
      teams,
      tick: 0,
      time: 0,
      cueThisRally: false,
      eventSeq: 0,
    };
    for (const p of players) if (p.bot) this.botMemory.set(p.index, newBotMemory());
    this.setupServe();
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  setInput(index: number, input: PlayerInput): void {
    this.inputs[index] = input;
  }

  setBot(index: number, bot: boolean, difficulty?: Difficulty): void {
    const p = this.state.players[index];
    if (!p) return;
    p.bot = bot;
    p.connected = !bot;
    if (difficulty) p.difficulty = difficulty;
    if (bot && !this.botMemory.has(index)) this.botMemory.set(index, newBotMemory());
  }

  teamPlayers(team: Team): PlayerState[] {
    return this.state.players.filter((p) => p.team === team);
  }

  computeServer(): { team: Team; server: number } {
    const s = this.state;
    const team: Team = (s.gamesPlayed % 2) as Team;
    const mates = this.teamPlayers(team);
    const within = s.servesByTeam[team] % mates.length;
    return { team, server: mates[within].index };
  }

  setupServe(): void {
    const s = this.state;
    const { team, server } = this.computeServer();
    s.servingTeam = team;
    s.server = server;
    s.serveNumber = 1;
    s.serveWasLet = false;
    this.serveActive = false;
    this.serveLanded = false;
    s.bounce = freshBounce();
    s.hitsThisRally = 0;
    s.cueThisRally = false;
    s.pointReason = null;
    s.pointWinner = null;
    s.lastHitPlayer = null;
    s.lastHitTeam = null;
    s.receiver = receiverFor(
      s.players.map((p) => ({ team: p.team, side: p.side, index: p.index })),
      team === 0 ? 1 : 0,
      serveSpot(team, s.players[server].side).x,
    );
    this.positionForServe();
    const sp = serveSpot(team, s.players[server].side);
    s.ball = { pos: v3(sp.x, sp.y, 0.55), vel: v3(), live: false };
    s.phase = "serve";
    for (const p of s.players) {
      p.vel = { x: 0, y: 0 };
      p.swing = 0;
    }
  }

  private positionForServe(): void {
    const s = this.state;
    for (const p of s.players) {
      if (p.index === s.server) {
        const sp = serveSpot(p.team, p.side);
        p.pos = { x: sp.x, y: sp.y };
      } else if (p.team === s.servingTeam) {
        p.pos = { x: p.side === 1 ? 3.1 : -3.1, y: p.team === 0 ? 8.4 : COURT.length - 8.4 };
      } else {
        p.pos = { x: p.side === 1 ? 2.6 : -2.6, y: p.team === 0 ? 7.2 : COURT.length - 7.2 };
      }
      p.facing = p.team === 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  }

  step(dt = SIM_DT): void {
    const s = this.state;
    s.tick++;
    s.time += dt;
    if (s.phase === "match") {
      this.updatePlayers(dt, true);
      return;
    }
    if (s.phase === "point") {
      this.updatePlayers(dt, true);
      if (s.pauseTimer > 0) s.pauseTimer -= dt;
      if (s.pauseTimer <= 0) this.setupServe();
      return;
    }
    if (this.autoBots) this.driveBots();
    this.updatePlayers(dt, false);
    for (const p of s.players) if (p.swing > 0) p.swing = Math.max(0, p.swing - dt);

    if (s.phase === "serve") {
      const inp = this.inputs[s.server];
      if (inp?.serve) this.attemptServe(s.server);
      return;
    }

    // Resolve requested hits against the pre-step ball position.
    for (const p of s.players) {
      const inp = this.inputs[p.index];
      if (inp?.hit) this.attemptHit(p.index, inp.hit.type, inp.hit.aim);
    }
    if (s.phase !== "rally") return;
    this.integrateBall(dt);
  }

  private driveBots(): void {
    const s = this.state;
    for (const p of s.players) {
      if (!p.bot) continue;
      const mem = this.botMemory.get(p.index) ?? newBotMemory();
      this.botMemory.set(p.index, mem);
      const input = computeBotInput(s, p.index, (m) => predictLanding(s, m), mem, this.botRng);
      this.inputs[p.index] = input;
    }
  }

  private updatePlayers(dt: number, frozen: boolean): void {
    const s = this.state;
    for (const p of s.players) {
      const inp = this.inputs[p.index] ?? EMPTY_INPUT;
      const speed = p.bot ? BOT_PROFILES[p.difficulty].speed : HUMAN_SPEED;
      const mx = frozen ? 0 : inp.move.x;
      const my = frozen ? 0 : inp.move.y;
      const mag = Math.hypot(mx, my);
      const scale = mag > 1 ? 1 / mag : 1;
      const tx = mx * scale * speed;
      const ty = my * scale * speed;
      p.vel.x = approach(p.vel.x, tx, ACCEL * dt);
      p.vel.y = approach(p.vel.y, ty, ACCEL * dt);
      const next = clampPlayer(p.pos.x + p.vel.x * dt, p.pos.y + p.vel.y * dt, p.team);
      p.pos.x = next.x;
      p.pos.y = next.y;
      if (len2(p.vel) > 0.25) p.facing = Math.atan2(p.vel.y, p.vel.x);
    }
  }

  // ---------------------------------------------------------------- serving

  private attemptServe(index: number): void {
    const s = this.state;
    if (s.phase !== "serve" || s.server !== index) return;
    const p = s.players[index];
    const sp = serveSpot(p.team, p.side);
    const box = diagonalServeBox(p.team, sp.x);
    const inp = this.inputs[index];
    const aim = inp?.hit?.aim;
    const tx = clamp((box.xMin + box.xMax) / 2 + (aim ? aim.x * 2.2 : 0), box.xMin + 0.4, box.xMax - 0.4);
    const ty = clamp((box.yMin + box.yMax) / 2 + (aim ? aim.y * 0.6 : 0), box.yMin + 0.4, box.yMax - 0.4);
    const z0 = 0.55;
    const target = v2(tx, ty);
    const xc = sp.x + (tx - sp.x) * ((COURT.netY - sp.y) / (ty - sp.y));
    const sv = solveServeVelocity(sp.x, sp.y, z0, target.x, target.y, netHeightAt(xc));
    const vel = v3(sv.vx, sv.vy, sv.vz);
    s.ball = { pos: v3(sp.x, sp.y, z0), vel, live: true };
    s.bounce = freshBounce();
    s.lastHitPlayer = index;
    s.lastHitTeam = p.team;
    s.bounce.struckSide = p.team;
    s.hitsThisRally = 1;
    s.cueThisRally = false;
    this.serveActive = true;
    this.serveLanded = false;
    s.serveWasLet = false;
    s.phase = "rally";
    p.swing = 0.3;
    this.emit({ type: "serve", player: index, number: s.serveNumber });
  }

  private serveFault(reason: "serve_out" | "serve_fence_fault" | "serve_net_fault" | "wall_before_bounce"): void {
    const s = this.state;
    const serverTeam = s.lastHitTeam ?? s.servingTeam;
    this.emit({ type: "fault", player: s.server, reason, serve: true });
    this.serveActive = false;
    if (s.serveNumber === 1) {
      s.serveNumber = 2;
      s.ball.live = false;
      s.phase = "serve";
      this.serveLanded = false;
      s.bounce = freshBounce();
      this.emit({ type: "cue", player: s.server, cue: "serve.diagonal" });
      const sp = serveSpot(serverTeam, s.players[s.server].side);
      s.ball.pos = v3(sp.x, sp.y, 0.55);
      s.ball.vel = v3();
    } else {
      this.endPoint(serverTeam === 0 ? 1 : 0, "double_fault", s.ball.pos);
    }
  }

  private handleServeLanding(x: number, y: number, side: Team): void {
    const s = this.state;
    const serverTeam = (s.lastHitTeam ?? s.servingTeam) as Team;
    const sp = serveSpot(serverTeam, s.players[s.server].side);
    const box = diagonalServeBox(serverTeam, sp.x);
    if (inBox(box, x, y)) {
      if (s.bounce.netTouched) {
        this.emit({ type: "let", reason: "net" });
        s.serveWasLet = true;
        s.serveNumber = s.serveNumber; // a let does not consume the serve
        this.serveActive = false;
        s.phase = "serve";
        s.ball = { pos: v3(sp.x, sp.y, 0.55), vel: v3(), live: false };
        s.bounce = freshBounce();
        this.emit({ type: "cue", player: s.server, cue: "serve.let" });
        return;
      }
      this.emit({ type: "floor", pos: v3(x, y, 0), side, speed: Math.abs(s.ball.vel.z) });
      this.serveLanded = true;
      s.bounce.count = 1;
      s.bounce.side = side;
    } else {
      this.emit({ type: "floor", pos: v3(x, y, 0), side, speed: Math.abs(s.ball.vel.z) });
      this.serveFault(s.bounce.netTouched ? "serve_net_fault" : "serve_out");
    }
  }

  // ------------------------------------------------------------------ hits

  private attemptHit(index: number, shot: ShotType, aim: { x: number; y: number }): void {
    const s = this.state;
    const p = s.players[index];
    const ball = s.ball;
    if (!ball.live || s.phase !== "rally") return;
    const onSide = teamOfY(ball.pos.y) === p.team;
    const nearNet = Math.abs(ball.pos.y - COURT.netY) < 0.35;
    if (!onSide && !nearNet) return;
    if (s.lastHitTeam === p.team && s.bounce.count === 0) return; // partner already played it
    const d = dist2(p.pos, ball.pos);
    const reach = s.config.assist ? REACH_ASSIST : REACH;
    if (shot === "smash" && ball.pos.z < 1.4) shot = "drive";
    if (d > reach || ball.pos.z > MAX_HIT_HEIGHT) {
      if (!p.bot && !s.cueThisRally) {
        s.cueThisRally = true;
        this.emit({ type: "cue", player: index, cue: d > reach ? "cue.moveCloser" : "cue.tooHigh" });
      }
      return;
    }
    if (d < 0.3 && !p.bot && !s.cueThisRally) {
      s.cueThisRally = true;
      this.emit({ type: "cue", player: index, cue: "cue.tooClose" });
    }
    // Contact quality: sweet spot ~0.6 m from the body, penalise extremes.
    const quality = clamp(1 - Math.abs(d - 0.62) / 1.05, 0.22, 1);
    const vel = this.shotVelocity(p, shot, aim, quality);
    ball.vel = vel;
    ball.pos.z = Math.max(ball.pos.z, COURT.ballRadius);
    s.lastHitPlayer = index;
    s.lastHitTeam = p.team;
    s.bounce = freshBounce();
    s.bounce.struckSide = p.team;
    s.hitsThisRally++;
    this.serveActive = false;
    this.serveLanded = false;
    p.swing = 0.28;
    this.emit({ type: "hit", player: index, shot, pos: { ...ball.pos }, quality });
  }

  private shotVelocity(p: PlayerState, shot: ShotType, aim: Vec2, quality: number): { x: number; y: number; z: number } {
    const ball = this.state.ball;
    const forward = p.team === 0 ? 1 : -1;
    let dir = v2(aim.x, aim.y);
    if (len2(dir) < 1e-3) dir = v2(0, forward);
    dir = norm2(dir);
    if (dir.y * forward < 0.15) dir = norm2(v2(dir.x, dir.y + forward * 0.9));
    const cfg: Record<ShotType, { speed: number; elev: number }> = {
      drive: { speed: 15.5, elev: 0.13 },
      lob: { speed: 10.0, elev: 0.72 },
      volley: { speed: 13.5, elev: 0.05 },
      smash: { speed: 18.5, elev: -0.3 },
    };
    const c = cfg[shot];
    const speed = c.speed * (0.72 + 0.34 * quality);
    const noise = (this.rng.next() - 0.5) * 0.05 * (1.1 - quality) * (p.bot ? 2.2 : 1);
    const ang = Math.atan2(dir.y, dir.x) + noise;
    const horiz = Math.cos(c.elev) * speed;
    return v3(Math.cos(ang) * horiz, Math.sin(ang) * horiz, Math.sin(c.elev) * speed);
  }

  // --------------------------------------------------------- ball physics

  private integrateBall(dt: number): void {
    const s = this.state;
    let remaining = dt;
    let guard = 0;
    while (remaining > 1e-6 && guard++ < 48) {
      if (!s.ball.live || s.phase !== "rally") break;
      const speed = len3(s.ball.vel);
      const h = Math.min(remaining, clamp(COURT.ballRadius * 0.55 / Math.max(speed, 1.5), 0.0007, 0.004));
      remaining -= h;
      this.ballSubstep(h);
    }
  }

  private ballSubstep(h: number): void {
    const s = this.state;
    const b = s.ball;
    const r = COURT.ballRadius;
    const prev = { x: b.pos.x, y: b.pos.y, z: b.pos.z };
    b.vel.z += COURT.gravity * h;
    const drag = 1 - COURT.airDrag * h;
    b.vel.x *= drag;
    b.vel.y *= drag;
    b.vel.z *= drag;
    b.pos.x += b.vel.x * h;
    b.pos.y += b.vel.y * h;
    b.pos.z += b.vel.z * h;

    if (b.pos.z <= r && b.vel.z <= 0) {
      b.pos.z = r;
      const vz = b.vel.z;
      b.vel.z = -vz * COURT.floorRestitution;
      b.vel.x *= COURT.floorFriction;
      b.vel.y *= COURT.floorFriction;
      const inside = isInsideCourt(b.pos.x, b.pos.y, 0.05);
      if (!inside) {
        this.ballOutOfCourt();
        return;
      }
      if (this.serveActive && !this.serveLanded) {
        this.handleServeLanding(b.pos.x, b.pos.y, teamOfY(b.pos.y));
      } else {
        this.emit({ type: "floor", pos: v3(b.pos.x, b.pos.y, 0), side: teamOfY(b.pos.y), speed: Math.abs(vz) });
        this.onFloorBounce(b.pos.x, b.pos.y);
      }
      if (s.phase !== "rally") return;
    }

    // Side glass / fence.
    if (b.pos.x + r > COURT.halfWidth || b.pos.x - r < -COURT.halfWidth) {
      const sign = b.pos.x >= 0 ? 1 : -1;
      b.pos.x = sign * (COURT.halfWidth - r);
      if (b.pos.z < COURT.glassHeight) {
        b.vel.x = -b.vel.x * COURT.glassRestitution;
        b.vel.y *= COURT.glassFriction;
        this.emit({ type: "glass", pos: v3(b.pos.x, b.pos.y, b.pos.z), speed: Math.abs(b.vel.x) });
        this.onWall("glass", v3(b.pos.x, b.pos.y, b.pos.z));
      } else if (b.pos.z < COURT.fenceTopHeight) {
        b.vel.x = -b.vel.x * COURT.fenceRestitution;
        b.vel.y *= COURT.fenceFriction;
        this.emit({ type: "fence", pos: v3(b.pos.x, b.pos.y, b.pos.z), speed: Math.abs(b.vel.x) });
        this.onWall("fence", v3(b.pos.x, b.pos.y, b.pos.z));
      } else {
        this.ballOutOfCourt();
      }
      if (s.phase !== "rally") return;
    }

    // Back glass / fence.
    if (b.pos.y + r > COURT.length || b.pos.y - r < 0) {
      const atHigh = b.pos.y > COURT.netY;
      b.pos.y = atHigh ? COURT.length - r : r;
      if (b.pos.z < COURT.glassHeight) {
        b.vel.y = -b.vel.y * COURT.glassRestitution;
        b.vel.x *= COURT.glassFriction;
        this.emit({ type: "glass", pos: v3(b.pos.x, b.pos.y, b.pos.z), speed: Math.abs(b.vel.y) });
        this.onWall("glass", v3(b.pos.x, b.pos.y, b.pos.z));
      } else if (b.pos.z < COURT.fenceTopHeight) {
        b.vel.y = -b.vel.y * COURT.fenceRestitution;
        b.vel.x *= COURT.fenceFriction;
        this.emit({ type: "fence", pos: v3(b.pos.x, b.pos.y, b.pos.z), speed: Math.abs(b.vel.y) });
        this.onWall("fence", v3(b.pos.x, b.pos.y, b.pos.z));
      } else {
        this.ballOutOfCourt();
      }
      if (s.phase !== "rally") return;
    }

    // Net.
    if ((prev.y - COURT.netY) * (b.pos.y - COURT.netY) < 0) {
      const t = (COURT.netY - prev.y) / (b.pos.y - prev.y);
      const zc = prev.z + (b.pos.z - prev.z) * t;
      const xc = prev.x + (b.pos.x - prev.x) * t;
      const hNet = netHeightAt(xc);
      if (Math.abs(xc) <= COURT.halfWidth && zc <= hNet + 0.02) {
        s.bounce.netTouched = true;
        this.emit({ type: "net", pos: v3(xc, COURT.netY, zc) });
        if (zc > hNet - 0.14) {
          // Clipped the tape: the ball trickles on but loses most of its energy,
          // which is how a net cord can still land in the opponent court.
          b.pos.x = xc;
          b.pos.z = zc;
          b.vel.x *= 0.35;
          b.vel.y *= 0.5;
          b.vel.z *= 0.45;
        } else {
          b.pos.x = xc;
          b.pos.z = zc;
          b.pos.y = prev.y;
          b.vel.y = -b.vel.y * COURT.netRestitution;
          b.vel.x *= 0.4;
          b.vel.z *= 0.35;
        }
      }
    }
  }

  private onFloorBounce(x: number, y: number): void {
    const s = this.state;
    const side = teamOfY(y);
    if (s.bounce.count === 0) {
      s.bounce.count = 1;
      s.bounce.side = side;
      if (side === s.lastHitTeam) {
        this.endPoint((1 - (s.lastHitTeam ?? 0)) as Team, "own_court", v3(x, y, 0));
      }
      return;
    }
    // Second (or later) floor bounce ends the rally for the team on that side.
    this.endPoint((1 - side) as Team, side === s.bounce.side ? "double_bounce" : "out", v3(x, y, 0));
  }

  private onWall(kind: "glass" | "fence", at: { x: number; y: number; z: number }): void {
    const s = this.state;
    s.bounce.wallTouched = true;
    if (kind === "fence") s.bounce.fenceTouched = true;
    const striker = (s.lastHitTeam ?? 0) as Team;
    if (this.serveActive) {
      if (kind === "fence") return this.serveFault("serve_fence_fault");
      if (!this.serveLanded) return this.serveFault("wall_before_bounce");
      return; // side glass after the serve bounce stays in play (FIP rule 6)
    }
    if (s.bounce.count === 0) {
      s.bounce.wallBeforeFloor = true;
      this.endPoint((1 - striker) as Team, "wall_before_bounce", at);
    }
  }

  private ballOutOfCourt(): void {
    const s = this.state;
    if (this.serveActive) return this.serveFault("serve_out");
    const striker = (s.lastHitTeam ?? 0) as Team;
    this.endPoint((1 - striker) as Team, "out_of_court", { ...s.ball.pos });
  }

  private endPoint(winner: Team, reason: PointReason, at: { x: number; y: number; z: number }): void {
    const s = this.state;
    if (s.phase !== "rally") return;
    const gamesBefore: [number, number] = [s.score.games[0], s.score.games[1]];
    this.emit({ type: "point", team: winner, reason, at: v3(at.x, at.y, at.z) });
    const outcome = awardPoint(s.score, winner, s.config);
    s.score = outcome.score;
    s.pointWinner = winner;
    s.pointReason = reason;
    s.ball.live = false;
    s.phase = "point";
    s.pauseTimer = this.pointPause;
    s.cueThisRally = false;
    const gamesChanged = s.score.games[0] !== gamesBefore[0] || s.score.games[1] !== gamesBefore[1];
    if (gamesChanged) {
      registerServe(s.servesByTeam, s.servingTeam);
      s.gamesPlayed++;
    }
    for (const e of outcome.events) this.emit(e);
    if (outcome.matchWon) {
      s.winner = winner;
      s.phase = "match";
      s.pauseTimer = 0;
    }
  }

  private emit(e: SimEvent): void {
    this.state.eventSeq++;
    this.events.push(e);
  }

  snapshot(): Snapshot {
    const s = this.state;
    return {
      tick: s.tick,
      time: s.time,
      phase: s.phase,
      ball: { pos: { ...s.ball.pos }, vel: { ...s.ball.vel }, live: s.ball.live },
      players: s.players.map((p) => ({
        index: p.index, pos: { ...p.pos }, vel: { ...p.vel }, facing: p.facing, swing: p.swing,
        side: p.side, team: p.team, name: p.name, bot: p.bot, connected: p.connected, difficulty: p.difficulty,
      })),
      score: {
        points: [s.score.points[0], s.score.points[1]],
        games: [s.score.games[0], s.score.games[1]],
        sets: [s.score.sets[0], s.score.sets[1]],
        tiebreak: s.score.tiebreak ? { active: s.score.tiebreak.active, points: [s.score.tiebreak.points[0], s.score.tiebreak.points[1]], target: s.score.tiebreak.target } : null,
      },
      servingTeam: s.servingTeam,
      server: s.server,
      serveNumber: s.serveNumber,
      lastHitPlayer: s.lastHitPlayer,
      pointReason: s.pointReason,
      pointWinner: s.pointWinner,
      winner: s.winner,
      serverX: serveSpot(s.players[s.server].team, s.players[s.server].side).x,
    };
  }
}

/**
 * Forward-simulate the current ball (ignoring players) to its first floor
 * contact. Used by bots for interception and by the client for the landing cue.
 */
export function predictLanding(state: MatchState, maxSeconds = 3): { x: number; y: number; time: number } | null {
  if (!state.ball.live) return null;
  return predictBall(state.ball, maxSeconds);
}

/** Forward-simulate any ball to its first floor contact (used by the client). */
export function predictBall(ball: { pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number } }, maxSeconds = 3): { x: number; y: number; time: number } | null {
  const b: BallState = { pos: { ...ball.pos }, vel: { ...ball.vel }, live: true };
  const h = 1 / 180;
  let t = 0;
  while (t < maxSeconds) {
    t += h;
    b.vel.z += COURT.gravity * h;
    const drag = 1 - COURT.airDrag * h;
    b.vel.x *= drag; b.vel.y *= drag; b.vel.z *= drag;
    b.pos.x += b.vel.x * h;
    b.pos.y += b.vel.y * h;
    b.pos.z += b.vel.z * h;
    const r = COURT.ballRadius;
    if (Math.abs(b.pos.x) + r > COURT.halfWidth && b.pos.z < COURT.fenceTopHeight) {
      b.pos.x = Math.sign(b.pos.x) * (COURT.halfWidth - r);
      b.vel.x = -b.vel.x * (b.pos.z < COURT.glassHeight ? COURT.glassRestitution : COURT.fenceRestitution);
    }
    if (b.pos.y + r > COURT.length && b.pos.z < COURT.fenceTopHeight) {
      b.pos.y = COURT.length - r;
      b.vel.y = -b.vel.y * (b.pos.z < COURT.glassHeight ? COURT.glassRestitution : COURT.fenceRestitution);
    } else if (b.pos.y - r < 0 && b.pos.z < COURT.fenceTopHeight) {
      b.pos.y = r;
      b.vel.y = -b.vel.y * (b.pos.z < COURT.glassHeight ? COURT.glassRestitution : COURT.fenceRestitution);
    }
    if (b.pos.z <= r && b.vel.z <= 0) {
      return { x: b.pos.x, y: b.pos.y, time: t };
    }
  }
  return null;
}
