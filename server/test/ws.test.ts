import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import type { ServerMessage } from "@padel/shared";

const SERVER = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const PORT = 18100 + (process.pid % 500);

function startServer(): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
    let settled = false;
    const timer = setTimeout(() => { if (!settled) reject(new Error("server did not start")); }, 8000);
    child.stdout?.on("data", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr?.on("data", (d) => process.stderr.write(String(d)));
    child.on("exit", () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error("server exited")); } });
  });
}

function client(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function next(ws: WebSocket, type: string, timeoutMs = 5000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs);
    const handler = (raw: Buffer) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      if (msg.t === type) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

test("two real websocket clients join one room, start, and receive authoritative snapshots", async () => {
  const child = await startServer();
  try {
    const health = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.json() as Promise<{ ok: boolean }>);
    assert.equal(health.ok, true);
    const a = await client();
    a.send(JSON.stringify({ t: "hello", v: 1, name: "Ana", create: true }));
    const wa = await next(a, "welcome") as Extract<ServerMessage, { t: "welcome" }>;
    assert.equal(wa.seat, 0);
    assert.ok(wa.token.length >= 16);
    const b = await client();
    b.send(JSON.stringify({ t: "hello", v: 1, name: "Bo", code: wa.code }));
    const wb = await next(b, "welcome") as Extract<ServerMessage, { t: "welcome" }>;
    assert.equal(wb.code, wa.code);
    assert.notEqual(wb.seat, wa.seat);
    a.send(JSON.stringify({ t: "start" }));
    await next(a, "started");
    a.send(JSON.stringify({ t: "input", seq: 1, move: { x: 0, y: 0 }, serve: true, hit: { type: "drive", aim: { x: 0, y: 1 } } }));
    const snap = await next(a, "snapshot") as Extract<ServerMessage, { t: "snapshot" }>;
    assert.equal(typeof snap.snap.tick, "number");
    assert.equal(snap.snap.players.length, 4);
    let sawPoint = false;
    await new Promise<void>((resolve) => {
      const handler = (raw: Buffer) => {
        const msg = JSON.parse(String(raw)) as ServerMessage;
        if (msg.t === "events" && msg.events.some((e) => e.type === "point")) { sawPoint = true; resolve(); }
      };
      a.on("message", handler);
      setTimeout(resolve, 6000);
    });
    assert.equal(sawPoint, true, "the server decides a point over the wire");
    a.close();
    b.close();
  } finally {
    child.kill("SIGTERM");
  }
});
