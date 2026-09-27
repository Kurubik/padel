import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import type { ServerMessage } from "@padel/shared";

const SERVER = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const PORT = 18900 + (process.pid % 90);
const BASE = "http://127.0.0.1:" + PORT;

function start(): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
    let done = false;
    const timer = setTimeout(() => { if (!done) reject(new Error("no start")); }, 8000);
    child.stdout?.on("data", () => { if (!done) { done = true; clearTimeout(timer); resolve(child); } });
    child.on("exit", () => { if (!done) { done = true; clearTimeout(timer); reject(new Error("exited")); } });
  });
}

function open(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket("ws://127.0.0.1:" + PORT + "/ws");
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function wait(ws: WebSocket, type: string, ms = 5000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout " + type)), ms);
    const h = (raw: Buffer) => {
      const m = JSON.parse(String(raw)) as ServerMessage;
      if (m.t === type) { clearTimeout(timer); ws.off("message", h); resolve(m); }
    };
    ws.on("message", h);
  });
}

test("four websocket clients take four distinct seats and a fifth is refused", async () => {
  const child = await start();
  try {
    const host = await open();
    host.send(JSON.stringify({ t: "hello", v: 1, name: "Host", create: true }));
    const wh = (await wait(host, "welcome")) as Extract<ServerMessage, { t: "welcome" }>;
    const guests: WebSocket[] = [];
    const seats = [wh.seat];
    for (let i = 0; i < 3; i++) {
      const ws = await open();
      guests.push(ws);
      ws.send(JSON.stringify({ t: "hello", v: 1, name: "G" + i, code: wh.code }));
      const w = (await wait(ws, "welcome")) as Extract<ServerMessage, { t: "welcome" }>;
      seats.push(w.seat);
    }
    assert.equal(new Set(seats).size, 4, "four humans must get four distinct seats, got " + JSON.stringify(seats));
    const fifth = await open();
    fifth.send(JSON.stringify({ t: "hello", v: 1, name: "TooMany", code: wh.code }));
    const err = (await wait(fifth, "error")) as Extract<ServerMessage, { t: "error" }>;
    assert.equal(err.code, "room_full");
    host.close(); guests.forEach((g) => g.close()); fifth.close();
  } finally {
    child.kill("SIGTERM");
  }
});

test("a room code from another room cannot be reused to double-book a seat", async () => {
  const child = await start();
  try {
    const a = await open();
    a.send(JSON.stringify({ t: "hello", v: 1, name: "A", create: true }));
    const wa = (await wait(a, "welcome")) as Extract<ServerMessage, { t: "welcome" }>;
    const b = await open();
    b.send(JSON.stringify({ t: "hello", v: 1, name: "B", create: true }));
    const wb = (await wait(b, "welcome")) as Extract<ServerMessage, { t: "welcome" }>;
    assert.notEqual(wa.code, wb.code, "each created room has its own code");
    assert.equal(wa.seat, 0);
    assert.equal(wb.seat, 0);
    a.close(); b.close();
  } finally {
    child.kill("SIGTERM");
  }
});
