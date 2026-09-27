import { PROTOCOL_VERSION } from "@padel/shared";
import type { ClientMessage, MatchConfig, SeatInfo, ServerMessage, SimEvent, Snapshot } from "@padel/shared";

export type NetHandlers = {
  onWelcome(info: { code: string; seat: number; token: string; host: boolean; players: SeatInfo[]; config: MatchConfig; started: boolean }): void;
  onRoom(info: { code: string; players: SeatInfo[]; hostSeat: number; started: boolean }): void;
  onStarted(config: MatchConfig): void;
  onSnapshot(snap: Snapshot): void;
  onEvents(events: SimEvent[]): void;
  onStatus(status: "connecting" | "open" | "closed" | "error", detail?: string): void;
};

const TOKEN_KEY = "padel.seat";

/** Thin reconnecting client for the authoritative room server. */
export class NetClient {
  private url: string;
  private ws: WebSocket | null = null;
  private handlers: NetHandlers;
  private attempts = 0;
  private closedByUser = false;
  private name = "Player";
  private code: string | null = null;
  private token: string | null = null;
  private create = false;
  private format: MatchConfig["format"] = "short";
  private queue: ClientMessage[] = [];
  private reconnectTimer: number | null = null;
  code_seen: string | null = null;
  seat: number | null = null;

  constructor(url: string, handlers: NetHandlers) {
    this.url = url;
    this.handlers = handlers;
    try {
      const saved = localStorage.getItem(TOKEN_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { code: string; token: string };
        this.code = parsed.code;
        this.token = parsed.token;
      }
    } catch { /* storage unavailable */ }
  }

  connect(opts: { name: string; code?: string; create?: boolean; format?: MatchConfig["format"] }): void {
    this.name = opts.name || "Player";
    this.create = !!opts.create;
    if (opts.code) this.code = opts.code.toUpperCase();
    else if (!this.create && !this.code) this.code = null;
    if (opts.format) this.format = opts.format;
    this.closedByUser = false;
    this.open();
  }

  private open(): void {
    this.handlers.onStatus("connecting");
    const base = this.url;
    const ws = new WebSocket(base);
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.handlers.onStatus("open");
      const hello: ClientMessage = { t: "hello", v: PROTOCOL_VERSION, name: this.name, format: this.format };
      if (this.create) hello.create = true;
      else if (this.code) hello.code = this.code;
      if (this.token && !this.create) hello.token = this.token;
      ws.send(JSON.stringify(hello));
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      switch (msg.t) {
        case "welcome":
          this.code = msg.code;
          this.seat = msg.seat;
          this.token = msg.token;
          try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ code: msg.code, token: msg.token })); } catch { /* ignore */ }
          this.handlers.onWelcome({ code: msg.code, seat: msg.seat, token: msg.token, host: msg.host, players: msg.players, config: msg.config, started: msg.started });
          break;
        case "room":
          this.handlers.onRoom({ code: msg.code, players: msg.players, hostSeat: msg.hostSeat, started: msg.started });
          break;
        case "started":
          this.handlers.onStarted(msg.config);
          break;
        case "snapshot":
          this.handlers.onSnapshot(msg.snap);
          break;
        case "events":
          this.handlers.onEvents(msg.events);
          break;
        case "error":
          if (msg.code === "no_room") { this.token = null; this.code = null; }
          this.handlers.onStatus("error", msg.message);
          break;
        case "pong":
          break;
      }
    };
    ws.onclose = () => {
      if (this.closedByUser) {
        this.handlers.onStatus("closed");
        return;
      }
      this.handlers.onStatus("closed");
      this.attempts++;
      const delay = Math.min(6000, 600 * 2 ** Math.min(4, this.attempts));
      this.reconnectTimer = window.setTimeout(() => this.open(), delay);
    };
    ws.onerror = () => this.handlers.onStatus("error", "socket error");
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (this.queue.length < 60) this.queue.push(msg);
  }

  sendInput(seq: number, move: { x: number; y: number }, hit?: { type: "drive" | "lob" | "volley" | "smash"; aim: { x: number; y: number } }, serve?: boolean): void {
    this.send({ t: "input", seq, move, hit, serve });
  }

  start(): void {
    this.send({ t: "start" });
  }

  fillBots(difficulty: "rookie" | "pro"): void {
    this.send({ t: "fillBots", difficulty });
  }

  leave(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.send({ t: "leave" });
    this.ws?.close();
    this.ws = null;
  }

  forget(): void {
    this.token = null;
    this.code = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
