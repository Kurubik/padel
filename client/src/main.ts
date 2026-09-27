import * as THREE from "three";
import { COURT, FULL_FORMAT, SHORT_FORMAT, Sim, WallDrill, predictBall } from "@padel/shared";
import type { Difficulty, MatchConfig, PlayerInput, PointReason, SeatInfo, ShotType, SimEvent, Snapshot } from "@padel/shared";
import "./styles.css";
import { CourtScene, type RenderState } from "./scene.ts";
import { Controls, type Basis } from "./input.ts";
import { detectLang, makeT, type Lang } from "./i18n.ts";
import { primeAudio, setSoundEnabled, sfx } from "./audio.ts";
import { NetClient } from "./net.ts";
import { LESSON_ART, LESSON_KEYS } from "./rules.ts";

type Screen = "home" | "bot" | "wall" | "online" | "rules" | "play" | "drill" | "lobby";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function button(label: string, hint?: string, cls = "cta"): HTMLButtonElement {
  const b = el("button", cls);
  b.innerHTML = "<span>" + label + "</span>" + (hint ? "<span class=\"hint\">" + hint + "</span>" : "");
  return b;
}

const CUE_KEYS: Record<string, string> = {
  "cue.moveCloser": "cue.moveCloser",
  "cue.tooClose": "cue.tooClose",
  "cue.tooHigh": "cue.tooHigh",
  "cue.glass": "cue.glass",
  "serve.diagonal": "cue.serve.diagonal",
  "cue.serve.diagonal": "cue.serve.diagonal",
  "serve.let": "cue.serve.let",
  "cue.serve.let": "cue.serve.let",
};

const FIRST_RUN_KEY = "padel.seenOnboarding";
const PREF_KEY = "padel.prefs";
const NAME_KEY = "padel.name";

type Prefs = { lang: Lang; sound: boolean; assist: boolean; difficulty: Difficulty; version: "short" | "full" };
type HudRefs = {
  scoreA: HTMLElement; scoreB: HTMLElement; gamesA: HTMLElement; gamesB: HTMLElement;
  chipA: HTMLElement; chipB: HTMLElement; banner: HTMLElement; tip: HTMLElement;
  reason: HTMLElement; meta: HTMLElement;
};

class App {
  private canvas: HTMLCanvasElement;
  private scene: CourtScene;
  private controls: Controls;
  private ui: HTMLElement;
  private lang: Lang;
  private t: (k: string) => string;
  private prefs: Prefs;
  private screen: Screen = "home";
  private hud: HudRefs | null = null;
  private sim: Sim | null = null;
  private drill: WallDrill | null = null;
  private humanIndex = 0;
  private net: NetClient | null = null;
  private snaps: Array<{ snap: Snapshot; at: number }> = [];
  private onlineSeat = 0;
  private onlineCode = "";
  private onlinePlayers: SeatInfo[] = [];
  private onlineHost = false;
  private onlineStarted = false;
  private onlineStatus = "connecting";
  private seq = 0;
  private lastInputSent = 0;
  private last = performance.now();
  private lastHudKey = "";
  private frames = 0;
  private fpsAt = performance.now();
  readonly fps = { value: 60 };
  private toastTimer = 0;
  private tipTimer = 0;
  private running = true;
  private mode: "none" | "bot" | "wall" | "serve-drill" | "online" = "none";
  private resultShown = false;
  private controlEls: { stick: HTMLElement; hitpad: HTMLElement; lob: HTMLElement };

  constructor() {
    this.canvas = document.getElementById("court") as HTMLCanvasElement;
    this.ui = document.getElementById("ui") as HTMLElement;
    this.prefs = this.loadPrefs();
    this.lang = this.prefs.lang;
    this.t = makeT(this.lang);
    this.scene = new CourtScene(this.canvas, { quality: "high" });
    const stick = el("div", "stick");
    const knob = el("div", "knob");
    stick.append(knob);
    const hitpad = el("div", "hitpad");
    const aim = el("div", "aim");
    const label = el("div", "label", this.t("hud.hit"));
    hitpad.append(aim, label);
    const lob = el("div", "lob", "<b>UP</b>LOB");
    this.controls = new Controls({ stick, knob, hitpad, aim, lob, basis: () => this.cameraBasis() });
    this.controlEls = { stick, hitpad, lob };
    window.addEventListener("resize", () => this.scene.resize());
    document.addEventListener("visibilitychange", () => { this.running = !document.hidden; this.last = performance.now(); });
    window.addEventListener("pointerdown", () => primeAudio(), { once: true });
    this.showHome();
    requestAnimationFrame((t) => this.loop(t));
  }

  private loadPrefs(): Prefs {
    const base: Prefs = { lang: detectLang(), sound: true, assist: true, difficulty: "rookie", version: "short" };
    try {
      const raw = localStorage.getItem(PREF_KEY);
      if (raw) return { ...base, ...(JSON.parse(raw) as Partial<Prefs>) };
    } catch { /* ignore */ }
    return base;
  }

  private savePrefs(): void {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(this.prefs)); } catch { /* ignore */ }
  }

  private cameraBasis(): Basis {
    const cam = this.scene.camera;
    const m = cam.matrixWorld.elements;
    const rx = m[0];
    const rz = m[2];
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const rl = Math.hypot(rx, rz) || 1;
    const fl = Math.hypot(dir.x, dir.z) || 1;
    return { right: { x: rx / rl, y: rz / rl }, fwd: { x: dir.x / fl, y: dir.z / fl } };
  }

  private clearUi(): void {
    this.ui.replaceChildren();
    this.hud = null;
  }

  private showHome(): void {
    this.mode = "none";
    this.sim = null;
    this.drill = null;
    this.scene.setAttract(true);
    this.clearUi();
    this.screen = "home";
    const wrap = el("div", "screen");
    const brand = el("div", "brand");
    brand.append(el("div", "eyebrow", "PADEL // NIGHT COURT"));
    brand.append(el("h1", undefined, "PADEL<span class=\"slash\">//</span>CLUB"));
    brand.append(el("div", "tagline", this.t("app.tagline")));
    const menu = el("div", "menu");
    const bot = button(this.t("menu.bot"), this.prefs.difficulty === "pro" ? this.t("diff.pro") : this.t("diff.rookie"), "cta primary");
    bot.onclick = () => this.showBotSetup();
    const wall = button(this.t("menu.wall"), "1 player");
    wall.onclick = () => this.showWallSetup();
    const friends = button(this.t("menu.friends"), "2-4");
    friends.onclick = () => this.startOnline(undefined, true);
    const rules = button(this.t("menu.rules"), "7");
    rules.onclick = () => this.showRules();
    const settings = el("div", "seg");
    const sound = el("button", undefined, this.t("menu.sound") + " " + (this.prefs.sound ? "ON" : "OFF"));
    sound.setAttribute("aria-pressed", String(this.prefs.sound));
    sound.onclick = () => {
      this.prefs.sound = !this.prefs.sound;
      setSoundEnabled(this.prefs.sound);
      sound.setAttribute("aria-pressed", String(this.prefs.sound));
      sound.textContent = this.t("menu.sound") + " " + (this.prefs.sound ? "ON" : "OFF");
      this.savePrefs();
    };
    const lang = el("button", undefined, this.t("menu.lang"));
    lang.onclick = () => {
      this.prefs.lang = this.lang === "en" ? "ru" : "en";
      this.lang = this.prefs.lang;
      this.t = makeT(this.lang);
      this.savePrefs();
      this.showHome();
    };
    settings.append(sound, lang);
    menu.append(bot, wall, friends, rules, settings);
    wrap.append(brand, menu);
    this.ui.append(wrap);
  }

  private showBotSetup(): void {
    this.clearUi();
    this.screen = "bot";
    const wrap = el("div", "screen plain");
    const panel = el("div", "panel");
    panel.style.margin = "auto";
    panel.append(el("h2", undefined, this.t("menu.bot")));
    panel.append(el("p", undefined, this.t("on.rule")));
    const diffSeg = el("div", "seg");
    for (const d of ["rookie", "pro"] as Difficulty[]) {
      const b = el("button", undefined, this.t("diff." + d));
      b.setAttribute("aria-pressed", String(this.prefs.difficulty === d));
      b.onclick = () => { this.prefs.difficulty = d; this.savePrefs(); this.showBotSetup(); };
      diffSeg.append(b);
    }
    const fmtSeg = el("div", "seg");
    for (const v of ["short", "full"] as const) {
      const b = el("button", undefined, v === "short" ? "Short set" : "Full set");
      b.setAttribute("aria-pressed", String(this.prefs.version === v));
      b.onclick = () => { this.prefs.version = v; this.savePrefs(); this.showBotSetup(); };
      fmtSeg.append(b);
    }
    const format = el("div", "field");
    format.append(el("label", undefined, this.t("menu.difficulty")), diffSeg);
    const fmtField = el("div", "field");
    fmtField.append(el("label", undefined, "Match length"), fmtSeg);
    const assistSeg = el("div", "seg");
    const aOn = el("button", undefined, this.t("menu.assist") + (this.prefs.assist ? " ON" : " OFF"));
    aOn.setAttribute("aria-pressed", String(this.prefs.assist));
    aOn.onclick = () => { this.prefs.assist = !this.prefs.assist; this.savePrefs(); this.showBotSetup(); };
    assistSeg.append(aOn);
    const assist = el("div", "field");
    assist.append(el("label", undefined, "Feel"), assistSeg);
    const actions = el("div", "actions");
    const play2 = button("2 v 2 match", "you + bot partner", "cta primary");
    play2.onclick = () => this.startLocal({ singles: false });
    const play1 = button("1 v 1 practice", "training format");
    play1.onclick = () => this.startLocal({ singles: true });
    const back = button(this.t("menu.back"));
    back.onclick = () => this.showHome();
    actions.append(play2, play1, back);
    panel.append(format, fmtField, assist, actions);
    wrap.append(panel);
    this.ui.append(wrap);
  }

  private showWallSetup(): void {
    this.clearUi();
    this.screen = "wall";
    const wrap = el("div", "screen plain");
    const panel = el("div", "panel");
    panel.style.margin = "auto";
    panel.append(el("h2", undefined, this.t("menu.wall")));
    panel.append(el("p", undefined, this.t("on.rule") + " " + this.t("on.serve")));
    const actions = el("div", "actions");
    const wall = button(this.t("hud.drillWall"), "count returns", "cta primary");
    wall.onclick = () => this.startDrill("wall");
    const serve = button(this.t("hud.drillServe"), "diagonal box");
    serve.onclick = () => this.startDrill("serve");
    const back = button(this.t("menu.back"));
    back.onclick = () => this.showHome();
    actions.append(wall, serve, back);
    panel.append(actions);
    wrap.append(panel);
    this.ui.append(wrap);
  }

  private showRules(): void {
    this.clearUi();
    this.screen = "rules";
    this.scene.setAttract(true);
    const wrap = el("div", "screen");
    const head = el("div");
    head.append(el("div", "eyebrow", "PADEL // RULES"));
    head.append(el("h2", undefined, this.t("rules.title")));
    const list = el("div", "panel");
    list.style.margin = "0";
    for (const lesson of LESSON_KEYS) {
      const row = el("div", "lesson");
      row.append(el("div", "art", LESSON_ART[lesson.art]));
      row.append(el("h3", undefined, this.t(lesson.title)));
      row.append(el("p", undefined, this.t(lesson.body)));
      list.append(row);
    }
    list.append(el("p", undefined, this.t("rules.source")));
    const back = button(this.t("menu.back"));
    back.onclick = () => this.showHome();
    list.append(back);
    wrap.append(head, list);
    this.ui.append(wrap);
  }

  private buildHud(): void {
    this.clearUi();
    const hud = el("div", "hud");
    const scorebar = el("div", "scorebar");
    const chipA = el("div", "chip a");
    const chipB = el("div", "chip b");
    const scoreA = el("div", "pts", "0");
    const scoreB = el("div", "pts", "0");
    const gamesA = el("div", "games", "0");
    const gamesB = el("div", "games", "0");
    chipA.append(el("div", "dot"), el("div", "name", this.t("hud.teamA")), scoreA, gamesA);
    chipB.append(el("div", "dot"), el("div", "name", this.t("hud.teamB")), scoreB, gamesB);
    scorebar.append(chipA, chipB);
    const topright = el("div", "topright");
    const soundBtn = el("button", "iconbtn", this.prefs.sound ? "SND" : "MUTE");
    soundBtn.setAttribute("aria-label", this.t("menu.sound"));
    soundBtn.onclick = () => {
      this.prefs.sound = !this.prefs.sound;
      setSoundEnabled(this.prefs.sound);
      soundBtn.textContent = this.prefs.sound ? "SND" : "MUTE";
      this.savePrefs();
    };
    const pause = el("button", "iconbtn", "||");
    pause.setAttribute("aria-label", this.t("hud.pause"));
    pause.onclick = () => this.showPause();
    topright.append(soundBtn, pause);
    const banner = el("div", "banner");
    const tip = el("div", "tip");
    const reason = el("div", "reason");
    const pads = el("div", "pads");
    pads.append(this.controlEls.stick, this.controlEls.lob, this.controlEls.hitpad);
    const meta = el("div", "toast");
    hud.append(scorebar, topright, banner, tip, reason, pads, meta);
    this.ui.append(hud);
    this.hud = { scoreA, scoreB, gamesA, gamesB, chipA, chipB, banner, tip, reason, meta };
    this.lastHudKey = "";
    this.measure();
  }

  private measure(): void {
    if (!this.hud) return;
    const rect = (n: HTMLElement): void => { void n.getBoundingClientRect(); };
    rect(this.hud.scoreA);
    rect(this.controlEls.hitpad);
  }

  private startLocal(opts: { singles: boolean }): void {
    primeAudio();
    this.mode = "bot";
    this.humanIndex = 0;
    const config: MatchConfig = this.prefs.version === "full" ? { ...FULL_FORMAT, assist: this.prefs.assist } : { ...SHORT_FORMAT, assist: this.prefs.assist };
    this.sim = new Sim({
      seed: (Date.now() ^ 0x5f3759df) >>> 0,
      config,
      singles: opts.singles,
      bots: opts.singles ? [false, true] : [false, true, true, true],
      difficulty: [this.prefs.difficulty, this.prefs.difficulty],
    });
    this.buildHud();
    this.screen = "play";
    this.scene.setAttract(false);
    this.showOnboardingOnce();
    this.tip(this.t("on.move"));
  }

  private startDrill(kind: "wall" | "serve"): void {
    primeAudio();
    this.mode = kind === "wall" ? "wall" : "serve-drill";
    this.drill = new WallDrill(kind, (Date.now() & 0xffff) >>> 0);
    this.buildHud();
    this.screen = "drill";
    this.scene.setAttract(false);
  }

  private startOnline(code: string | undefined, create: boolean): void {
    primeAudio();
    this.mode = "online";
    this.snaps = [];
    this.onlineStarted = false;
    this.net?.leave();
    this.net = null;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    this.net = new NetClient(proto + "//" + location.host + "/ws", {
      onWelcome: (info) => {
        this.onlineSeat = info.seat;
        this.onlineCode = info.code;
        this.onlinePlayers = info.players;
        this.onlineHost = info.host;
        this.onlineStarted = info.started;
        this.humanIndex = info.seat;
        this.showLobby();
      },
      onRoom: (info) => {
        this.onlineCode = info.code;
        this.onlinePlayers = info.players;
        this.onlineHost = this.onlineSeat === info.hostSeat;
        this.onlineStarted = info.started;
        if (this.screen === "lobby") this.showLobby();
      },
      onStarted: () => {
        this.onlineStarted = true;
        this.buildHud();
        this.screen = "play";
        this.scene.setAttract(false);
      },
      onSnapshot: (snap) => {
        this.snaps.push({ snap, at: performance.now() });
        if (this.snaps.length > 12) this.snaps.shift();
      },
      onEvents: (events) => this.handleEvents(events, this.teamOfSeat(this.onlineSeat)),
      onStatus: (status, detail) => {
        this.onlineStatus = status;
        if (detail && status === "error") this.toast(this.t("err.network"));
        if (this.screen === "lobby") this.showLobby();
      },
    });
    this.net.connect({ name: this.playerName(), code, create, format: this.prefs.version });
    this.showLobby();
  }

  private playerName(): string {
    try {
      const saved = localStorage.getItem(NAME_KEY);
      if (saved) return saved;
      const n = "Player" + (1 + Math.floor(Math.random() * 98));
      localStorage.setItem(NAME_KEY, n);
      return n;
    } catch { return "Player"; }
  }

  private teamOfSeat(seat: number): 0 | 1 {
    return (seat % 2) as 0 | 1;
  }

  private showLobby(): void {
    const existing = this.ui.querySelector(".lobby-panel");
    const fresh = this.screen !== "lobby" || !(existing instanceof HTMLElement);
    this.screen = "lobby";
    this.scene.setAttract(true);
    let panel: HTMLElement;
    if (fresh) {
      this.clearUi();
      const wrap = el("div", "screen plain");
      panel = el("div", "panel lobby-panel");
      panel.style.margin = "auto";
      wrap.append(panel);
      this.ui.append(wrap);
    } else {
      panel = existing as HTMLElement;
      panel.replaceChildren();
    }
    panel.append(el("h2", undefined, this.t("hud.rooms")));
    if (this.onlineCode) {
      panel.append(el("div", "eyebrow", this.t("hud.code")));
      panel.append(el("h1", undefined, this.onlineCode));
      const link = location.origin + "/?room=" + this.onlineCode;
      const copy = button(this.t("hud.copy"));
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(link); this.toast(this.t("hud.copied")); } catch { this.toast(link); }
      };
      panel.append(copy);
    }
    const list = el("div", "pillrow");
    for (const p of this.onlinePlayers) {
      const name = (p.name || "Seat " + (p.seat + 1)) + (p.connected ? "" : " (offline)");
      list.append(el("span", p.bot ? "tag" : "tag good", name));
    }
    panel.append(list);
    panel.append(el("p", undefined, this.onlineStarted ? this.t("hud.connected") : this.t("hud.waiting")));
    const actions = el("div", "actions");
    if (this.onlineHost && !this.onlineStarted) {
      const start = button(this.t("hud.start"), "2-4 humans", "cta primary");
      start.onclick = () => { primeAudio(); this.net?.start(); };
      const fill = button(this.t("hud.fillBots"));
      fill.onclick = () => this.net?.fillBots("rookie");
      actions.append(start, fill);
    }
    const leave = button(this.t("hud.quit"));
    leave.onclick = () => { this.net?.leave(); this.net = null; this.showHome(); };
    actions.append(leave);
    panel.append(actions);
    if (this.onlineStatus !== "open") panel.append(el("p", undefined, this.t("hud.reconnecting")));
  }

  private showPause(): void {
    const overlay = el("div", "overlay");
    const panel = el("div", "panel");
    panel.append(el("h2", undefined, this.t("hud.paused")));
    const actions = el("div", "actions");
    const resume = button(this.t("hud.resume"), undefined, "cta primary");
    resume.onclick = () => overlay.remove();
    const sound = button(this.t("menu.sound") + " " + (this.prefs.sound ? "ON" : "OFF"));
    sound.onclick = () => {
      this.prefs.sound = !this.prefs.sound;
      setSoundEnabled(this.prefs.sound);
      sound.textContent = this.t("menu.sound") + " " + (this.prefs.sound ? "ON" : "OFF");
      this.savePrefs();
    };
    const rules = button(this.t("rules.title"));
    rules.onclick = () => { overlay.remove(); this.showRules(); };
    const quit = button(this.t("hud.quit"));
    quit.onclick = () => { overlay.remove(); this.quitMatch(); };
    actions.append(resume, sound, rules, quit);
    panel.append(actions);
    overlay.append(panel);
    this.ui.append(overlay);
  }

  private quitMatch(): void {
    this.net?.leave();
    this.net = null;
    this.showHome();
  }

  private showOnboardingOnce(): void {
    let seen = false;
    try { seen = localStorage.getItem(FIRST_RUN_KEY) === "1"; } catch { /* ignore */ }
    if (seen) return;
    try { localStorage.setItem(FIRST_RUN_KEY, "1"); } catch { /* ignore */ }
    const overlay = el("div", "overlay");
    const panel = el("div", "panel");
    panel.append(el("h2", undefined, this.t("on.title")));
    panel.append(el("p", undefined, this.t("on.move")));
    panel.append(el("p", undefined, this.t("on.hit")));
    panel.append(el("p", undefined, this.t("on.lob")));
    panel.append(el("p", undefined, this.t("on.rule")));
    panel.append(el("p", undefined, this.t("on.serve")));
    const actions = el("div", "actions");
    const start = button(this.t("on.start"), undefined, "cta primary");
    start.onclick = () => overlay.remove();
    actions.append(start);
    panel.append(actions);
    overlay.append(panel);
    this.ui.append(overlay);
  }

  private toast(text: string, ms = 1800): void {
    if (!this.hud) return;
    this.hud.meta.textContent = text;
    this.hud.meta.classList.add("on");
    this.toastTimer = ms / 1000;
  }

  private tip(text: string, ms = 2400): void {
    if (!this.hud) return;
    this.hud.tip.textContent = text;
    this.hud.tip.classList.add("on");
    this.tipTimer = ms / 1000;
  }

  private pickShot(requested: ShotType, ball: { x: number; y: number; z: number }, bounceCount: number, playerY: number): ShotType {
    if (requested === "lob") return "lob";
    if (ball.z > 1.5) return "smash";
    if (bounceCount === 0 && Math.abs(playerY - COURT.netY) < 2.6) return "volley";
    return "drive";
  }

  private stepLocal(dt: number): void {
    const sim = this.sim!;
    const read = this.controls.read();
    const hits = this.controls.drainHits();
    const serving = sim.state.phase === "serve" && sim.state.server === this.humanIndex;
    const input: PlayerInput = { seq: ++this.seq, move: read.move };
    if (serving) {
      if (hits.length) {
        const lastHit = hits[hits.length - 1];
        input.serve = true;
        input.hit = { type: "drive", aim: lastHit.aim };
      }
    } else if (hits.length) {
      const lastHit = hits[hits.length - 1];
      const p = sim.state.players[this.humanIndex];
      input.hit = { type: this.pickShot(lastHit.type, sim.state.ball.pos, sim.state.bounce.count, p.pos.y), aim: lastHit.aim };
    }
    sim.setInput(this.humanIndex, input);
    sim.step(dt);
    this.handleEvents(sim.drainEvents(), this.teamOfSeat(this.humanIndex));
  }

  private stepDrill(dt: number): void {
    const drill = this.drill!;
    const read = this.controls.read();
    const hits = this.controls.drainHits();
    let hit: { type: ShotType; aim: { x: number; y: number } } | undefined;
    if (hits.length) {
      const lastHit = hits[hits.length - 1];
      const b = drill.state.ball;
      const nearNet = Math.abs(drill.state.player.y - COURT.netY) < 2.6;
      const type = lastHit.type === "lob" ? "lob" : b.z > 1.5 ? "smash" : nearNet && b.floorBounces === 0 ? "volley" : "drive";
      hit = { type, aim: lastHit.aim };
    }
    const events = drill.update(read.move, hit, dt);
    this.handleEvents(events, 0);
    if (this.hud) {
      const s = drill.state;
      this.hud.scoreA.textContent = String(s.streak);
      this.hud.scoreB.textContent = String(s.best);
      this.hud.chipA.querySelector(".name")!.textContent = this.t("hud.streak");
      this.hud.chipB.querySelector(".name")!.textContent = this.t("hud.best");
      this.hud.chipA.classList.remove("serving");
      this.hud.chipB.classList.remove("serving");
      if (s.messageKey && this.lastHudKey !== s.messageKey) {
        this.lastHudKey = s.messageKey;
        this.tip(this.t(s.messageKey), 1600);
      }
    }
  }

  private stepOnline(): void {
    if (!this.net) return;
    const read = this.controls.read();
    const hits = this.controls.drainHits();
    const lastSnap = this.snaps.length ? this.snaps[this.snaps.length - 1].snap : null;
    const now = performance.now();
    if (now - this.lastInputSent > 33) {
      this.lastInputSent = now;
      this.net.sendInput(++this.seq, read.move);
    }
    for (const h of hits) {
      const me = lastSnap ? lastSnap.players.find((p) => p.index === this.onlineSeat) : null;
      const ball = lastSnap ? lastSnap.ball.pos : null;
      const serving = !!lastSnap && lastSnap.phase === "serve" && lastSnap.server === this.onlineSeat;
      if (serving) {
        this.net.sendInput(++this.seq, read.move, { type: "drive", aim: h.aim }, true);
      } else if (ball && me) {
        const type = this.pickShot(h.type, ball, 1, me.pos.y);
        this.net.sendInput(++this.seq, read.move, { type, aim: h.aim });
      }
    }
  }

  private handleEvents(events: SimEvent[], myTeam: 0 | 1): void {
    for (const e of events) {
      switch (e.type) {
        case "hit":
          sfx.hit(e.quality);
          this.scene.spawnPulse(e.pos.x, e.pos.y, e.pos.z, e.quality > 0.6 ? 0xd9ff2f : 0xffb0a8);
          break;
        case "floor": sfx.bounce(e.speed); break;
        case "glass": sfx.glass(e.speed); this.scene.spawnPulse(e.pos.x, e.pos.y, e.pos.z, 0xa9c8ff); break;
        case "fence": sfx.fence(); break;
        case "net": sfx.net(); break;
        case "serve": sfx.serve(); break;
        case "let": sfx.let(); this.tip(this.t("cue.serve.let"), 1800); break;
        case "fault": sfx.fault(); if (e.serve) this.tip(this.t("cue.serve.diagonal"), 1800); break;
        case "point":
          sfx.point(e.team === myTeam);
          this.showReason(e.team, e.reason);
          if (e.team === myTeam) this.scene.spawnPulse(e.at.x, e.at.y, 0.4, 0xd9ff2f);
          break;
        case "game":
          sfx.whistle();
          this.toast((e.team === myTeam ? this.t("hud.you") : this.t("hud.team")) + " " + this.t("hud.winnerGame") + " " + e.games[0] + "-" + e.games[1], 2600);
          break;
        case "set": sfx.whistle(); break;
        case "match": this.showResult(e.team, myTeam); break;
        case "cue": if (this.tipTimer <= 0) this.tip(this.t(CUE_KEYS[e.cue] ?? e.cue), 1800); break;
      }
    }
  }

  private showReason(team: 0 | 1, reason: PointReason): void {
    if (!this.hud) return;
    const card = el("div", "card");
    card.append(el("div", "who", this.t("hud.reason") + " - " + (team === 0 ? this.t("hud.teamA") : this.t("hud.teamB"))));
    card.append(el("div", "what", (team === 0 ? this.t("hud.teamA") : this.t("hud.teamB")) + " +"));
    card.append(el("div", "why", this.t("reason." + reason)));
    this.hud.reason.replaceChildren(card);
    window.setTimeout(() => { if (this.hud) this.hud.reason.replaceChildren(); }, 2200);
  }

  private showResult(team: 0 | 1, myTeam: 0 | 1): void {
    if (this.resultShown) return;
    this.resultShown = true;
    const overlay = el("div", "overlay");
    const panel = el("div", "panel");
    panel.append(el("h2", undefined, team === myTeam ? "Victory" : "Defeat"));
    panel.append(el("p", undefined, this.t("hud.teamA") + " vs " + this.t("hud.teamB") + " - " + (team === 0 ? this.t("hud.teamA") : this.t("hud.teamB")) + " " + this.t("hud.winner")));
    const actions = el("div", "actions");
    const again = button(this.t("hud.replay"), undefined, "cta primary");
    again.onclick = () => { overlay.remove(); this.resultShown = false; this.startLocal({ singles: this.sim ? this.sim.state.players.length === 2 : false }); };
    const home = button(this.t("menu.back"));
    home.onclick = () => { overlay.remove(); this.resultShown = false; this.showHome(); };
    actions.append(again, home);
    panel.append(actions);
    overlay.append(panel);
    this.ui.append(overlay);
  }

  private localRenderState(): RenderState {
    if (this.drill) {
      const d = this.drill.state;
      return {
        ball: { x: d.ball.x, y: d.ball.y, z: d.ball.z },
        players: [{ index: 0, team: 0, pos: { x: d.player.x, y: d.player.y }, facing: d.player.facing, swing: d.player.swing, bot: false, connected: true }],
        serverIndex: -1,
        serveNumber: 1,
        phase: "rally",
        landing: predictBall({ pos: { x: d.ball.x, y: d.ball.y, z: d.ball.z }, vel: { x: d.ball.vx, y: d.ball.vy, z: d.ball.vz } }),
      };
    }
    const sim = this.sim!;
    const b = sim.state.ball;
    return {
      ball: { x: b.pos.x, y: b.pos.y, z: b.pos.z },
      players: sim.state.players.map((p) => ({ index: p.index, team: p.team, pos: { ...p.pos }, facing: p.facing, swing: p.swing, bot: p.bot, connected: p.connected })),
      serverIndex: sim.state.server,
      serveNumber: sim.state.serveNumber,
      phase: sim.state.phase,
      landing: sim.state.phase === "rally" ? predictBall(b) : null,
    };
  }

  private onlineRenderState(): RenderState | null {
    if (!this.snaps.length) return null;
    const now = performance.now() - 110;
    let a = this.snaps[0];
    let b = this.snaps[this.snaps.length - 1];
    for (let i = 0; i < this.snaps.length - 1; i++) {
      if (this.snaps[i].at <= now && this.snaps[i + 1].at >= now) { a = this.snaps[i]; b = this.snaps[i + 1]; break; }
    }
    const span = Math.max(1, b.at - a.at);
    const t = Math.max(0, Math.min(1, (now - a.at) / span));
    const lerp = (x: number, y: number): number => x + (y - x) * t;
    const sa = a.snap;
    const sb = b.snap;
    const players = sb.players.map((p) => {
      const prev = sa.players.find((q) => q.index === p.index) ?? p;
      return { index: p.index, team: p.team, pos: { x: lerp(prev.pos.x, p.pos.x), y: lerp(prev.pos.y, p.pos.y) }, facing: p.facing, swing: p.swing, bot: p.bot, connected: p.connected };
    });
    this.updateOnlineHud(sb);
    return {
      ball: { x: lerp(sa.ball.pos.x, sb.ball.pos.x), y: lerp(sa.ball.pos.y, sb.ball.pos.y), z: lerp(sa.ball.pos.z, sb.ball.pos.z) },
      players,
      serverIndex: sb.server,
      serveNumber: sb.serveNumber,
      phase: sb.phase,
      landing: sb.phase === "rally" ? predictBall(sb.ball) : null,
    };
  }

  private label(p: number, o: number): string {
    if (p >= 4 && o >= 4) return "40";
    if (p >= 4) return "AD";
    return ["0", "15", "30", "40"][Math.min(3, p)];
  }

  private updateOnlineHud(snap: Snapshot): void {
    if (!this.hud) return;
    const key = snap.score.points.join("-") + "|" + snap.score.games.join("-") + "|" + snap.serveNumber + "|" + snap.servingTeam + "|" + snap.phase;
    if (key === this.lastHudKey) return;
    this.lastHudKey = key;
    if (snap.score.tiebreak) {
      this.hud.scoreA.textContent = String(snap.score.tiebreak.points[0]);
      this.hud.scoreB.textContent = String(snap.score.tiebreak.points[1]);
    } else {
      this.hud.scoreA.textContent = this.label(snap.score.points[0], snap.score.points[1]);
      this.hud.scoreB.textContent = this.label(snap.score.points[1], snap.score.points[0]);
    }
    this.hud.gamesA.textContent = String(snap.score.games[0]);
    this.hud.gamesB.textContent = String(snap.score.games[1]);
    this.hud.chipA.classList.toggle("serving", snap.servingTeam === 0);
    this.hud.chipB.classList.toggle("serving", snap.servingTeam === 1);
    this.hud.banner.replaceChildren();
    if (snap.phase === "serve") {
      const mine = snap.server === this.onlineSeat;
      this.hud.banner.append(el("span", "pill" + (snap.serveNumber === 2 ? " second" : mine ? " serve" : ""), snap.serveNumber === 2 ? this.t("hud.serve2") : mine ? this.t("hud.letsServe") : this.t("hud.serve")));
    }
  }

  private updateLocalHud(): void {
    if (!this.hud || !this.sim) return;
    const s = this.sim.state;
    const key = s.score.points.join("-") + "|" + s.score.games.join("-") + "|" + s.serveNumber + "|" + s.servingTeam + "|" + s.phase;
    if (key === this.lastHudKey) return;
    this.lastHudKey = key;
    if (s.score.tiebreak) {
      this.hud.scoreA.textContent = String(s.score.tiebreak.points[0]);
      this.hud.scoreB.textContent = String(s.score.tiebreak.points[1]);
    } else {
      this.hud.scoreA.textContent = this.label(s.score.points[0], s.score.points[1]);
      this.hud.scoreB.textContent = this.label(s.score.points[1], s.score.points[0]);
    }
    this.hud.gamesA.textContent = String(s.score.games[0]);
    this.hud.gamesB.textContent = String(s.score.games[1]);
    this.hud.chipA.classList.toggle("serving", s.servingTeam === 0);
    this.hud.chipB.classList.toggle("serving", s.servingTeam === 1);
    this.hud.banner.replaceChildren();
    if (s.phase === "serve") {
      const mine = s.server === this.humanIndex;
      this.hud.banner.append(el("span", "pill" + (s.serveNumber === 2 ? " second" : mine ? " serve" : ""), s.serveNumber === 2 ? this.t("hud.serve2") : mine ? this.t("hud.letsServe") : this.t("hud.serve")));
    } else if (s.phase === "point" && s.pointWinner !== null) {
      this.hud.banner.append(el("span", "pill", this.t("hud.reason")));
    }
  }

  private loop(now: number): void {
    if (!this.running) { this.last = now; requestAnimationFrame((t) => this.loop(t)); return; }
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.frames++;
    if (now - this.fpsAt > 1000) { this.fps.value = this.frames * 1000 / (now - this.fpsAt); this.frames = 0; this.fpsAt = now; }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0 && this.hud) this.hud.meta.classList.remove("on"); }
    if (this.tipTimer > 0) { this.tipTimer -= dt; if (this.tipTimer <= 0 && this.hud) this.hud.tip.classList.remove("on"); }
    let state: RenderState | null = null;
    if (this.mode === "bot" && this.sim) {
      this.stepLocal(dt);
      state = this.localRenderState();
      this.updateLocalHud();
    } else if ((this.mode === "wall" || this.mode === "serve-drill") && this.drill) {
      this.stepDrill(dt);
      state = this.localRenderState();
    } else if (this.mode === "online") {
      this.stepOnline();
      state = this.onlineRenderState();
    }
    this.scene.update(dt, state);
    this.scene.render();
    requestAnimationFrame((t) => this.loop(t));
  }

  /** Exposed for browser verification. */
  debug(): { fps: number; mode: string; screen: string; ball: unknown; score: unknown; seat: number; code: string; connected: number; players: number } {
    const ball = this.sim ? this.sim.state.ball.pos : this.snaps.length ? this.snaps[this.snaps.length - 1].snap.ball.pos : null;
    const score = this.sim ? this.sim.state.score : this.snaps.length ? this.snaps[this.snaps.length - 1].snap.score : null;
    const players: Array<{ connected: boolean }> = this.sim ? this.sim.state.players : this.snaps.length ? this.snaps[this.snaps.length - 1].snap.players : [];
    return { fps: Math.round(this.fps.value), mode: this.mode, screen: this.screen, ball, score, seat: this.onlineSeat, code: this.onlineCode, connected: players.filter((p) => p.connected).length, players: players.length };
  }

  api(): { startLocal: (o: { singles: boolean }) => void; startDrill: (k: "wall" | "serve") => void; startOnline: (c: string | undefined, create: boolean) => void; showHome: () => void; showRules: () => void; prefs: Prefs; debug: () => unknown } {
    return {
      startLocal: (o) => this.startLocal(o),
      startDrill: (k) => this.startDrill(k),
      startOnline: (c, create) => this.startOnline(c, create),
      showHome: () => this.showHome(),
      showRules: () => this.showRules(),
      prefs: this.prefs,
      debug: () => this.debug(),
    };
  }
}

export function boot(): App {
  const app = new App();
  (window as unknown as { padel: unknown }).padel = app.api();
  const params = new URLSearchParams(location.search);
  const room = params.get("room");
  if (room) app.api().startOnline(room.toUpperCase(), false);
  return app;
}

boot();
