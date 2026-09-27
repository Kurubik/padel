# PADEL//CLUB — handoff

## What shipped

A playable, mobile-first browser padel game at **https://padel.xtr.sh**.

- **Client**: Vite + TypeScript + Three.js. Night-court look, procedural
  textures (no image assets), synthesised WebAudio sfx (no audio files),
  adaptive quality (auto-drops to low FX when a device holds < 40 fps),
  en/ru UI, seven illustrated rule lessons.
- **Shared simulation** (`shared/`): deterministic fixed-step 60 Hz match sim —
  court/glass/mesh/net collision surfaces, bounce ordering, serve faults and
  lets, volleys, two-bounce, deuce/advantage, tie-break, doubles serve rotation,
  two bot difficulty levels, wall and serve drills.
- **Server** (`server/`): Node + ws. Authoritative tick, 20 Hz snapshots,
  private rooms with 5-char codes and 128-bit reconnect tokens, bot takeover for
  dropped seats, rate-limited and clamped inputs, `/healthz`, static client.

## Git

- Remote: `git@github.com:Kurubik/padel.git`
- Branch: **main** (the remote had no `develop`; `git ls-remote --heads` was empty)
- Source commit at first delivery: `99ce4ca`; final commit with the
  verification fixes, tests, screenshots and this handoff follows it.

## Deploy

- Image `padel-xtr:1.0.0`, container `padel-xtr-app`, alias `padel-app` on the
  shared external network `girl-xtr_girl_edge`, **no published ports**,
  `read_only` + `cap_drop ALL` + `no-new-privileges` + `/tmp` tmpfs.
- Caddy fragment `deploy/padel.caddy` → live copy at
  `/opt/obsidian-livesync/caddy/padel.caddy` (0644). The Cloudflare allowlist was
  copied programmatically from the live `workout.caddy` sibling.
- Config validated with a one-shot `caddy:2.10.2-alpine` container on the same
  network before activating; only `girl-xtr-caddy-1` was restarted.
- DNS: `padel.xtr.sh A 89.167.56.86 proxied=true`, created from the current
  Infisical `CLOUDFLARE_API_TOKEN` (`scripts/activate-dns.mjs`); the value was
  never printed or written to disk.
- Certificate: Let's Encrypt for `padel.xtr.sh`, issued via a short DNS-only
  window (TLS-ALPN-01) and then re-proxied, because Cloudflare cannot pass a
  TLS-ALPN challenge through the proxy. `scripts/set-dns-proxy.mjs` does the flip.
- Sibling services and their data were not touched.

## Verification evidence

- `npm run typecheck` clean; `npm test` **36/36** (unit, simulation, drill and
  real-websocket integration, including "four clients take four distinct seats
  and a fifth is refused").
- `npm run build` clean (three chunk 124 KB gzip).
- Real-browser run (`scripts/verify-gates.mjs`, `scripts/verify-rooms.mjs`):
  home/rules at 320x640, 390x844 and landscape; bot 2v2 with four players; a
  scored point; wall-drill mode; two-client private room with an authoritative
  point; reconnect reclaiming the same seat; four-client room.
- Public run (`scripts/verify-public.mjs` against https://padel.xtr.sh): all 5
  steps passed with 0 console and 0 page errors — `/healthz` 200, a private room
  created over the public wss edge (code 393XL), a second browser joined on
  seat 2, the match started with 4 seats, and a point was decided by the public
  server (1-0). Report: `artifacts/public-report.json`.
- Protocol-level seat test: four websocket clients take four distinct seats and
  a fifth is refused (`server/test/seats.test.ts`).
- Screenshots: `artifacts/screenshots/`.

## Bugs found and fixed during verification

1. Player rigs were never bound to their match index, so all four rendered
   stacked at the origin (the court looked empty). Fixed in `scene.ts`.
2. The gameplay camera was too low and foreshortened; replaced with an elevated
   three-quarter framing that keeps the whole court and all four players visible.
3. Serve-drill fed the ball into the wrong service box (caught by a new unit
   test); now targets the diagonal box.
4. Winning a tie-break did not win the set (caught by a unit test); fixed.
5. The high score title overflowed at 320 px, and screens could not scroll on
   short viewports (landscape), making menu items unreachable; fixed.

## Known limitations

- Rally net cords are a damped pass-through, not a full tape model.
- No ceiling; a ball above 4 m crossing a wall line is out of court.
- Hitting is reach-based (racket surface not modelled).
- Scripted headless input under software GL is slow. The browser wall-drill
  step verified that the mode renders and accepts input; the counter itself is
  asserted by `shared/test/drill.test.ts` (the scripted taps did not always
  steer the player onto the feed ball).
- The four-client *browser* seat check reported `[0,2,1,0]` on one run because a
  guest page was read before its welcome arrived (the client's seat field
  defaults to 0). With an explicit wait for the welcome the seats are distinct;
  the protocol-level test above is the authoritative check.
- Headless software rendering runs at 7-18 fps; this is not representative of a
  phone GPU.
