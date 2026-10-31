# Plan: foreman counts a background stretch from the end of a working turn

Written 2026-10-31 for `docs/specs/foreman-counts-from-turn-end.md`, from a
tournament of three plans: the simplest change, the most robust one and the
most extensible one. A judge compared them.

## Chosen approach

The simplest plan won. It keeps all new state in two places that already
survive a restart and a hot reload: builder's status memo, and foreman's
ledger. Builder's memo gains whether the running turn of the session's own
was started by a foreman nudge, and the last such turn's end. The status
file carries the second as `lastTurn`. Foreman's stretch gains one mark,
`turnProgress`, and `idleRule` gains one restart condition.

## Grafts

- **When builder records the end (from the most robust plan).** The judge
  confirmed that the end of a turn must be in the memo before `busy` goes
  false. That change of `busy` triggers the first status write that shows
  the record back in the background-only wait. If the end were recorded
  fire-and-forget, that write could go out with the old `lastTurn`, and a
  foreman read in that moment would nudge at once, which is the defect this
  change fixes. So `turn.complete` reads the clock and awaits the memo
  change inside the block that runs only when no newer turn has started,
  checks that again after the await, and only then clears `turnRunning` and
  `busy`, back to back as today. The values read before the first await stay
  where they are.
- **A turn end in the future is ignored (from the most robust plan).** A
  stretch never moves backwards, so a damaged `endedAt` far in the future
  would otherwise put nudges off for ever. Foreman restarts only when
  `countFrom < endedAt <= now`.
- **Entity decoding (from the most robust plan, cut down).** The idle nudge
  holds an apostrophe. If the desktop app ever escaped it, no nudge would be
  recognised, and the parent would never be woken. The recogniser decodes
  only `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;` and `&apos;` in a body
  before comparing.
- **`freshStretch` (from the most extensible plan).** One helper builds a
  stretch in `act.ts`, so the new mark is set in one place rather than in
  four literals.
- **A named `LastTurn` type (from the most extensible plan).** One name in
  builder's state contract for the memo field, the status field and
  foreman's reader.

## Rejected alternatives

- Awaiting the memo change in `turn.start`, which would delay `busy` and
  change the order that the usage-limit hold tests and the handovers rely
  on. The start stays fire-and-forget; its change is queued before the end's
  awaited change, because the turn's own end waits on that later change.
- Recording the end before `next(e)`, or fire-and-forget, which keeps the
  stale write described above.
- A function for the turn-end rule shaped for a future message channel
  between the mods. The spec leaves that channel out, so a plain function in
  `act.ts` is enough.
- Foreman alone, with no builder change, which misses a long turn within one
  stage (see the spec's "Decided by the counsel").

## Accepted edge

When a newer turn starts while a compaction holds the end of the last one,
the older end is not recorded. The newer turn records its own, later end,
so the count restarts no earlier than it should.

## Steps

1. `mods/builder/types/index.d.ts`: add `ForemanNudgeText` (the two exact
   texts), `LastTurn = { endedAt: number; answeredNudge: boolean }`,
   `BuildStatus.lastTurn?: LastTurn`, and `StatusMemo.nudgeTurn: boolean`
   and `StatusMemo.lastTurn: LastTurn | null`.
2. `mods/builder/hooks/status.ts`: `NUDGES: Record<ForemanNudgeText, true>`
   and `isForemanNudge(text)`; `afterTurnStart(memo, nudged)` and
   `afterTurnEnd(memo, at)`; tolerant readers in `statusMemoIn`, following
   `backgroundWaitIn`; `newMemo` sets `false` and `null`; `recordOf` writes
   `lastTurn` after `backgroundOnly` when the memo holds one.
3. `mods/builder/hooks/register.tsx`: fold `afterTurnStart` into the change
   `turn.start` already makes; in `turn.complete`, record the end as the
   first graft says, and update the comments there.
4. `mods/foreman/hooks/desktop.ts`: type both nudge constants as
   `ForemanNudgeText`. `mods/foreman/hooks/record.ts`: validate `lastTurn`
   in `recordIn`, reading a damaged one as absent.
5. `mods/foreman/types/index.d.ts` and `mods/foreman/hooks/tickets.ts`: add
   `turnProgress` to the stretch, read as `=== true`.
   `mods/foreman/hooks/act.ts`: `freshStretch`; the working rule's progress
   restart sets the mark; `idleRule` restarts a background stretch from the
   turn's end under the spec's points 5 to 8 and the future guard.
6. Both READMEs.

## Test plan

Foreman, in `mods/foreman/tests/act.test.ts`, each timeline read once a
minute with a nudge at 5 and its short answer ending at 6:

- A turn of its own from 9 to 20 with progress at 9: nudges at 5, 25 and 30,
  the wake at 35, nothing between 20 and 25. It fails before the change.
- The same turn without progress: the same timeline.
- A nudge-started turn from 9 to 20 with progress: restarts at 20.
- Answers to nudges without progress: nudges at 5 and 10, the wake at 15.
- A record without `lastTurn`: today's timeline; the existing tests pass
  unchanged.
- A turn end at or before the stretch's start, and one in the future:
  nothing restarts.
- An older ledger without the mark reads as unmarked, and a damaged
  `lastTurn` reads as absent.

Builder, in `mods/builder/tests/status.test.ts` and `register.test.ts`:

- `isForemanNudge` accepts each nudge text in the measured shape, built
  from builder's own list, and one with an escaped apostrophe; it refuses a
  plain prompt equal to a nudge text, an element holding other text, and a
  nudge text outside the element.
- The memo reads without the new fields, or with damaged ones, as none.
- `recordOf` writes `lastTurn` only when the memo holds one.
- A nudge-started turn and a plain turn each write `lastTurn` with the
  clock's time and the right flag; an error end writes it too; a subagent's
  end writes nothing; and the first record that shows `backgroundOnly`
  after a turn already carries that turn's `lastTurn`.

Then the gates in `CLAUDE.md`.
