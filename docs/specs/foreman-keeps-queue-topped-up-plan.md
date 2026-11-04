# Plan: foreman keeps its queue topped up

Date: 2026-11-04. Spec: `docs/specs/foreman-keeps-queue-topped-up.md`.

## Chosen approach

Three planners worked blind, one aiming for the smallest change, one for
robustness and one for extensibility. A judge chose the robust plan, because
it left only one edge case open where the others left three and four: it
re-arms the dry-queue notification on every path that adds a waiting
session, it decides a Release inside the same ledger write, it gives no
second top-up line to a prompt typed while a turn runs, and it guards the
`/start-foreman` skill text so the skill's "not loaded" text can never reach
the model.

The change keeps one new stored field. Everything else is worked out from the
ledger on each read or prompt.

## Steps

1. **The count.** In `hooks/act.ts`, beside `startWaits`, add
   `TOP_UP_MAX = 5` and a pure `topUpCount(t, rows, now, slots)`. Occupied
   is `(slots - freeSlots(...))` plus `waitingUnclaimed(t, now, GONE_MS)`,
   which together count claimed and reserved pairings once. The answer is
   `min(TOP_UP_MAX, max(0, 2 * slots - occupied))`.
2. **The top-up line.** In `hooks/held.ts`, add `topUpLine(n)` beside
   `heldLine`, with the number in words (export the number words from
   `wake.ts`). Grow `withHeld` in `register.tsx` so that, for a person prompt
   while foreman is on, it appends the held line and then the top-up line
   when the count is above 0. It skips the top-up line when the prompt runs
   inside a turn already running (`e.turnId` is set), and when the prompt is
   the `/start-foreman` command, checked both through `e.command` and through
   the prompt's own text.
3. **`/start-foreman` reaches the model.** In the `command.run` hook, a plain
   command or a count alone applies the command as today, then calls
   `next(e)` and returns its result with foreman's answer as the text. A
   command with words, or a refused count, keeps today's path. A new
   `skill.prompt` hook for the command answers with `startForemanText(n)`
   from `hooks/commands.ts`, computed from the live ledger: the top-up count
   and the rule that every start on this turn counts against it; with a
   count of 0, that the queue is full and nothing starts; with foreman off, a
   fixed line saying foreman could not turn on. The body is in a try/catch
   with a fixed fallback, and the hook has a `.catch`, because a failing hook
   would pass the skill's own text through.
4. **The dry-queue report.** In `hooks/wake.ts`, replace the `slot-free`
   reason and `slotWords` with `{ kind: 'queue-dry' }`, added to
   `REPORT_KINDS`, with a sentence saying that foreman's queue ran dry, a slot
   is free, and the owner's next message lines up more. In `act.ts`,
   `slotOutcome` gives a dry outcome where it gave the slot-free wake, and a
   pure `dryStep` either sets `dryNotified` and adds the report, or, when the
   flag is set, adds only a log line. `decide` clears the flag before the
   slot block when `queuedShown` is not empty, and `startSession` clears it in
   its ledger write when the start waits. `slotFreed` for Release applies the
   same step inside its `writeTickets` update.
5. **The begin text.** In `hooks/desktop.ts`, append the stale-issue sentence
   to `BEGIN_TEXT`, keeping the old text as its start and using no double
   quote, since `WAIT_LINE` quotes it.
6. **Pane and band.** In `hooks/tickets.ts`, add `queuedShown(t, now)`: the
   queue without proposal cards older than `GONE_MS` that never started.
   `View` gains the queued entries (ticket, key when it is a whole key, local
   id, wait, place) and whether a slot is free, filled in `view()` from one
   ledger read. `bandTree` draws `· N queued`, or `· queue empty` in amber
   when a slot is free and nothing waits, right after the head, counting its
   width. `paneTree` adds the Queued section after the rows, with the empty
   text from the spec. A press calls a new `openQueued`, which shares an
   `openResult` helper with `openRow` for logging and toasts.
7. **The leftover wake.** In `carryOut`, drop a stored line that is only the
   old slot-free sentence, so a reload across the upgrade does not wake the
   parent with a line no skill section answers.
8. **Skills and README.** In `skills/wake/SKILL.md`, the slot-free section
   becomes the top-up section, headed with the line's text for one issue and
   a note on the plural. It says to start held keys and named issues first,
   fill the rest by `Next issue:`, skip issues already in foreman's rows or
   queue, and start nothing when the project has no such fact. "Starting a
   session" and its rule against starting on a `foreman: ` line say that the
   top-up line and the `/start-foreman` text arrive on the owner's own typed
   turn, so the parent starts at once. The skill's description and the
   begin-text quote change too. The README gets the new texts and the band
   and pane additions. `ForemanTickets` in `types/index.d.ts` gains
   `dryNotified`.

## Test plan

- `act.test.ts`: `topUpCount` below the target, at the target, at the cap,
  and with claimed and reserved pairings counted once; `dryStep` and the
  re-arming in `decide`.
- `held.test.ts` and `register.test.ts`: the line's text and count on a typed
  prompt, and no line on a plugin prompt, a prompt inside a running turn,
  the `/start-foreman` prompt or at the target.
- `register.test.ts`, with a base `command.run` and `skill.prompt` in
  `world.ts`: a plain command calls `next`, a command with words does not,
  and the skill text, fed the real `SKILL.md` body, comes back replaced and
  without "not loaded" for counts 0 to 5, with foreman off, and when the
  ledger read throws.
- `desktop.test.ts`: `BEGIN_TEXT` starts with the old literal and holds the
  stale-issue sentence.
- `queue.test.ts`, `queued.test.ts`, `acts.test.ts`: a freed slot with an
  empty queue gives one report, no wake and one notification; a later freed
  slot gives none; a waiting start re-arms it, including one archived before
  any read; Release behaves the same. `wake.test.ts` pins the sentence and
  `REPORT_KINDS`.
- `register.test.ts`, `issue-links.test.ts`, `pane-open.test.ts`: the band's
  queue count and amber text, which test pins `freeSlots` as the source of
  the amber state, the Queued entries, order, links, waits, empty text, and
  a press opening the session.

## Rejected alternatives

- **A new `topup.ts` module (the extensible plan).** It moves code for a
  seam no current change needs; the count lives beside `freeSlots` and
  `startWaits`, which it reuses. It also re-armed only in `decide`, which
  misses a waiting session archived before any read, and put an async read
  inside the synchronous ledger update.
- **Re-arming on `queueOf` (the simplest and extensible plans).** A proposal
  card nobody started would re-arm the flag on every read and repeat the
  notification.
- **No guard for a prompt inside a running turn.** Two top-up lines on one
  turn could ask for ten starts and bring up the app's permission card.
- **A timestamp in place of the flag (the judge's own idea).** It would
  re-arm by construction, but it depends on how long released pairings keep
  their pairing time, which nothing guarantees today.

## Known narrowing

A prompt typed while a turn is running gets no top-up line; the owner's next
prompt that starts a turn tops the queue up. The final report states this.
