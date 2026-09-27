import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { PROTOCOL_VERSION, makeRoomCode, ROOM_CODE_LENGTH } from "@padel/shared";
import type { ClientMessage, ServerMessage } from "@padel/shared";
import { Room } from "./rooms.ts";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
const CLIENT_DIR = fileURLToPath(new URL("../../client/dist", import.meta.url));

const rooms = new Map<string, Room>();
const sockets = new Map<WebSocket, { code: string; seat: number }>();
const startedAt = Date.now();

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, urlPath: string): Promise<void> {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const rel = clean === "/" ? "index.html" : clean.replace(/^\/+/, "");
  const safe = normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  let file = join(CLIENT_DIR, safe);
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, "index.html");
  } catch {
    // SPA fallback.
    file = join(CLIENT_DIR, "index.html");
  }
  try {
    const body = await readFile(file);
    const ext = extname(file);
    const hashed = file.includes(`${join("assets")}`) || /-[A-Za-z0-9_]{8,}\./.test(file);
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url.startsWith("/healthz")) {
    sendJson(res, 200, {
      ok: true,
      service: "padel-club",
      protocol: PROTOCOL_VERSION,
      rooms: rooms.size,
      players: [...rooms.values()].reduce((n, r) => n + r.seats.filter((s) => s.connected).length, 0),
      uptimeMs: Date.now() - startedAt,
      startedAt,
    });
    return;
  }
  void serveStatic(req, res, url);
});

const wss = new WebSocketServer({ server, path: "/ws" });

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function roomHooks(code: string) {
  return {
    now: () => Date.now(),
    broadcast: (msg: ServerMessage) => {
      for (const [ws, link] of sockets) if (link.code === code) send(ws, msg);
    },
    sendTo: (seat: number, msg: ServerMessage) => {
      for (const [ws, link] of sockets) if (link.code === code && link.seat === seat) send(ws, msg);
    },
  };
}

function newRoomCode(): string {
  let code = makeRoomCode(Math.random);
  while (rooms.has(code)) code = makeRoomCode(Math.random);
  return code;
}

wss.on("connection", (ws) => {
  let joined = false;
  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      send(ws, { t: "error", code: "bad_json", message: "malformed message" });
      return;
    }
    if (!msg || typeof msg.t !== "string") {
      send(ws, { t: "error", code: "bad_message", message: "missing type" });
      return;
    }
    if (msg.t === "ping") {
      send(ws, { t: "pong", at: msg.at, serverTime: Date.now() });
      return;
    }
    if (msg.t === "hello") {
      if (msg.v !== PROTOCOL_VERSION) {
        send(ws, { t: "error", code: "version", message: "protocol version mismatch" });
        return;
      }
      let room: Room | undefined;
      if (msg.code) {
        const code = String(msg.code).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, ROOM_CODE_LENGTH);
        room = rooms.get(code);
        if (!room) {
          send(ws, { t: "error", code: "no_room", message: "room not found" });
          return;
        }
      } else {
        const code = newRoomCode();
        room = new Room(code, msg.format === "full" ? "full" : "short", roomHooks(code), Date.now());
        rooms.set(code, room);
      }
      const joinedSeat = room.join(String(msg.name ?? "Player"), msg.token);
      if (!joinedSeat) {
        send(ws, { t: "error", code: "room_full", message: "room is full" });
        return;
      }
      sockets.set(ws, { code: room.code, seat: joinedSeat.seat });
      joined = true;
      send(ws, room.welcome(joinedSeat.seat));
      return;
    }
    const link = sockets.get(ws);
    if (!link) {
      send(ws, { t: "error", code: "not_joined", message: "send hello first" });
      return;
    }
    const room = rooms.get(link.code);
    if (!room) return;
    switch (msg.t) {
      case "input":
        room.handleInput(link.seat, msg);
        break;
      case "start":
        if (link.seat === room.hostSeat) room.start();
        break;
      case "fillBots":
        if (link.seat === room.hostSeat) room.fillBots(msg.difficulty === "pro" ? "pro" : "rookie");
        break;
      case "leave":
        room.leave(link.seat);
        sockets.delete(ws);
        break;
    }
  });
  ws.on("close", () => {
    const link = sockets.get(ws);
    if (!link) return;
    sockets.delete(ws);
    const room = rooms.get(link.code);
    if (room) {
      if (room.started) room.disconnect(link.seat);
      else room.leave(link.seat);
    }
    void joined;
  });
});

const TICK_MS = 8;
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - last) / 1000;
  last = now;
  for (const [code, room] of rooms) {
    room.tick(dt);
    if (room.isIdle(now)) {
      rooms.delete(code);
      if (process.env.PADEL_LOG) console.log(`[room] expired ${code}`);
    }
  }
}, TICK_MS).unref?.();

server.listen(PORT, HOST, () => {
  console.log(`padel-club listening on http://${HOST}:${PORT} (ws /ws)`);
});
