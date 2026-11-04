# Plan: foreman's pane at a glance

Date: 2026-11-04. Spec: `docs/specs/foreman-pane-at-a-glance.md`.

## Chosen approach

The simplest plan won, with grafts from the other two. `paneTree` in
`mods/foreman/hooks/pane.tsx` is rewritten into the spec's sections. One new
pure module, `mods/foreman/hooks/glance.ts`, builds the two new drawings: the
slot lights, which are circles, and the nine-segment stage bar, which is
rectangles. Neither drawing holds any text, so no record text can reach a
drawing; every attribute is a number or a fixed class name. The words beside
the drawings (the count of busy slots, the badge, the key, the title and the
state) are ordinary `Text`, `Link` and `Button` elements. Each drawing's text
alternative is its terminal form. `hooks/art.ts` and the band are not touched.

The fold states are one `$.state` atom, `folds`, with the fields
`isLogOpen`, `isTokensOpen` and `openMenus` (status file names). It is read
through a tolerant parser that reads anything malformed as folded, and is
added to `PluginState['foreman']` in `types/index.d.ts`. `view()` reads it
only for the pane.

## Grafts

1. **Presses set a state rather than toggle** (from the most-robust plan). A
   heading or a `⋯` button sends the state opposite to the one it was drawn
   in, so a press handled twice, or a stale press from an older drawing on
   another surface, cannot undo a newer one.
2. **A report's sentences are still logged before the notification call**
   (from the most-robust plan), so the line sits in the `log` atom while the
   call waits, which can take up to 60 seconds when the surfaces read also
   waits, and a hot reload or a restart in that time loses nothing. When the
   call fails, one update of the log removes this notice's own unmarked lines
   (matched by text and by the time they were written; a line merged as
   ` (N times)` has its count lowered instead; a line already pushed out of
   the kept lines is skipped), then appends the reason line when it is the
   first for that reason in this load, then one marked line, so the `last:`
   line is the notice.
3. **One marked line for a report of several sentences** (from the
   most-robust plan): the marked line holds the joined text, which is the
   notice's text. A report whose notification went keeps one line for each
   sentence, as today.
4. **The reason line and the marked line are written in one update** (from
   the most-extensible plan), so no other line can land between them. A
   notice that is not quiet and is not a report gets the same single update:
   reason line if first, then `<text> (notification not raised: <reason>)`.
5. **Guards** (from the most-robust plan): a `try` around the ledger read in
   `view()`, so a ledger that cannot be read leaves the tiles and the merged
   count reading unknown instead of failing the pane; `nudgeRow` and
   `releaseRow` refuse a done row as they refuse a released one; the prune of
   open menus returns the same object when nothing changes and writes
   nothing then.
6. **A test that the terminal and the desktop draw the same top-level
   sections in the same order** (from the most-extensible plan), by comparing
   the child keys of `foreman-pane`.

## Rejected alternatives

- **A glance model drawn by two renderers** (most-extensible). It adds a
  layer for next iterations the spec rules out (the band stays unchanged),
  and moving `queueWords` out of `pane.tsx` would change the band's imports.
- **A new `notify` signature replacing the quiet flag** (most-extensible). It
  touches every caller, including the quiet outbox notices this change leaves
  alone.
- **Logging a report only after its notification settles** (simplest and
  most-extensible). The line would live only in a pending promise for up to
  60 seconds, which a hot reload or a restart loses.
- **Capping the lights at 40 with a `+K` mark** (most-robust). The spec asks
  for one light for each busy sub session.
- **A `<title>` holding record text in the stage drawing** (most-robust). It
  puts text in a drawing where none is needed.
- **Separate `folds.ts` and `log.ts` modules** (most-robust). They add
  structure without behavior; the pure helpers live in `glance.ts` and
  `register.tsx` beside their callers.

## State and its edge cases

- Restart: `$.state` starts empty, so everything is folded.
- Hot reload: the atom survives; a value an older build left in another shape
  reads as folded.
- A cleared session in the same process: the Log and Token details folds
  carry over, which the spec allows; open menus are filtered at draw time to
  busy cards and pruned at the next read.
- Two surfaces of one process share the folds; because presses set a state,
  neither surface can undo the other's newer press.
- Quiet outbox notices (held, begin-held, begin-failed, list-failed and
  check-failed) already log their own line in other words and are left
  unmarked.

## Steps

1. Run the first gate to generate the engine types, and confirm that `Box`
   has `borderStyle`, `borderColor` and `justifyContent`, and which theme
   color names exist (`success` for green). Without a border, a card that
   needs the person is marked by a red frame drawn in its stage drawing.
2. Write the failing tests (see the test plan) and run `claude plugin test .`
   in `mods/foreman` to see them fail for the expected reasons.
3. Add `folds` to `types/index.d.ts`, `isBusy(row)` to `hooks/subs.ts` (with
   `busyCount` using it, so the band counts as before), and `mergedOf(t)` to
   `hooks/spend.ts`.
4. Write `hooks/glance.ts`: `lightsSvg`, `stagesSvg`, the light table typed
   over every state, the parser for the folds and the prune helper.
5. Rewrite `paneTree` and its helpers in `hooks/pane.tsx`; remove `subTree`,
   `issueRow`, `spentRow`, `timeRow`, `barRow`, `barOfRow`, `stateWords`,
   `queuedSection`, `NO_SUBS`, `QUEUE_EMPTY` and `SUMMED_NOTE` where nothing
   else uses them. Keep `queuedRow` for the up-next chips.
6. In `hooks/register.tsx`: the `folds` atom; `view()` with the folds, the
   merged figures and the guarded ledger read; the presses; the done-row
   guards; the prune after each read and after each release; the `notify`
   and `showReports` log change.
7. Update `tests/world.ts` so `logLines` and `paneText` open the Log row
   first when `log-last` is drawn, and migrate the existing tests: nudge and
   release presses open `⋯` first; token and spending checks open Token
   details; the queue checks read the up-next chips; the failed-notice checks
   expect the marked form; the full pane snapshot in `issue-links.test.ts` is
   replaced by checks that no `Link` is drawn without a usable issue address
   and that the card's top row holds the link when there is one.
8. Update `mods/foreman/README.md` where it describes the pane and the log
   line for a notification that was not raised.
9. Run all four gates, then the search for issue keys from
   `.claude/rules/no-project-names.md`.

## Test plan

New engine and unit tests go in `mods/foreman/tests/glance.test.ts`, written
first, each failing on the code before this change:

1. Fresh mount: no line begins with a time of day, `log-last` reads
   `last: <newest> <time>`, no `Sub sessions spent:` line; the headings open
   and fold each row. A repeated line shows ` (2 times)` on `last:`.
2. Folds survive a second mount on the same `$.state`, and a value seeded
   with `leftInState` draws accordingly; a damaged value draws folded.
3. `nudge-<file>` and `release-<file>` are absent, present after `⋯`, absent
   after `⋯` again. A stale press of `⋯` for a file with no card changes
   nothing. A card released with its menu open, then busy again, is folded.
   A done row cannot be nudged through a stale press.
4. Slot lights for working, waiting on builder, needs you, idle, in cleanup
   and a stale file, with free rings, on the desktop (classes in the drawing)
   and the terminal (`●` and `○` with colors); three busy and one slot draws
   three lights and no ring.
5. The badge reads `N queued`, `queue empty` in the warning color, or
   nothing.
6. A card that needs the person has the red border on the desktop, `!` on
   the terminal, and its current segment in red.
7. Released and done rows draw a compact line with an open button and no
   `⋯`.
8. `mergedOf` counts only entries with a merge time, averages over known
   costs, gives `cost unknown` when none is known, ignores the earlier total;
   an engine test checks the tile; a ledger that cannot be read shows
   unknown.
9. In `tests/reports.test.ts`: a failed report leaves the reason line and
   then one marked line, in that order, and the newest line is the marked
   one; a second failed report with the same reason adds exactly one line; a
   report of two sentences that fails leaves one marked line. The checks in
   `tests/acts.test.ts` for failed notices expect the marked form.
10. The empty parent pane shows the lights, `Up next: nothing queued`, the
    tiles and both headings, and not the line about the status folder.
11. The terminal and the desktop draw the same top-level section keys in the
    same order.
12. A record whose title holds `<`, `&` and quotes leaves no record text in
    any drawing, and every attribute in every drawing is a number, the SVG
    namespace or a fixed class name.
13. The four gates in the project's `CLAUDE.md` pass.
