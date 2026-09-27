import type { ShotType } from "@padel/shared";

export type Basis = { right: { x: number; y: number }; fwd: { x: number; y: number } };

export type HitAction = { type: ShotType; aim: { x: number; y: number } };

/**
 * Touch + keyboard controls. The stick and the aim pad are mapped into world
 * space through the live camera basis, so "drag up-field" always means "toward
 * the far end of the court" no matter which end the player defends.
 */
export class Controls {
  private stick: HTMLElement;
  private hitpad: HTMLElement;
  private lobBtn: HTMLElement;
  private knob: HTMLElement;
  private aim: HTMLElement;
  private basis: () => Basis;
  move = { x: 0, y: 0 };
  private hits: HitAction[] = [];
  private drag = { x: 0, y: 0 };
  private stickActive = false;
  private padActive = false;
  private keys = new Set<string>();
  enabled = true;
  onServe: (() => void) | null = null;

  constructor(opts: { stick: HTMLElement; knob: HTMLElement; hitpad: HTMLElement; aim: HTMLElement; lob: HTMLElement; basis: () => Basis }) {
    this.stick = opts.stick;
    this.knob = opts.knob;
    this.hitpad = opts.hitpad;
    this.aim = opts.aim;
    this.lobBtn = opts.lob;
    this.basis = opts.basis;
    this.bindStick();
    this.bindPad();
    this.bindKeyboard();
  }

  private world(dx: number, dy: number): { x: number; y: number } {
    const b = this.basis();
    // screen +x -> camera right; screen +y -> away from camera forward.
    const x = b.right.x * dx - b.fwd.x * dy;
    const y = b.right.y * dx - b.fwd.y * dy;
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  private bindStick(): void {
    const rect = () => this.stick.getBoundingClientRect();
    const set = (ev: PointerEvent): void => {
      const r = rect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const max = r.width * 0.36;
      let dx = ev.clientX - cx;
      let dy = ev.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > max) {
        dx = (dx / len) * max;
        dy = (dy / len) * max;
      }
      this.knob.style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px))`;
      const nx = dx / max;
      const ny = dy / max;
      this.move = this.enabled ? this.world(nx, ny) : { x: 0, y: 0 };
    };
    this.stick.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      this.stickActive = true;
      this.stick.setPointerCapture(ev.pointerId);
      set(ev);
    });
    this.stick.addEventListener("pointermove", (ev) => {
      if (!this.stickActive) return;
      set(ev);
    });
    const end = (ev: PointerEvent): void => {
      if (!this.stickActive) return;
      this.stickActive = false;
      this.move = { x: 0, y: 0 };
      this.knob.style.transform = "translate(-50%, -50%)";
      try { this.stick.releasePointerCapture(ev.pointerId); } catch { /* released already */ }
    };
    this.stick.addEventListener("pointerup", end);
    this.stick.addEventListener("pointercancel", end);
  }

  private bindPad(): void {
    const rect = () => this.hitpad.getBoundingClientRect();
    const set = (ev: PointerEvent): void => {
      const r = rect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let dx = (ev.clientX - cx) / (r.width * 0.5);
      let dy = (ev.clientY - cy) / (r.height * 0.5);
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      this.drag = { x: dx, y: dy };
      const mag = Math.hypot(dx, dy);
      this.aim.style.transform = `translate(${(dx * r.width * 0.3).toFixed(1)}px, ${(dy * r.height * 0.3).toFixed(1)}px)`;
      this.hitpad.classList.toggle("dragging", mag > 0.14);
    };
    this.hitpad.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      this.padActive = true;
      this.hitpad.setPointerCapture(ev.pointerId);
      set(ev);
    });
    this.hitpad.addEventListener("pointermove", (ev) => {
      if (this.padActive) set(ev);
    });
    const end = (ev: PointerEvent): void => {
      if (!this.padActive) return;
      this.padActive = false;
      this.hitpad.classList.remove("dragging");
      this.aim.style.transform = "translate(0, 0)";
      const mag = Math.hypot(this.drag.x, this.drag.y);
      const aim = mag > 0.14 ? this.world(this.drag.x, -this.drag.y) : { x: 0, y: 0 };
      this.hits.push({ type: "drive", aim });
      this.drag = { x: 0, y: 0 };
      try { this.hitpad.releasePointerCapture(ev.pointerId); } catch { /* released already */ }
    };
    this.hitpad.addEventListener("pointerup", end);
    this.hitpad.addEventListener("pointercancel", end);
    this.lobBtn.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      this.hits.push({ type: "lob", aim: this.world(0, -0.55) });
    });
  }

  private bindKeyboard(): void {
    window.addEventListener("keydown", (ev) => {
      this.keys.add(ev.key.toLowerCase());
      if (ev.key === " ") {
        ev.preventDefault();
        this.hits.push({ type: "drive", aim: { x: 0, y: 0 } });
      }
      if (ev.key.toLowerCase() === "l") this.hits.push({ type: "lob", aim: { x: 0, y: 0 } });
      if (ev.key === "Enter") this.onServe?.();
    });
    window.addEventListener("keyup", (ev) => this.keys.delete(ev.key.toLowerCase()));
  }

  /** Keyboard movement folded in; called each frame. */
  private keyboardMove(): { x: number; y: number } {
    let dx = 0;
    let dy = 0;
    if (this.keys.has("a") || this.keys.has("arrowleft")) dx -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) dx += 1;
    if (this.keys.has("w") || this.keys.has("arrowup")) dy -= 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) dy += 1;
    if (!dx && !dy) return { x: 0, y: 0 };
    return this.world(dx, dy);
  }

  drainHits(): HitAction[] {
    const out = this.hits;
    this.hits = [];
    return out;
  }

  read(): { move: { x: number; y: number } } {
    const kb = this.keyboardMove();
    if (kb.x || kb.y) return { move: kb };
    return { move: this.move };
  }
}
