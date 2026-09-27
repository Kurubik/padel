import type { Difficulty, MatchConfig, ShotType, SimEvent, Snapshot } from "./types.ts";
import type { Team } from "./geometry.ts";

export const PROTOCOL_VERSION = 1;
/** Server simulation tick rate and snapshot cadence (Hz). */
export const SERVER_HZ = 60;
export const SNAPSHOT_HZ = 20;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;
export const MAX_PLAYERS = 4;
export const ROOM_IDLE_MS = 30 * 60 * 1000;
export const RECONNECT_GRACE_MS = 60 * 1000;

export type SeatInfo = {
  seat: number;
  name: string;
  team: Team;
  bot: boolean;
  connected: boolean;
  difficulty: Difficulty;
};

export type ClientMessage =
  | { t: "hello"; v: number; name: string; code?: string; token?: string; create?: boolean; format?: MatchConfig["format"] }
  | { t: "input"; seq: number; move: { x: number; y: number }; hit?: { type: ShotType; aim: { x: number; y: number } }; serve?: boolean }
  | { t: "fillBots"; difficulty: Difficulty }
  | { t: "start" }
  | { t: "leave" }
  | { t: "ping"; at: number };

export type ServerMessage =
  | { t: "welcome"; v: number; code: string; seat: number; token: string; host: boolean; players: SeatInfo[]; config: MatchConfig; started: boolean }
  | { t: "room"; code: string; players: SeatInfo[]; hostSeat: number; started: boolean }
  | { t: "started"; config: MatchConfig }
  | { t: "snapshot"; snap: Snapshot; ack: number; serverTime: number }
  | { t: "events"; events: SimEvent[] }
  | { t: "pong"; at: number; serverTime: number }
  | { t: "error"; code: string; message: string };

export function makeRoomCode(rng: () => number): string {
  let out = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) out += ROOM_CODE_ALPHABET[Math.floor(rng() * ROOM_CODE_ALPHABET.length)];
  return out;
}
