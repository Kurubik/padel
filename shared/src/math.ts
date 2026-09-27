// Small deterministic vector / math helpers shared by simulation, bots and renderer.
export type Vec3 = { x: number; y: number; z: number };
export type Vec2 = { x: number; y: number };

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const v2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const clone3 = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });

export const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale3 = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const len3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const len2 = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export function norm3(a: Vec3): Vec3 {
  const l = len3(a);
  return l < 1e-9 ? v3() : scale3(a, 1 / l);
}

export function norm2(a: Vec2): Vec2 {
  const l = len2(a);
  return l < 1e-9 ? v2() : { x: a.x / l, y: a.y / l };
}

export const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => v3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
export const smoothstep = (t: number): number => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

/** Rotate a 2D vector by `a` radians. */
export function rot2(v: Vec2, a: number): Vec2 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Signed angle (radians) of a 2D vector, atan2(y, x). */
export const angle2 = (v: Vec2): number => Math.atan2(v.y, v.x);

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}
