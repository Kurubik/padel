import { clamp } from "./math.ts";

/**
 * Court geometry in metres. Doubles court: 20m long x 10m wide.
 * Net across the middle (y = 10). Team 0 defends y -> 0, team 1 defends y -> 20.
 * Glass walls are 3m high on both back and side walls; above the glass sits a
 * wire mesh/fence that reaches 4m. Sources: FIP Rules of Padel (court and
 * equipment), see docs/RULES.md.
 */
export const COURT = {
  length: 20,
  width: 10,
  halfWidth: 5,
  halfLength: 10,
  netY: 10,
  /** Service lines sit 3m from the net on each side (y = 7 and y = 13). */
  serviceLineFromNet: 3,
  serviceLineLow: 7,
  serviceLineHigh: 13,
  /** Net height 0.88m at the centre, 1.0m at the posts. */
  netCenterHeight: 0.88,
  netPostHeight: 1.0,
  netTapeHeight: 0.08,
  /** Glass height; wire mesh continues above it up to fenceTopHeight. */
  glassHeight: 3.0,
  fenceTopHeight: 4.0,
  ballRadius: 0.032,
  playerRadius: 0.32,
  gravity: -9.81,
  /** Turf/floor restitution and tangential retention on a floor bounce. */
  floorRestitution: 0.62,
  floorFriction: 0.86,
  /** Glass is lively, the wire fence kills the ball. */
  glassRestitution: 0.72,
  glassFriction: 0.94,
  fenceRestitution: 0.28,
  fenceFriction: 0.55,
  netRestitution: 0.12,
  /** Air drag applied per second (linear damping coefficient). */
  airDrag: 0.055,
} as const;

export type Team = 0 | 1;

export const teamOfY = (y: number): Team => (y < COURT.netY ? 0 : 1);

/** The y coordinate of a team's own back wall. */
export const backWallY = (team: Team): number => (team === 0 ? 0 : COURT.length);

/** Distance from a team's back wall, decreasing as the ball approaches their net. */
export const depthFor = (y: number, team: Team): number => (team === 0 ? y : COURT.length - y);

/** Net height at a given x (centre low, posts high). */
export function netHeightAt(x: number): number {
  const t = clamp(Math.abs(x) / COURT.halfWidth, 0, 1);
  return COURT.netCenterHeight + (COURT.netPostHeight - COURT.netCenterHeight) * t * t;
}

/** Service boxes as {xMin,xMax,yMin,yMax}; side 0 = left (x<0), 1 = right (x>0). */
export type Box = { xMin: number; xMax: number; yMin: number; yMax: number };

export function serviceBoxes(team: Team): [Box, Box] {
  const yMin = team === 0 ? COURT.serviceLineLow : COURT.netY;
  const yMax = team === 0 ? COURT.netY : COURT.serviceLineHigh;
  return [
    { xMin: -COURT.halfWidth, xMax: 0, yMin, yMax },
    { xMin: 0, xMax: COURT.halfWidth, yMin, yMax },
  ];
}

/**
 * The diagonal service box that a serve from `serverX` (behind `serverTeam`'s
 * service line) must land in. It is diagonal across BOTH the net and the centre
 * line, so its x sign is opposite to the server's x.
 */
export function diagonalServeBox(serverTeam: Team, serverX: number): Box {
  const boxes = serviceBoxes(serverTeam === 0 ? 1 : 0);
  return serverX >= 0 ? boxes[0] : boxes[1];
}

export function inBox(box: Box, x: number, y: number, onLine = true): boolean {
  const eps = onLine ? 0.001 : 0;
  return x >= box.xMin - eps && x <= box.xMax + eps && y >= box.yMin - eps && y <= box.yMax + eps;
}

/** Which half (side of the centre line) an x coordinate is on: 0 = left, 1 = right. */
export const sideOfX = (x: number): 0 | 1 => (x < 0 ? 0 : 1);

export const isInsideCourt = (x: number, y: number, margin = 0): boolean =>
  x >= -COURT.halfWidth - margin && x <= COURT.halfWidth + margin && y >= -margin && y <= COURT.length + margin;

/** Clamp a player position to the playable area on their own side. */
export function clampPlayer(x: number, y: number, team: Team): { x: number; y: number } {
  const px = clamp(x, -COURT.halfWidth + COURT.playerRadius, COURT.halfWidth - COURT.playerRadius);
  const margin = COURT.playerRadius + 0.05;
  const py = team === 0
    ? clamp(y, margin, COURT.netY - margin)
    : clamp(y, COURT.netY + margin, COURT.length - margin);
  return { x: px, y: py };
}
