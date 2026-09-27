# PADEL//CLUB — implementation brief

## Product goal

Create a genuinely playable, visually polished, mobile-first browser padel game at `padel.xtr.sh` using Three.js. Up to four human players can play a doubles match; empty seats can be filled with bots. A solo wall drill and bot match must also work. The court, bounce, walls, serving and point scoring should teach real padel rather than merely decorate an arcade ball game. The implementation is complete only when the public site is playable and verified, not when a landing page exists.

## Experience and visual direction

- Identity: **PADEL//CLUB**, a premium night-court sports aesthetic. Deep indigo/ink base, saturated blue court, electric yellow-green ball and restrained coral for critical feedback. Editorial typography, high-contrast score chips, crisp geometric linework, soft stadium light, subtle grain. Avoid generic dashboard cards, casino neon, stock photos, heavy bloom, tiny HUD text and default Three.js primitives presented as final art.
- First screen should immediately show an attractive live/animated court and obvious actions: Play vs Bot, Wall Practice, Play with Friends, Rules. Mobile portrait is the primary design target; desktop is supported but not the design center.
- Court and players should read clearly on a phone. Prioritize ball visibility with a contrast outline, court-ground shadow and restrained trajectory trail; glass and fence must be visually distinct. Character silhouettes/poses need enough personality to make the game feel made, not prototyped.
- Camera: elevated three-quarter view, court aligned vertically in portrait, bounded gentle follow/zoom that never hides the contact point or disorients the player. No constant camera shake. Camera/scale should be validated at 320×640, 390×844 and landscape.
- UI: safe-area aware, accessible contrast, large touch targets, compact score, clear serve/turn indicators, sound toggle, reduced-motion preference, fast first interactive screen. Rules page is predominantly diagrams/microanimations, with concise text.

## Play modes

1. **Wall Practice:** one player repeatedly hits against a wall; count controlled returns and optionally run short positioning/serve drills. This is explicitly a training mode, not an official match.
2. **Play vs Bot:** playable 1v1 training format and a regulation-shaped 2v2 format with a bot partner versus bots. Bots must move, choose shots, serve/return and exhibit at least two recognizable difficulty levels without impossible teleports or omniscience.
3. **Friends:** private room/invite code or link, 2–4 human players in two teams, unfilled positions optionally filled by bots. At least one real 2-client and one 4-client end-to-end verification. One human plus a bot partner, or two humans versus bots, must work. Disconnect/reconnect handling and clear room lifecycle are required.

For regulation claims, label only 2v2 as official-style padel. 1v1 and wall drill are modified practice formats.

## Gameplay and rules

- Use a fixed-step simulation and one authoritative match/rules state. In online play, the server owns ball state, score, valid hits and faults; clients send inputs and render/interpolate authoritative snapshots. Do not let individual clients award their own points. Favor stable, readable trajectories and controllable timing over chaotic rigid-body physics.
- Model court dimensions/lines, net, floor bounce, glass and mesh as separate collision surfaces. Enforce correct event ordering: a normal return must first land in the opponent court before its wall; a wall rebound after a valid floor bounce remains playable; a second floor bounce ends the point. Distinguish legal volleys from service return, and do not call a technical positioning mistake a rules fault.
- Serve: alternating server/receiver order in doubles, server positioned behind service line, diagonal target service box, legal low strike after a bounce, first/second serve, net/let handling and service faults, including invalid fence contact after the service bounce. Capture the exact edge-case interpretation in `docs/RULES.md`, cite the FIP Rules of Padel and test it.
- Scoring: 15/30/40, deuce/advantage, games/sets or a clearly selected short tie-break format. A short mobile match may shorten *how many* games are played, never silently change legal rally rules. Show why each point ended.
- Contact quality: distance, racket reach, timing and ball height affect shot quality. Too close/far prompts are coaching cues, **not** violations. Do not over-punish users for touch imprecision; offer an assist setting if needed while keeping rule decisions honest.
- Available shots should include normal drive, lob and volley; smash where ball height allows. Shot selection must be readable and intentional. If a feature is not genuinely implemented, omit the claim and report it rather than displaying a dead control.

## Mobile controls and coaching

- Left-thumb virtual movement stick; right-thumb contextual hit with directional aim. Lob via an explicit accessible control or an unambiguous gesture. Provide a short onboarding overlay that can be dismissed and revisited. Do not require keyboard or hover.
- Visually predict the landing/contact region without giving perfect automated play. Use discreet on-court cues for range and timing.
- Contextual coaching examples: `Move closer`, `Too close for a clean swing`, `Let it bounce off the glass`, `Serve to the diagonal box`. Rate-limit to at most one *new* live tip per rally; provide a concise reason card after the point. Tips should be optional/mutable and available in Russian UI. Never spam generic toasts.
- Rules page: a series of 5–7 illustrated lessons (court/teams; serve; bounce/volley; walls/fence; scoring; common faults; positioning), each with a diagram and one or two short sentences. Keep illustrations local and original/reproducible in code. Link a source to official FIP rules, but do not dump an entire rulebook onto the user.

## Technical architecture

- TypeScript, Vite and Three.js on the client; a small Node.js WebSocket server for private rooms and authoritative simulation. Separate rendering/UI from simulation, bot policy, room state and rule adjudication. Share typed protocol and rule definitions where practical.
- No account, payment, external real-time service or secrets in client. Room codes should be unpredictable, expire, and not leak privileged state. Validate inputs/rate-limit abuse; handle disconnects and stale clients. The server should expose a health endpoint.
- Favor lightweight procedural geometry and compact assets, cap rendering DPR on mobile and reduce quality gracefully. Avoid large unlicensed assets, copyrighted branding and large physics/UI frameworks merely for convenience.
- Provide clean README: local setup, controls, game modes, architecture, rule coverage and limitations, test/build commands, deployment/rollback and known browser constraints.

## Verification gates

1. Unit or simulation tests for service faults/lets, floor-wall event order, second bounce, valid volley, score/deuce/tie-break, doubles serving rotation and key bot decision boundaries. Tests must be meaningful, not mirrors of implementation.
2. Build and typecheck clean; no console errors or dead controls on the main flow.
3. Browser gameplay smoke: wall drill; vs bot; two independent clients joining a room and finishing points; four clients in one doubles room; reconnect/disconnect behavior. Use real browser interaction rather than API-only checks.
4. Visual review on 320×640 and 390×844 portrait and a landscape phone viewport. Save screenshots of home, live rally, result and rules. Check touch areas, overflow, readability of ball and bounce, and 3D performance. Iterate until it looks intentional and polished.
5. Deployment: inspect the live shared Caddy edge and sibling app pattern first. Deploy a project-unique service/alias with no published ports, preserve other services and data, use a fragment for the new host, validate Caddy config before activation, and verify public HTTPS/WebSocket gameplay. DNS token only from current Infisical source; do not print or commit credentials. Recheck sibling service statuses.
6. Git: push all work to `git@github.com:Kurubik/padel.git` without force. Check remote branches first; if `develop` exists integrate and push there, otherwise push the canonical branch and state which. Verify remote ref equals local HEAD.

## Delivery report

Report exact commit, pushed branch, deployed URL and release/image identifier; tested game modes and rule coverage; visual screenshots; browser/device limitations; any knowingly deferred edge cases. A functional but ugly or partially fake game is not done. If a dependency or deployment step is blocked, stop that step, preserve progress, and provide exact evidence rather than claiming success.
