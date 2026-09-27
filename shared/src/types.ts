import type { Vec3 } from "./math.ts";
import type { Team } from "./geometry.ts";

export type ShotType = "drive" | "lob" | "volley" | "smash";
export type Difficulty = "rookie" | "pro";

/** One player's per-tick input. Move is a normalised stick vector in court space. */
export type PlayerInput = {
  seq: number;
  move: { x: number; y: number };
  /** Present on the tick the player pressed the hit control. */
  hit?: { type: ShotType; aim: { x: number; y: number } };
  /** Present on the tick the serving player requests a serve. */
  serve?: boolean;
};

export const EMPTY_INPUT: PlayerInput = { seq: 0, move: { x: 0, y: 0 } };

export type PlayerState = {
  index: number;
  team: Team;
  name: string;
  /** 0 = left half, 1 = right half (own perspective relative to centre line). */
  side: 0 | 1;
  /** Whether a human controls this seat; bots are simulated server/client side. */
  bot: boolean;
  difficulty: Difficulty;
  connected: boolean;
  pos: { x: number; y: number };
  vel: { x: number; y: number };
  /** Facing angle in radians (0 = +x). */
  facing: number;
  /** Racket swing animation timer (seconds remaining), 0 when idle. */
  swing: number;
  lastCue: string | null;
};

export type BallState = {
  pos: Vec3;
  vel: Vec3;
  /** Ground-plane spin/curve is not modelled; `live` false while parked for a serve. */
  live: boolean;
};

export type BallBounce = {
  count: number;
  side: Team | null;
  x: number;
  y: number;
  /** Any wall (glass/fence) touched since the last racket contact. */
  wallTouched: boolean;
  /** Net (including a top-cord clip) touched since the last racket contact. */
  netTouched: boolean;
  wallBeforeFloor: boolean;
  fenceTouched: boolean;
  /** Side on which the ball was struck last (for fault attribution). */
  struckSide: Team | null;
};

export type Score = {
  points: [number, number];
  games: [number, number];
  sets: [number, number];
  tiebreak: { active: boolean; points: [number, number]; target: number } | null;
};

export type MatchFormat = "short" | "full";

export type MatchConfig = {
  format: MatchFormat;
  gamesToWinSet: number;
  tiebreakAt: number;
  setsToWin: number;
  /** Assist enlarges the contact window slightly; never changes rule decisions. */
  assist: boolean;
};

export const SHORT_FORMAT: MatchConfig = {
  format: "short",
  gamesToWinSet: 4,
  tiebreakAt: 4,
  setsToWin: 1,
  assist: true,
};

export const FULL_FORMAT: MatchConfig = {
  format: "full",
  gamesToWinSet: 6,
  tiebreakAt: 6,
  setsToWin: 1,
  assist: false,
};

export type Phase = "serve" | "rally" | "point" | "match";

export type PointReason =
  | "double_bounce"
  | "out"
  | "wall_before_bounce"
  | "net"
  | "out_of_court"
  | "double_fault"
  | "not_returned"
  | "own_court"
  | "serve_out"
  | "serve_fence_fault"
  | "serve_net_fault";

export type FaultReason = "serve_out" | "serve_fence_fault" | "serve_net_fault" | "double_bounce" | "wall_before_bounce" | "net" | "out" | "out_of_court" | "own_court";

export type SimEvent =
  | { type: "hit"; player: number; shot: ShotType; pos: Vec3; quality: number }
  | { type: "floor"; pos: Vec3; side: Team; speed: number }
  | { type: "glass"; pos: Vec3; speed: number }
  | { type: "fence"; pos: Vec3; speed: number }
  | { type: "net"; pos: Vec3 }
  | { type: "serve"; player: number; number: 1 | 2 }
  | { type: "let"; reason: string }
  | { type: "fault"; player: number; reason: FaultReason; serve: boolean }
  | { type: "point"; team: Team; reason: PointReason; at: Vec3 }
  | { type: "game"; team: Team; games: [number, number] }
  | { type: "set"; team: Team }
  | { type: "match"; team: Team }
  | { type: "cue"; player: number; cue: string };

export type TeamMeta = { name: string; players: string[] };

export type MatchState = {
  config: MatchConfig;
  seed: number;
  players: PlayerState[];
  ball: BallState;
  phase: Phase;
  servingTeam: Team;
  /** Global player index currently serving. */
  server: number;
  serveNumber: 1 | 2;
  /** Number of completed games, used for serve rotation. */
  gamesPlayed: number;
  /** How many times each team has served (drives intra-team rotation). */
  servesByTeam: [number, number];
  score: Score;
  bounce: BallBounce;
  lastHitPlayer: number | null;
  lastHitTeam: Team | null;
  hitsThisRally: number;
  rallyStartAt: number;
  pointReason: PointReason | null;
  pointWinner: Team | null;
  winner: Team | null;
  /** Global player index receiving the current serve. */
  receiver: number;
  /** Short pause (seconds) after a point before the next serve is set up. */
  pauseTimer: number;
  /** Whether the current serve has already been called a let. */
  serveWasLet: boolean;
  teams: [TeamMeta, TeamMeta];
  /** Monotonic tick counter. */
  tick: number;
  time: number;
  /** Tips already shown this rally (rate limiting). */
  cueThisRally: boolean;
  eventSeq: number;
};

export type Snapshot = {
  tick: number;
  time: number;
  phase: Phase;
  ball: BallState;
  players: Array<Pick<PlayerState, "index" | "pos" | "vel" | "facing" | "swing" | "side" | "team" | "name" | "bot" | "connected" | "difficulty">>;
  score: Score;
  servingTeam: Team;
  server: number;
  serveNumber: 1 | 2;
  lastHitPlayer: number | null;
  pointReason: PointReason | null;
  pointWinner: Team | null;
  winner: Team | null;
  serverX: number;
};
