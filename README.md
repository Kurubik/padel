# PADEL//CLUB

A playable, mobile-first padel game in the browser. Three.js on the client, one
authoritative fixed-step simulation shared by offline and online play, and a
small Node WebSocket server for private 2-4 player doubles rooms.

Public target: **https://padel.xtr.sh**

## Quick start

```bash
npm install
npm run dev            # Vite dev server on :5173
npm run build          # production client -> client/dist
npm start              # Node server: static client + /ws + /healthz on :8080
npm test               # 31 unit + simulation + websocket tests
npm run typecheck      # tsc --noEmit
npm run gate           # typecheck + tests + build
```

Node 22.6+ is required because the server runs TypeScript directly through
Node's native type stripping (no build step, no runtime dependencies beyond
`ws`). The client bundle is the only build artifact.

## Game modes

| Mode | What it is | Honest label |
| --- | --- | --- |
| **Play vs Bot - 2v2** | You + a bot partner against two bots | regulation-shaped doubles |
| **Play vs Bot - 1v1** | You against one bot | 1v1 practice (not official padel) |
| **Wall Practice - wall drill** | Feed balls, return them into your own wall/glass, keep the streak alive | training drill |
| **Wall Practice - serve drill** | Repeated serves into the diagonal box | training drill |
| **Play with Friends** | Private room, code or link, 2-4 humans, empty seats filled with bots | regulation-shaped doubles |

Two bot levels: **Rookie** and **Pro** (`shared/src/bot.ts`). They differ in
speed, reaction latency, aim error, shot selection and miss chance; both are
clamped to a finite movement speed so neither can teleport or react instantly.

## Controls

- **Left thumb stick**: move around your own half.
- **Right thumb pad**: tap to swing. Drag while touching to aim at a spot on the
  court. The swing resolves to a drive, a volley (out of the air near the net) or
  a smash (when the ball is high) automatically.
- **LOB button**: lifts the ball over the opponent.
- **Serving**: when the banner says *Tap to serve*, tap the pad (drag to steer
  the serve) to serve into the diagonal box.
- **Desktop**: WASD / arrows to move, Space to swing, L to lob, Enter to serve.

The stick and the aim pad are mapped through the live camera basis, so "drag
up-field" always means "toward the far end of the court".

## Architecture

```
shared/           pure, dependency-free TypeScript
  geometry.ts     court dimensions, service boxes, walls, net
  math.ts         vectors, clamping, approach
  rng.ts          seeded deterministic PRNG
  rules.ts        scoring, deuce/advantage, tie-break, serve rotation, serve solver
  sim.ts          the authoritative fixed-step simulation (ball, players, adjudication)
  bot.ts          bot policy (pure: state + predict + rng -> input)
  wall.ts         wall / serve practice drills
  protocol.ts     client <-> server message types and limits
  types.ts        match state, snapshots, events
server/           Node + ws
  rooms.ts        seats, reconnect tokens, authoritative tick, event broadcast
  index.ts        HTTP static + /healthz + /ws + room lifecycle
client/           Vite + TypeScript + Three.js
  scene.ts        court, glass, mesh, net, players, ball, camera, effects
  textures.ts     every texture is generated on a canvas at runtime
  main.ts         modes, HUD, screens, loop
  input.ts        touch + keyboard controls
  audio.ts        WebAudio synthesised sfx (no audio files ship)
  rules.ts        the seven illustrated lessons
  i18n.ts         English + Russian
docs/RULES.md     rule coverage with FIP citations and honest limitations
deploy/           Dockerfile, compose.yaml, Caddy ingress fragment
scripts/verify-browser.mjs  real-browser acceptance run
```

The same `Sim` class runs offline in the browser and online on the server. In
online play the server steps the simulation at 60 Hz, broadcasts snapshots at
20 Hz and owns every point; clients only send inputs and interpolate snapshots
(110 ms render delay).

### Protocol and room safety

- `hello` (with `create` or a room code) → `welcome` with a seat and a random
  128-bit reconnect token, stored client-side.
- `input` messages are rate-limited (120/s) and every field is clamped.
- Room codes are 5 characters from a 32-symbol unambiguous alphabet, expire after
  30 minutes idle, and never expose privileged state.
- A dropped player keeps their seat for 60 s; after that the seat is handed to a
  bot so the match keeps flowing.
- `/healthz` returns service, protocol version, room/player counts and uptime.

## Deployment

The production image runs the Node server (static client + WebSocket) on port
8080 inside the shared edge network, with **no published ports**:

```bash
docker build -f deploy/Dockerfile -t padel-xtr:1.0.0 .
docker compose -f deploy/compose.yaml up -d
```

The shared Caddy edge proxies `https://padel.xtr.sh` to the container alias
`padel-app:8080` via the fragment in `deploy/padel.caddy`. That fragment is a
version-controlled copy of the live file `/opt/obsidian-livesync/caddy/padel.caddy`;
the Cloudflare allowlist is copied programmatically from a live sibling so the
origin cannot accept traffic that bypassed Cloudflare. Caddy reads its site
directory only at startup, so the fragment takes effect after restarting the
edge container.

**Rollback**: `docker compose -f deploy/compose.yaml down` and delete the
fragment, then restart the edge. The previous release is the previous image tag;
sibling services and their data are never touched.

## Browser support and constraints

- Targets mobile Chrome/Safari with WebGL2. Rendering DPR is capped (1.85 high /
  1.25 low) and shadows can be turned off.
- `prefers-reduced-motion` disables the ball trail and camera motion.
- No account, no payment, no third-party realtime service, no secrets in the
  client.

## Known limitations

- Rally net cords are modelled as damped pass-throughs, not a full tape model.
- No ceiling and no court openings; a ball above 4 m crossing a wall line is out.
- Hitting is reach-based, not racket-surface based; contact quality only scales
  pace and aim noise.
- Singles, wall drill and serve drill are practice formats.
- Bot "reading" of a shot is a ballistic prediction, not simulated anticipation.

See `docs/RULES.md` for the full rule-by-rule coverage and the FIP citations.
