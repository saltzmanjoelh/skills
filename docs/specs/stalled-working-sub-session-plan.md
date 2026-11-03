# Plan: a sub session that stopped mid-turn is not left saying working

Date: 2026-11-03. Spec: `docs/specs/stalled-working-sub-session.md`.

Three planners wrote blind plans from different starting points: the
simplest change, the most robust change and the most extensible change. A
judge compared them against the spec and the owner's instructions. The most
extensible plan won, because it keeps the stall count through a failed list
read without a new ledger field, and keeps a turn's nudge flag when that
turn's look takes the memo up. A later review found that a read whose list
shows the session running must keep the stall's count too, and step 7 says
so. Its weaknesses are fixed by the grafts below.

## Chosen approach

### Foreman, in `mods/foreman/hooks/act.ts`

1. `stoppedIn(look, id)` goes beside `endedIn`. It holds when the list has
   an entry for the id that is not archived and not running.
2. `stalledShape(p, row, now)` goes beside `mayBeGone` and reads no list. It
   holds when the record says `working`, has no `backgroundOnly`, its file is
   older than `GONE_MS`, and `desktopOf(p, row)` is not null.
3. `isStalled(s)` holds when `stalledShape` holds, the step has a list, and
   `stoppedIn` holds for the pairing's desktop id. It is the one place that
   decides that a record is stalled on this read.
4. `staleStretch(stretch, mtimeMs)` holds when a stored stretch began before
   the stall: it has nudged before the file's last change, or it woke without
   nudging. A stall's own nudges always come after the file's last change,
   because a record is stalled only once its file is five minutes old, so
   this tells an old idle stretch from the stall's own from fields the ledger
   already has.
5. `stallHandled(p, row, now)` holds when `stalledShape` holds and either the
   pull request is closed, or the stretch waits on nothing, has woken the
   parent and is not a stale stretch. A closed pull request counts as handled
   because the idle rule never nudges or wakes for it, so without this a
   closed, stalled record would make every read wait on the list for good.
6. In the working rule, right after the `backgroundOnly` branch: when
   `isStalled(s)` holds, first clear a stretch that `staleStretch` marks,
   then call `idleRule(s, s.row.mtimeMs, null)` and return.
7. In the same rule's `stretch.wait === null` branch, return without
   clearing when `stalledShape` holds and `stallsOwn` holds for the stretch,
   whatever the list shows, so a failed or skipped list read, or one whose
   list shows the session running, in the middle of a stall neither nudges
   nor resets the count. Only a change to the file ends the stall's count.
8. In `goneRule`, return when `isStalled(s)` holds. When the gone wake goes
   for a record of the stall's shape whose stretch `stallsOwn` marks as the
   stall's, also mark that stretch as woken, so that `stallHandled` holds and
   the list reads fall back to once every five minutes. When the gone wake
   already went for this file, before the stall's first nudge, and the list
   again does not show the session running, mark the stretch the same way
   without a second gone reason.
9. Extract the "active owned pairing for this row" lookup from
   `slotsNeedList` into `activeOwners(t, rows)`. Add `stallsNeedList`, which
   holds when some owned row has `stalledShape`, not `stallHandled`, and a
   stretch that `stallsOwn` marks as the stall's, and make `needsList` ask for
   the list when it holds. Until the stall's first nudge, `slotsNeedList`
   already reads the list on every read while `mayBeGone` holds, so a record
   of the stall's shape that never stalls, as one missing from a list that is
   not complete or one whose pull request merged and whose session runs, is
   read no more often than on the base. In `slotsNeedList`, the
   `mayBeGone` branch becomes `mayBeGone && !stallHandled`, because the gone
   rule no longer sets `goneWokeFor` for a stalled record. `keptByUnreadList`
   gets the line "no stalled sub session was nudged".

No ledger field, record field or type changes.

### Builder, in `mods/builder/hooks/register.tsx`

1. Extract `memoFrom($, sessionId, first)` unchanged from `lookForTicket`,
   which keeps its behaviour and calls it. Both the ticket memo and the
   no-ticket memo are still built there.
2. `lookInTranscript($)` goes beside `lookForTicket`. It returns when the
   ticket is already known for this session id, or when `startStatus` takes
   up an existing memo. Otherwise it reads the transcript with
   `firstPromptOf(messages, '')`, returns when the read throws or finds no
   ticket, and otherwise calls `takeUpMemo` with `memoFrom`. It never reads
   the turn's own text and never stores the answer that there is no ticket.
3. `takeUpMemo` gets a synchronous guard after its update and before
   `adoptMemo`: when this copy already knows the ticket for this session id,
   it returns. Nothing awaits between the guard and `adoptMemo`, so two looks
   in one copy can never both adopt. The generation check against
   `loadStamp` still keeps an older copy from writing over a newer one.
4. In the `session.start` handler, keep `await startStatus($)` where it is.
   After `await update($, cwd, () => e.cwd)`, start `lookInTranscript($)`
   with a catch and do not await it, so session start never waits on the
   transcript.
5. In the `turn.start` handler, for the session's own turn, capture the turn
   number and the nudge flag. When the ticket is known, keep today's
   `void changeMemo(afterTurnStart)`. Otherwise start `lookInTranscript($)`
   without awaiting it, and when it resolves, apply `afterTurnStart` only if
   the same turn is still running. `await update($, busy, () => true)` stays
   where it is and never waits on the look.
6. `prompt.submit` keeps calling `lookForTicket` as today.

### Documentation

Update the builder README paragraph on where the ticket is looked for, and
the foreman README rows for `working` and `gone` and its paragraph on list
reads. No gate reads these files.

## Grafts

- From the simplest plan: a closed pull request counts as handled for list
  reads, so a closed, stalled record does not hold every read on the list.
  The transcript look runs after the session's `cwd` is stored, and the
  existing `startStatus` call keeps the hot-reload path unchanged.
- From the most robust plan: the synchronous guard inside `takeUpMemo`, in
  place of the winner's chain that ran one look at a time. The guard rules
  out double adoption for every caller, and without the chain a prompt never
  waits behind a slow transcript read. The session-start look is not
  awaited. Its tests for an old woken idle stretch, a file change after a
  nudge, a held transcript, a ticket line in the turn's own text, and racing
  looks are added.
- From the judge: the old woken idle stretch is detected from `lastNudgeAt`
  and `woke`, which the ledger already has, instead of a new field.

## Rejected alternatives

- A new `stalledFor` field on the stretch. It keeps the count through a
  failed list read and stops an old woken stretch from silencing a stall,
  but the first is done by the no-list guard in the working rule and the
  second by `staleStretch`, both rebuilt from the file on every read. The
  field would touch the types, the ledger reader and every test that
  compares a stretch exactly.
- Clearing the stall's stretch on a read whose list shows the session
  running. Each nudge starts a turn that the list shows running, so a nudged
  turn that changes nothing would start the count again after every nudge,
  and the parent would never be woken.
- Letting the gone rule wake once for a stalled record with a closed pull
  request. The spec says the gone rule stays quiet for a stalled record and
  that nothing comes for a closed one.
- Storing that a transcript's first message has no ticket, in the engine's
  state or as a memo. The spec says a look never stores that answer. The
  first message is kept in module memory, so the first prompt and later
  turns need not read the transcript again, but it is never stored, so a
  restart or a clear still leaves the first prompt to decide.
- A chain that runs the ticket looks one at a time. It makes a prompt wait
  behind a slow transcript read and is a promise held in memory that a clear
  or a resume must reset.
- Re-checking the guard only before `takeUpMemo`. That leaves a gap across
  `takeUpMemo`'s own update in which two looks can both adopt.

## Steps

1. Foreman tests first, in `mods/foreman/tests/act.test.ts`, and see them
   fail. Then the foreman rules. Change the three existing tests that pin a
   gone wake for a working record whose session is not running (in
   `act.test.ts` and `acts.test.ts`) to a `waiting-on-builder` record, so
   they still pin the gone rule, and add an end-to-end stalled test in
   `acts.test.ts`.
2. Builder tests next, in `mods/builder/tests/register.test.ts`, and see
   them fail. Then the builder change. Update the transcript read counts
   that rise by one now that a start with no memo reads the transcript.
3. The READMEs.
4. All four gates for both mods.

## Test plan

Foreman, through `decide`, with a list entry that is unarchived and not
running, and a working row whose `stateSince` is long before its file's
last change:

- With a five-minute idle threshold, a nudge on the first read past five
  minutes, a second nudge one threshold later, and an idle wake one
  threshold after that, with no gone reason on any read. A longer threshold
  shows the count runs from the file's last change.
- A list showing the session running, a failed list and no list give no
  nudge and no wake.
- One failed read between the first and second nudge does not move the
  second nudge.
- Reads whose list shows the session running during each nudged turn, with
  the file unchanged, do not move the second nudge or the wake, and after
  the wake the stall no longer asks for the list on every read.
- An archived entry and a complete list without the entry free the slot with
  no nudge. An incomplete list without the entry gives the gone wake. A
  record with no desktop session id is never stalled.
- A record with `backgroundOnly` behaves as today.
- An old idle stretch that already woke does not silence a stall.
- A file change after a nudge stops the nudges.
- A closed pull request gives no nudge and no gone wake, and its list reads
  fall back to once every five minutes.
- `needsList` holds on a read inside five minutes of the last list check
  while the stall has not woken the parent, including when `goneWokeFor`
  already names the file, and falls back to the five-minute limit after the
  idle wake. A record of the stall's shape that is missing from a list that
  is not complete, or whose pull request merged and whose session runs, keeps
  the five-minute limit after its first read.
- A stall that has had its first nudge and then drops out of a list that is
  not complete gets the gone wake, needs the list only once every five
  minutes after it, and gets no further nudge or wake when the list shows it
  stopped again. A stall whose gone wake went before its first nudge, and that
  drops out again after the nudge, gets no second gone wake and also falls
  back to once every five minutes.
- End to end in `acts.test.ts`: the desktop nudge is sent and no gone prompt
  comes.

Builder:

- A start with no memo and a ticketed transcript writes `idle` at once, and
  the minute's rewrite runs.
- A start with an empty transcript writes nothing and stores no memo, and
  the first prompt with a ticket still writes the file.
- A turn with no prompt, whose transcript holds a ticket, writes `working`
  and then `idle` at its end. A transcript refused at the start and readable
  at the turn is taken up at the turn.
- A refused transcript writes nothing, a ticket line in the turn's own text
  is not used, and a later prompt with a ticket writes the file.
- A held transcript read does not delay the busy flag.
- A look never writes over a newer copy's memo.
- The session-start look and the first prompt's look racing adopt once: one
  forced write and one send to the parent.
- A second turn after the ticket is known reads no transcript.
