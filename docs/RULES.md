# PADEL//CLUB — rule coverage

Our reference is the **FIP Rules of Padel** (International Padel Federation,
`padelfip.com`), which is what the plan requires us to cite. Everything below is
enforced by the single authoritative simulation in `shared/src/sim.ts` and
`shared/src/rules.ts`, exercised by the tests in `shared/test/`.

## Court model

| Element | Value used | Source |
| --- | --- | --- |
| Court | 20 m x 10 m | FIP court & equipment |
| Net | 0.88 m at the centre, 1.0 m at the posts | FIP court & equipment |
| Service line | 3 m from the net on each side (y = 7 and y = 13) | FIP court & equipment |
| Glass | 3 m high on every wall | FIP court & equipment |
| Wire mesh/fence | 3 m to 4 m above the glass | FIP court & equipment |
| Team halves | Team 0 defends y in [0,10); team 1 defends y in (10,20] | orientation choice |

The floor, side glass, side mesh, back glass, back mesh and the net are separate
collision surfaces with distinct restitution: turf 0.62, glass 0.72, mesh 0.28,
net 0.12.

## Implemented and tested

1. **Serve mechanics.** Underarm, struck at or below waist height after a bounce
   — modelled by launching the ball at z = 0.55 m and solving the arc so it still
   passes over the net and lands on the target point. The server stands **behind
   the service line**, between the centre line and the side wall
   (`serveSpot()`). The receiving target is the **diagonal service box**, i.e.
   across both the net and the centre line.
2. **Serve faults and lets.** First-serve fault → a second serve; second fault →
   **double fault**, point to the receivers. A served ball that touches the net
   and still lands in the box is a **let** and replays the same serve number. A
   serve that touches the **wire fence before the second bounce is a fault**; a
   serve that touches the side **glass** after bouncing stays in play. A serve
   that lands outside the diagonal box is `serve_out`.
3. **Bounce ordering.** A normal return must **land in the opponent court before
   touching any wall**: a wall contact with no intervening floor bounce is a
   `wall_before_bounce` fault for the striker. After a legal bounce, glass and
   mesh rebounds remain playable.
4. **Two bounces.** A second floor bounce on the same side ends the point for the
   team on that side (`double_bounce`). A ball that returns to the striker's own
   half without crossing is `own_court`.
5. **Volleys.** Playing the ball out of the air before it bounces is legal and is
   not a fault; it is only disallowed for a player whose partner has just played
   the same ball.
6. **Net cords in a rally.** A ball that clips the tape keeps travelling (heavily
   damped) and is playable if it lands in; a ball into the body of the net drops
   back on the striker's side.
7. **Scoring.** 0/15/30/40, deuce and advantage, games. A short mobile set is
   **first to 4 games** with a **7-point tie-break at 4-4** (two-point margin);
   the full format is first to 6 games with a tie-break at 6-6. Shortening the
   set only changes *how many games are played* — never the rally rules.
8. **Doubles serve rotation.** The serving team alternates every game; within a
   team the two players alternate each time that team serves, i.e. the order
   1-3-2-4 for seats 0,2,1,3.
9. **Point authorship.** Every point, fault and score change is decided by the
   single simulation. In online play only the server runs it; clients send inputs
   and render snapshots.

## Point-end reasons shown to the player

`double_bounce`, `wall_before_bounce`, `out`, `own_court`, `out_of_court`,
`net`, `double_fault`, `serve_out`, `serve_fence_fault`, `serve_net_fault`,
`not_returned` — each is surfaced on the reason card after the point.

## Honest interpretations and limits

- The court has no ceiling and no side-wall openings; a ball above 4 m that
  crosses a wall line is treated as out of court.
- A rally net cord is modelled as a damped pass-through rather than a full
  contact model; a cord that "climbs" the net and stays on the same side is
  approximated by energy loss.
- Hitting is reach-based (1.2 m, 1.34 m with contact assist), not a racket mesh.
  Contact quality affects pace and aim noise, never the legality of the point.
- `assist` widens the contact window and reduces aim noise; it never changes a
  rule decision or awards a point.
- Singles (1v1) and both drills are **practice formats** and are never labelled
  as official padel; only the 2v2 mode claims the regulation shape.
