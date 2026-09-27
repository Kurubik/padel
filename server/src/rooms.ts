import { randomBytes } from "node:crypto";
import { Sim, SHORT_FORMAT, FULL_FORMAT, makeRoomCode, ROOM_IDLE_MS, RECONNECT_GRACE_MS, SNAPSHOT_HZ, SIM_DT, MAX_PLAYERS, PROTOCOL_VERSION } from "@padel/shared";
import type { ClientMessage, Difficulty, MatchConfig, PlayerInput, SeatInfo, ServerMessage, ShotType } from "@padel/shared";

const SEAT_ORDER = [0, 2, 1, 3] as const;

/** Seats 0/1 form team 0 and seats 2/3 form team 1 — the same split the Sim uses. */
export function teamOfSeat(seat: number): 0 | 1 {
  return (seat < 2 ? 0 : 1) as 0 | 1;
}
const MAX_MSGS_PER_SEC = 120;
const SHOT_TYPES: ShotType[] = ["drive", "lob", "volley", "smash"];

export type RoomHooks = {
  now(): number;
  broadcast(msg: ServerMessage): void;
  sendTo(seat: number, msg: ServerMessage): void;
};

export type Seat = {
  seat: number;
  name: string;
  token: string;
  bot: boolean;
  connected: boolean;
  difficulty: Difficulty;
  lastInput: PlayerInput | undefined;
  msgWindow: number;
  msgCount: number;
  disconnectedAt: number | null;
};

function clampMove(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return n < -1 ? -1 : n > 1 ? 1 : n;
}

/**
 * One private room. Owns a single authoritative Sim; clients only ever send
 * inputs and receive snapshots/events. Seats keep a reconnect token so a
 * dropped player can reclaim their seat inside the grace window.
 */
export class Room {
  code: string;
  config: MatchConfig;
  sim: Sim;
  seats: Seat[];
  hostSeat = -1;
  started = false;
  createdAt: number;
  lastActivity: number;
  private hooks: RoomHooks;
  private snapshotAcc = 0;
  private tickAcc = 0;

  constructor(code: string, format: MatchConfig["format"], hooks: RoomHooks, seed = Date.now()) {
    this.code = code;
    this.config = format === "full" ? { ...FULL_FORMAT } : { ...SHORT_FORMAT };
    this.hooks = hooks;
    this.createdAt = hooks.now();
    this.lastActivity = this.createdAt;
    this.sim = new Sim({
      seed,
      config: this.config,
      bots: [true, true, true, true],
      difficulty: ["rookie", "rookie"],
    });
    this.seats = SEAT_ORDER.map((seat) => ({
      seat,
      name: "",
      token: "",
      bot: true,
      connected: false,
      difficulty: "rookie",
      lastInput: undefined,
      msgWindow: 0,
      msgCount: 0,
      disconnectedAt: null,
    }));
  }

  seatsInfo(): SeatInfo[] {
    return this.seats
      .map((s) => ({
        seat: s.seat,
        name: s.name || (s.bot ? `Bot ${s.seat + 1}` : ""),
        team: teamOfSeat(s.seat),
        bot: s.bot,
        connected: s.connected,
        difficulty: s.difficulty,
      }))
      .sort((a, b) => a.seat - b.seat);
  }

  private post(seat: number, msg: ServerMessage): void {
    this.hooks.sendTo(seat, msg);
  }

  private broadcastSeats(): void {
    const players: SeatInfo[] = this.seatsInfo();
    this.hooks.broadcast({ t: "room", code: this.code, players, hostSeat: this.hostSeat, started: this.started });
  }

  /** Join as a human, optionally reclaiming a seat with a token. Returns the seat. */
  join(name: string, token?: string): { seat: number; token: string; host: boolean } | null {
    const clean = (name || "").trim().slice(0, 16) || "Player";
    if (token) {
      const existing = this.seats.find((s) => s.token && s.token === token);
      if (existing) {
        existing.connected = true;
        existing.bot = false;
        existing.disconnectedAt = null;
        existing.name = clean;
        this.sim.setBot(existing.seat, false);
        this.lastActivity = this.hooks.now();
        this.broadcastSeats();
        return { seat: existing.seat, token: existing.token, host: existing.seat === this.hostSeat };
      }
    }
    const free = SEAT_ORDER.map((i) => this.seats.find((s) => s.seat === i)!).find((s) => !s.connected && !s.name);
    if (!free) return null;
    free.name = clean;
    free.token = randomBytes(16).toString("hex");
    free.bot = false;
    free.connected = true;
    free.disconnectedAt = null;
    free.lastInput = undefined;
    this.sim.setBot(free.seat, false);
    if (this.hostSeat < 0) this.hostSeat = free.seat;
    this.lastActivity = this.hooks.now();
    this.broadcastSeats();
    return { seat: free.seat, token: free.token, host: free.seat === this.hostSeat };
  }

  welcome(seat: number): ServerMessage {
    const s = this.seats.find((x) => x.seat === seat)!;
    return {
      t: "welcome",
      v: PROTOCOL_VERSION,
      code: this.code,
      seat,
      token: s.token,
      host: seat === this.hostSeat,
      players: this.seatsInfo(),
      config: this.config,
      started: this.started,
    };
  }

  disconnect(seat: number): void {
    const s = this.seats.find((x) => x.seat === seat);
    if (!s || s.bot) return;
    s.connected = false;
    s.disconnectedAt = this.hooks.now();
    this.lastActivity = this.hooks.now();
    this.broadcastSeats();
  }

  /** Give up a seat for good (explicit leave). */
  leave(seat: number): void {
    const s = this.seats.find((x) => x.seat === seat);
    if (!s) return;
    s.connected = false;
    s.name = "";
    s.token = "";
    s.bot = true;
    s.difficulty = "rookie";
    this.sim.setBot(seat, true, "rookie");
    if (this.hostSeat === seat) {
      const next = this.seats.find((x) => x.connected);
      this.hostSeat = next ? next.seat : -1;
    }
    this.broadcastSeats();
  }

  fillBots(difficulty: Difficulty): void {
    for (const s of this.seats) {
      if (!s.connected) {
        s.bot = true;
        s.difficulty = difficulty;
        this.sim.setBot(s.seat, true, difficulty);
      }
    }
    this.broadcastSeats();
  }

  start(): boolean {
    const humans = this.seats.filter((s) => s.connected).length;
    if (humans < 1) return false;
    for (const s of this.seats) {
      if (!s.connected) {
        s.bot = true;
        this.sim.setBot(s.seat, true, s.difficulty);
      }
    }
    this.started = true;
    this.hooks.broadcast({ t: "started", config: this.config });
    this.broadcastSeats();
    return true;
  }

  handleInput(seat: number, msg: Extract<ClientMessage, { t: "input" }>): void {
    const s = this.seats.find((x) => x.seat === seat);
    if (!s || s.bot) return;
    const now = this.hooks.now();
    if (now - s.msgWindow >= 1000) {
      s.msgWindow = now;
      s.msgCount = 0;
    }
    if (++s.msgCount > MAX_MSGS_PER_SEC) return; // rate-limit abuse
    const hit = msg.hit && SHOT_TYPES.includes(msg.hit.type)
      ? { type: msg.hit.type, aim: { x: clampMove(msg.hit.aim?.x), y: clampMove(msg.hit.aim?.y) } }
      : undefined;
    const input: PlayerInput = {
      seq: typeof msg.seq === "number" ? msg.seq : 0,
      move: { x: clampMove(msg.move?.x), y: clampMove(msg.move?.y) },
      hit,
      serve: msg.serve === true,
    };
    s.lastInput = input;
    this.sim.setInput(seat, input);
    this.lastActivity = now;
  }

  tick(dt: number): void {
    if (!this.started) return;
    this.tickAcc += dt;
    let steps = 0;
    while (this.tickAcc >= SIM_DT && steps < 5) {
      this.tickAcc -= SIM_DT;
      steps++;
      // Bots that took over a dropped seat keep playing.
      this.sim.step(SIM_DT);
    }
    const events = this.sim.drainEvents();
    if (events.length) this.hooks.broadcast({ t: "events", events });
    this.snapshotAcc += dt;
    if (this.snapshotAcc >= 1 / SNAPSHOT_HZ) {
      this.snapshotAcc = 0;
      const snap = this.sim.snapshot();
      this.hooks.broadcast({ t: "snapshot", snap, ack: this.sim.state.tick, serverTime: this.hooks.now() });
    }
    // A disconnected player's seat is handed to a bot after the grace window.
    const now = this.hooks.now();
    for (const s of this.seats) {
      if (!s.bot && !s.connected && s.disconnectedAt && now - s.disconnectedAt > RECONNECT_GRACE_MS) {
        s.bot = true;
        s.difficulty = "rookie";
        this.sim.setBot(s.seat, true, "rookie");
        this.broadcastSeats();
      }
    }
  }

  isIdle(now: number): boolean {
    const anyConnected = this.seats.some((s) => s.connected);
    const matchOver = this.sim.state.phase === "match";
    return now - this.lastActivity > ROOM_IDLE_MS || (!anyConnected && !matchOver && now - this.lastActivity > 5 * 60 * 1000);
  }

  isEmpty(): boolean {
    return this.seats.every((s) => !s.connected);
  }
}
