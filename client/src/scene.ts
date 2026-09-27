import * as THREE from "three";
import { COURT } from "@padel/shared";
import { makeBallGlowTexture, makeCourtTexture, makeMeshTexture, makeNetTexture, makeShadowTexture } from "./textures.ts";

export type RenderPlayer = {
  index: number;
  team: 0 | 1;
  pos: { x: number; y: number };
  facing: number;
  swing: number;
  bot: boolean;
  connected: boolean;
};

export type RenderState = {
  ball: { x: number; y: number; z: number };
  players: RenderPlayer[];
  serverIndex: number;
  serveNumber: 1 | 2;
  phase: string;
  landing: { x: number; y: number } | null;
};

const INK = 0x070b14;
const CORAL = 0xff5b4d;
const ICE = 0x5aa0ff;

/** sim (x lateral, y length, z height) -> three (x, y=height, z=length). */
export const toThree = (x: number, y: number, z: number): [number, number, number] => [x, z, y];

type Rig = {
  group: THREE.Group;
  torso: THREE.Mesh;
  arm: THREE.Group;
  racket: THREE.Mesh;
  ring: THREE.Mesh;
  player: RenderPlayer | null;
};

export class CourtScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private ball: THREE.Mesh;
  private glow: THREE.Sprite;
  private shadow: THREE.Mesh;
  private landingRing: THREE.Mesh;
  private trail: THREE.Line;
  private trailPositions: THREE.BufferAttribute;
  private trailHistory: Array<{ x: number; y: number; z: number }> = [];
  private rigs: Rig[] = [];
  private pulses: Array<{ mesh: THREE.Mesh; life: number }> = [];
  private target = new THREE.Vector3(0, 0, 9);
  private lookAt = new THREE.Vector3(0, 0, 9);
  private attract = true;
  private attractT = 0;
  private reducedMotion = false;
  private frameTarget: THREE.Vector3;
  private quality: "low" | "high";
  private aspect = 1;

  constructor(canvas: HTMLCanvasElement, opts: { quality?: "low" | "high" } = {}) {
    this.quality = opts.quality ?? "high";
    this.reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality === "high", powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality === "high" ? 1.85 : 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.32;
    if (this.quality === "high") {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(INK);
    this.scene.fog = new THREE.Fog(INK, 26, 62);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.3, 140);
    this.frameTarget = new THREE.Vector3(0, 0, 9);

    this.buildLights();
    this.buildCourt();
    this.buildWalls();
    this.buildNet();

    const ballR = 0.055;
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(ballR, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0xe9ff5c, emissive: 0x9ec400, emissiveIntensity: 0.85, roughness: 0.35, metalness: 0.05 }),
    );
    this.scene.add(this.ball);

    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeBallGlowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glow.scale.setScalar(0.62);
    this.scene.add(this.glow);

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshBasicMaterial({ map: makeShadowTexture(), transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.shadow);

    this.landingRing = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.42, 40),
      new THREE.MeshBasicMaterial({ color: 0xd9ff2f, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.landingRing.rotation.x = -Math.PI / 2;
    this.landingRing.visible = false;
    this.scene.add(this.landingRing);

    const N = 26;
    const geo = new THREE.BufferGeometry();
    this.trailPositions = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
    geo.setAttribute("position", this.trailPositions);
    this.trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xd9ff2f, transparent: true, opacity: 0.5 }));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);

    for (let i = 0; i < 4; i++) this.rigs.push(this.buildPlayer(i));
    this.resize();
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0x9dc0ff, 0x0a1122, 1.05));
    const key = new THREE.DirectionalLight(0xdfeaff, 1.4);
    key.position.set(-9, 17, -6);
    if (this.quality === "high") {
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.near = 1;
      key.shadow.camera.far = 60;
      key.shadow.camera.left = -14;
      key.shadow.camera.right = 14;
      key.shadow.camera.top = 24;
      key.shadow.camera.bottom = -10;
      key.shadow.bias = -0.0012;
    }
    this.scene.add(key);
    const rimA = new THREE.SpotLight(0x6fa8ff, 34, 46, Math.PI / 4.4, 0.55, 1.6);
    rimA.position.set(-13, 15, 4);
    rimA.target.position.set(0, 0, 9);
    this.scene.add(rimA, rimA.target);
    const rimB = new THREE.SpotLight(0xff7a5c, 22, 46, Math.PI / 4.6, 0.6, 1.8);
    rimB.position.set(14, 14, 14);
    rimB.target.position.set(0, 0, 9);
    this.scene.add(rimB, rimB.target);
  }

  private buildCourt(): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(COURT.width, COURT.length),
      new THREE.MeshStandardMaterial({ map: makeCourtTexture(), roughness: 0.92, metalness: 0.02 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, COURT.length / 2);
    floor.receiveShadow = this.quality === "high";
    this.scene.add(floor);

    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(64, 84),
      new THREE.MeshStandardMaterial({ color: 0x0a1224, roughness: 1 }),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(0, -0.03, COURT.length / 2);
    this.scene.add(apron);
  }

  private buildWalls(): void {
    const glass = new THREE.MeshStandardMaterial({ color: 0xa9c8ff, transparent: true, opacity: 0.13, roughness: 0.08, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b2748, roughness: 0.55, metalness: 0.35 });
    const meshTex = makeMeshTexture();
    const fenceMat = new THREE.MeshStandardMaterial({ map: meshTex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, color: 0x8fa8d8, roughness: 0.8, depthWrite: false });

    const glassH = COURT.glassHeight;
    const fenceH = COURT.fenceTopHeight - COURT.glassHeight;

    // Side walls (x = +/-5) run the full length.
    for (const sign of [-1, 1]) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(COURT.length, glassH), glass);
      g.rotation.y = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
      g.position.set(sign * COURT.halfWidth, glassH / 2, COURT.length / 2);
      this.scene.add(g);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(COURT.length, fenceH), fenceMat.clone());
      (f.material as THREE.MeshStandardMaterial).map = meshTex.clone();
      const m = (f.material as THREE.MeshStandardMaterial).map!;
      m.repeat.set(COURT.length * 1.6, fenceH * 1.6);
      m.needsUpdate = true;
      f.rotation.y = g.rotation.y;
      f.position.set(sign * COURT.halfWidth, glassH + fenceH / 2, COURT.length / 2);
      this.scene.add(f);
    }
    // Back walls (z = 0 and z = 20).
    for (const sign of [-1, 1]) {
      const z = sign < 0 ? 0 : COURT.length;
      const g = new THREE.Mesh(new THREE.PlaneGeometry(COURT.width, glassH), glass);
      g.position.set(0, glassH / 2, z);
      this.scene.add(g);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(COURT.width, fenceH), fenceMat.clone());
      const m = (f.material as THREE.MeshStandardMaterial).map!;
      m.repeat.set(COURT.width * 1.6, fenceH * 1.6);
      m.needsUpdate = true;
      f.position.set(0, glassH + fenceH / 2, z);
      this.scene.add(f);
    }
    // Posts and skirting so the glass reads as a built box, not a floating plane.
    const postGeo = new THREE.CylinderGeometry(0.045, 0.045, COURT.fenceTopHeight, 10);
    for (const x of [-COURT.halfWidth, COURT.halfWidth]) {
      for (const z of [0, COURT.length]) {
        const p = new THREE.Mesh(postGeo, frameMat);
        p.position.set(x, COURT.fenceTopHeight / 2, z);
        p.castShadow = this.quality === "high";
        this.scene.add(p);
      }
    }
    for (const sign of [-1, 1]) {
      const skirting = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, COURT.length), frameMat);
      skirting.position.set(sign * COURT.halfWidth, 0.04, COURT.length / 2);
      this.scene.add(skirting);
    }
    for (const z of [0, COURT.length]) {
      const skirting = new THREE.Mesh(new THREE.BoxGeometry(COURT.width, 0.08, 0.06), frameMat);
      skirting.position.set(0, 0.04, z);
      this.scene.add(skirting);
    }
  }

  private buildNet(): void {
    const tex = makeNetTexture();
    tex.repeat.set(COURT.width * 1.5, 1.6);
    const netMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.2, side: THREE.DoubleSide, color: 0xe8f0ff, roughness: 0.75 });
    const net = new THREE.Mesh(new THREE.PlaneGeometry(COURT.width, COURT.netCenterHeight + 0.08), netMat);
    net.position.set(0, (COURT.netCenterHeight + 0.08) / 2, COURT.netY);
    this.scene.add(net);
    const tape = new THREE.Mesh(
      new THREE.BoxGeometry(COURT.width, COURT.netTapeHeight, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xf2f6ff, roughness: 0.6 }),
    );
    tape.position.set(0, COURT.netCenterHeight, COURT.netY);
    this.scene.add(tape);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x22335c, roughness: 0.6, metalness: 0.3 });
    for (const x of [-COURT.halfWidth, COURT.halfWidth]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, COURT.netPostHeight, 12), postMat);
      post.position.set(x, COURT.netPostHeight / 2, COURT.netY);
      this.scene.add(post);
    }
  }

  private buildPlayer(index: number): Rig {
    const group = new THREE.Group();
    group.userData.index = index;
    const color = index % 2 === 0 ? CORAL : ICE;
    const skin = new THREE.MeshStandardMaterial({ color: 0xe8c8a8, roughness: 0.65 });
    const kit = new THREE.MeshStandardMaterial({ color, roughness: 0.55, emissive: new THREE.Color(color).multiplyScalar(0.12) });
    const shorts = new THREE.MeshStandardMaterial({ color: 0x131c33, roughness: 0.8 });

    const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.42, 4, 8), shorts);
    legs.position.y = 0.42;
    legs.castShadow = this.quality === "high";
    group.add(legs);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.42, 4, 10), kit);
    torso.position.y = 1.06;
    torso.castShadow = this.quality === "high";
    group.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), skin);
    head.position.y = 1.47;
    head.castShadow = this.quality === "high";
    group.add(head);

    const arm = new THREE.Group();
    arm.position.set(0.16, 1.2, 0);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.34, 4, 8), skin);
    upper.position.y = -0.2;
    arm.add(upper);
    const racket = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.34, 0.045),
      new THREE.MeshStandardMaterial({ color: 0x101827, roughness: 0.5, metalness: 0.15 }),
    );
    racket.position.set(0, -0.44, 0.06);
    arm.add(racket);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.22, 8), new THREE.MeshStandardMaterial({ color: 0x2a3556 }));
    handle.position.set(0, -0.34, 0.03);
    arm.add(handle);
    group.add(arm);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.4, 28),
      new THREE.MeshBasicMaterial({ color: 0xd9ff2f, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    group.add(ring);

    // Bind the rig to its match index; the renderer looks players up by it.
    group.userData.index = index;
    this.scene.add(group);
    return { group, torso, arm, racket, ring, player: null };
  }

  /** Diagnostics for the browser gates: where the camera sits and where the court projects. */
  cameraInfo(): unknown {
    const p = this.camera.position;
    const dirV = new THREE.Vector3();
    this.camera.getWorldDirection(dirV);
    return {
      pos: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) },
      dir: { x: +dirV.x.toFixed(3), y: +dirV.y.toFixed(3), z: +dirV.z.toFixed(3) },
      look: { x: +this.lookAt.x.toFixed(2), y: +this.lookAt.y.toFixed(2), z: +this.lookAt.z.toFixed(2) },
      home: { x: +this.homePos.x.toFixed(2), y: +this.homePos.y.toFixed(2), z: +this.homePos.z.toFixed(2) },
      fov: this.camera.fov,
      aspect: +this.camera.aspect.toFixed(3),
      band: { ...this.band },
      near: this.project(0, 0, 0),
      mid: this.project(0, 10, 0),
      far: this.project(0, 20, 0),
      canvas: { w: this.renderer.domElement.clientWidth, h: this.renderer.domElement.clientHeight },
    };
  }

  /** Screen-space point (CSS px) for a court position — used by DOM markers if needed. */
  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    // Keep the camera matrices current: three only refreshes them inside render(),
    // so a projection between frames (HUD layout checks, DOM markers) could
    // otherwise use a stale pose.
    this.camera.updateMatrixWorld();
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    const v = new THREE.Vector3(...toThree(x, y, z)).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * rect.width, y: (-v.y * 0.5 + 0.5) * rect.height, visible: v.z < 1 };
  }

  spawnPulse(x: number, y: number, z: number, color = 0xd9ff2f): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.2, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.position.set(...toThree(x, y, z));
    mesh.rotation.x = -Math.PI / 2;
    this.scene.add(mesh);
    this.pulses.push({ mesh, life: 0.45 });
    if (this.pulses.length > 10) {
      const old = this.pulses.shift();
      if (old) {
        this.scene.remove(old.mesh);
        old.mesh.geometry.dispose();
        (old.mesh.material as THREE.Material).dispose();
      }
    }
  }

  setAttract(on: boolean): void {
    this.attract = on;
    this.attractT = 0;
  }

  setQuality(q: "low" | "high"): void {
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === "high" ? 1.85 : 1));
    this.renderer.shadowMap.enabled = q === "high";
    this.scene.traverse((o: THREE.Object3D) => {
      const anyO = o as THREE.Mesh;
      if (anyO.isMesh) anyO.castShadow = q === "high" && anyO.castShadow;
    });
  }

  resize(): void {
    const w = this.renderer.domElement.clientWidth || window.innerWidth;
    const h = this.renderer.domElement.clientHeight || window.innerHeight;
    this.aspect = w / h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = this.aspect;
    this.frame();
    this.camera.updateProjectionMatrix();
  }

  /** Vertical band (viewport-height fractions) the court must be framed inside. */
  private band = { far: 0.16, near: 0.72 };
  private safe = { far: 0.16, near: 0.72 };
  private homePos = new THREE.Vector3(0, 17, -2);
  private homeLook = new THREE.Vector3(0, 0, 8);

  /**
   * Adopt the safe band the UI reports (score bar bottom -> touch pads top) and
   * solve the camera for it. With the camera on a ground ray behind the near
   * baseline, the distance and pitch are chosen so the near baseline lands at
   * `near` and the far baseline at `far`; the whole court and the local player
   * therefore stay between the HUD and the controls at any viewport, instead of
   * relying on hand-tuned numbers per screen size.
   */
  setBand(far: number, near: number): void {
    // The UI reports the safe limits; the composition band stays inside them.
    const safeFar = Math.min(Math.max(far, 0.06), 0.42);
    const safeNear = Math.min(Math.max(near, safeFar + 0.14), 0.9);
    this.safe = { far: safeFar, near: safeNear };
    const portrait = this.aspect < 0.95;
    // Aim the court at a pleasing band; pure "fit above the pads" would push the
    // camera so far back that the court flattens into a strip.
    const wantFar = portrait ? Math.max(safeFar, 0.30) : Math.max(safeFar, 0.18);
    const wantNear = portrait ? Math.min(safeNear, 0.86) : Math.min(safeNear, 0.62);
    this.band = { far: wantFar, near: Math.max(wantNear, wantFar + 0.16) };
    this.fitCourt();
  }

  private fitCourt(): void {
    const w = this.renderer.domElement.clientWidth || window.innerWidth || 400;
    const h = this.renderer.domElement.clientHeight || window.innerHeight || 800;
    const aspect = w / h;
    const fov = aspect < 0.95 ? 52 : 46;
    const T = Math.tan((fov * Math.PI) / 360);
    const fN = this.band.near;
    const fF = this.band.far;
    const A = (fN - 0.5) * 2 * T;
    const hT = T * aspect;
    // The near corners may crop into the touch-pad zone, so fit most (not all) of
    // the court width; that buys a closer, more dramatic camera and a visible
    // far wall instead of a flat, distant view.
    const widthFit = aspect < 0.95 ? 0.82 : 0.95;
    const minXN = (COURT.halfWidth * widthFit + 0.5) / hT;
    const zc = -(minXN + 0.5);
    const xN = -zc;
    const xF = COURT.length - zc;
    const heightFor = (theta: number): number => xN * Math.tan(theta + Math.atan(A));
    const farFrac = (theta: number): number => {
      const H = heightFor(theta);
      return 0.5 + 0.5 * (Math.tan(Math.atan(H / xF) - theta) / T);
    };
    // Coarse scan then ternary refine: robust even if the curve is not monotone.
    let best = 0.6;
    let bestErr = Infinity;
    for (let i = 0; i <= 240; i++) {
      const theta = 0.06 + (i / 240) * 1.3;
      const err = Math.abs(farFrac(theta) - fF);
      if (err < bestErr) { bestErr = err; best = theta; }
    }
    let lo = Math.max(0.05, best - 0.03);
    let hi = best + 0.03;
    for (let i = 0; i < 44; i++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (Math.abs(farFrac(m1) - fF) < Math.abs(farFrac(m2) - fF)) hi = m2; else lo = m1;
    }
    const theta = (lo + hi) / 2;
    const H = heightFor(theta);
    const aimX = H / Math.tan(theta);
    this.aspect = aspect;
    this.camera.aspect = aspect;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.homePos.set(0, H, zc);
    this.homeLook.set(0, 0, zc + aimX);
    this.frameTarget.copy(this.homePos);
    this.lookAt.copy(this.homeLook);
    this.camera.position.copy(this.homePos);
    this.camera.lookAt(this.homeLook);
  }

  private frame(): void {
    this.fitCourt();
  }

  update(dt: number, state: RenderState | null): void {
    if (this.attract) {
      this.attractT += dt * 0.18;
      // Slow hero drift just above the net line: the court, glass and mesh read
      // clearly and the bot rally stays visible without stealing attention.
      const r = 8.6 + Math.sin(this.attractT * 0.6) * 1.2;
      this.camera.position.set(Math.sin(this.attractT) * r * 0.4, 5.6 + Math.sin(this.attractT * 0.8) * 0.6, -5.4 + Math.cos(this.attractT) * 1.2);
      this.lookAt.lerp(new THREE.Vector3(0, 1.0, 10.2), 0.06);
      this.camera.lookAt(this.lookAt);
    } else {
      // Ceiling-safe follow: the camera keeps the solved position and only the
      // aim drifts slightly, so the framed court band never leaves the safe area.
      this.camera.position.lerp(this.homePos, 1 - Math.pow(0.0016, dt));
      const look = this.homeLook.clone();
      if (state) {
        look.x = Math.max(-2, Math.min(2, state.ball.x)) * 0.4;
        look.z = this.homeLook.z + Math.max(-4.5, Math.min(4.5, state.ball.y - 9.5)) * 0.12;
      }
      this.lookAt.lerp(look, 1 - Math.pow(0.0025, dt));
      this.camera.lookAt(this.lookAt);
    }

    for (const pulse of this.pulses) {
      pulse.life -= dt;
      const t = Math.max(0, pulse.life / 0.45);
      pulse.mesh.scale.setScalar(1 + (1 - t) * 3.4);
      (pulse.mesh.material as THREE.MeshBasicMaterial).opacity = t * 0.85;
    }
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      if (this.pulses[i].life <= 0) {
        const p = this.pulses.splice(i, 1)[0];
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
      }
    }

    if (!state) return;
    const [bx, by, bz] = toThree(state.ball.x, state.ball.y, state.ball.z);
    this.ball.position.set(bx, by, bz);
    this.glow.position.set(bx, by, bz);
    const heightFade = Math.max(0.18, 1 - state.ball.z * 0.28);
    this.glow.scale.setScalar(0.62 * (0.85 + heightFade * 0.35));
    this.shadow.position.set(bx, 0.012, bz);
    const sh = Math.max(0.25, 1 - state.ball.z * 0.14);
    this.shadow.scale.setScalar(0.7 + sh * 0.5);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.55 * sh;

    if (!this.reducedMotion) {
      this.trailHistory.push({ x: state.ball.x, y: state.ball.y, z: state.ball.z });
      if (this.trailHistory.length > 26) this.trailHistory.shift();
      for (let i = 0; i < 26; i++) {
        const p = this.trailHistory[Math.min(i, this.trailHistory.length - 1)] ?? state.ball;
        const [tx, ty, tz] = toThree(p.x, p.y, p.z);
        this.trailPositions.setXYZ(i, tx, ty, tz);
      }
      this.trailPositions.needsUpdate = true;
    }
    this.trail.visible = !this.reducedMotion && state.phase === "rally";

    if (state.landing && state.phase === "rally") {
      this.landingRing.visible = true;
      this.landingRing.position.set(state.landing.x, 0.02, state.landing.y);
      const t = performance.now() / 380;
      (this.landingRing.material as THREE.MeshBasicMaterial).opacity = 0.32 + Math.sin(t) * 0.14;
      this.landingRing.scale.setScalar(1 + Math.sin(t * 0.8) * 0.08);
    } else {
      this.landingRing.visible = false;
    }

    for (const rig of this.rigs) {
      const p = state.players.find((q) => q.index === rig.group.userData.index);
      if (!p) continue;
      rig.player = p;
      rig.group.position.set(p.pos.x, 0, p.pos.y);
      const targetRot = -p.facing - Math.PI / 2;
      rig.group.rotation.y += (targetRot - rig.group.rotation.y) * Math.min(1, dt * 12);
      const swinging = Math.max(0, p.swing) > 0;
      const swingT = swinging ? 1 - Math.max(0, p.swing) / 0.28 : 0;
      const swingArc = swinging ? Math.sin(swingT * Math.PI) * 1.5 : 0;
      rig.arm.rotation.x += ((swinging ? -swingArc : 0) - rig.arm.rotation.x) * Math.min(1, dt * 22);
      rig.torso.rotation.y += ((swinging ? swingArc * 0.35 : 0) - rig.torso.rotation.y) * Math.min(1, dt * 16);
      const isServer = p.index === state.serverIndex && state.phase === "serve";
      const pulse = isServer ? 0.32 + Math.sin(performance.now() / 300) * 0.16 : 0;
      (rig.ring.material as THREE.MeshBasicMaterial).opacity = pulse;
      rig.ring.scale.setScalar(isServer ? 1.15 : 1);
      if (!p.connected) {
        (rig.torso.material as THREE.MeshStandardMaterial).opacity = 0.45;
        (rig.torso.material as THREE.MeshStandardMaterial).transparent = true;
      }
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.scene.traverse((o: THREE.Object3D) => {
      const anyO = o as THREE.Mesh;
      if (anyO.geometry) anyO.geometry.dispose();
      const mat = anyO.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) (mat as THREE.Material).dispose();
    });
    this.renderer.dispose();
  }
}
