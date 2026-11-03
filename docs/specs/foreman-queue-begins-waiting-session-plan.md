# Plan: foreman begins a waiting sub session instead of asking for a new issue

Date: 2026-11-02. Spec: `docs/specs/foreman-queue-begins-waiting-session.md`.

## Chosen approach

Three planners worked from different priors: the simplest change, the most
robust one, and the one easiest to extend. The judge chose the most robust
plan, with grafts from the other two. Every decision is made inside the pure
`decide` in `mods/foreman/hooks/act.ts` and written in the one ledger update
that `decideNow` in `mods/foreman/hooks/register.tsx` already makes. That means
a freed slot, the new wake and the notification mark all land with the ledger
they were decided on, and no state lives in module variables.

1. **One shared helper.** `act.ts` gains
   `ListLook = { byId: ReadonlyMap<string, Listed>; complete: boolean; known: ReadonlySet<string> | null }`,
   built once at the top of `decide`, and
   `overIn(look, id): 'archived' | 'missing' | null`. It answers `archived` when
   the entry's `isArchived` is exactly true, and `missing` only when the id is
   not null, the entry is absent, the list is complete, and `known` is null or
   holds the id. `queueStep` takes the `ListLook` and replaces its inline
   `isArchived` and `isGone` tests with `overIn`, so the two rules cannot
   drift apart. `endedIn` and the `done` rule stay as they are.
2. **A new `overRule`.** It runs in `decide`'s loop after `milestoneRule` and
   before `STATE_RULES`, for records that are not `done`. It looks up
   `desktopOf(p, row)`, the id the `done` rule and `goneRule` already use. When
   `overIn` answers, it sets the pairing's standing to `freed`, adds 1 to
   `freed`, pushes the name onto `freedBy`, and logs a line naming the issue,
   the state the file last said, and its pull request or that it had none.
   When it frees, the state rules and `goneRule` are skipped for that pairing,
   so an archived session gets no last nudge, needs-you notification, cleanup
   wake or gone wake. Milestones still run first, so a pull request that merged
   on the same read is still reported. `goneRule` is also guarded on
   `standing === 'active'`.
3. **The list is read whenever the new rule could act.** `slotsNeedList`
   today asks for the list only for a `done` record or one `mayBeGone` allows,
   which leaves out a record whose gone wake already fired or whose pull
   request merged. With no queue, such an archived record would never trigger
   a read and would hold its slot. The check becomes
   `state === 'done' || now - row.mtimeMs > GONE_MS`, rebuilt from the file's
   modification time on every read. The comment above `mayBeGone` and the
   test that pins the old gate are rewritten. The spec gains one line saying
   so.
4. **The new wake.** `wake.ts` gains the reason
   `{ kind: 'slot-kept'; whos: string[] }`, not a report kind. At the end of
   `decide`, where the slot-free reason is pushed today, foreman computes
   `waitingUnclaimed(tickets, now, GONE_MS)`. When it is empty, the slot-free
   reason goes out as today. When it is not empty and the list was read, the
   `slot-kept` reason goes out with the names that pass `isWhoName`. When the
   list was not read, nothing goes out, because the kept-slot rule and the
   failure notification already cover that read. The sentences, pinned in
   `tests/wake.test.ts`:
   - One name: "a slot is free, but foreman keeps it for ABC-2, whose waiting
     session it could not find in the desktop app's list; send that session
     foreman's begin message by hand or release the issue, and do not start a
     new issue."
   - Several names, joined with `listOf`: "a slot is free, but foreman keeps it
     for ABC-2 and ABC-3, whose waiting sessions it could not find in the
     desktop app's list; send each of those sessions foreman's begin message
     by hand or release its issue, and do not start a new issue."
   - No usable name: "a slot is free, but foreman keeps it for the issues
     waiting in its queue, whose waiting sessions it could not find in the
     desktop app's list; send each of those sessions foreman's begin message
     by hand or release its issue, and do not start a new issue."
5. **The failure notification.** The failed kind of `SessionsLook` carries a
   `reason`, which `decideNow` fills from the failure it already logs.
   `NO_ANSWER` moves from `register.tsx` into `act.ts` beside
   `CALL_TIMEOUT_MS`. `decide` keeps a reason only when it is one of
   `REASONS.notConnected`, `REASONS.listRefused`, `REASONS.listUnreadable` or
   `NO_ANSWER`, and uses `REASONS.listRefused` otherwise, so the tool's own text
   never reaches the person. On a failed read with the mark unset, `decide`
   adds a quiet `notify` effect with
   `listFailedNotice(why)` ("foreman cannot read the desktop app's list of
   sessions, so it cannot begin a waiting issue or free a finished slot until
   it can: <why>.") and sets the mark. A read that got a list clears it. An
   unread look leaves it alone. The effect is quiet because the failure line
   is already logged.
6. **Stored data.** `ForemanTickets` in `mods/foreman/types/index.d.ts` gains
   `listFailNotified: boolean`, with a comment. `TICKETS_EMPTY` sets it to
   false, and `ticketsIn` reads it as `t.listFailNotified === true`, so old or
   damaged ledgers read as false. The emptiness check in `session.start` in
   `register.tsx` also requires the mark to be false, so a hot reload whose
   ledger holds only the mark does not swap it for the stored one.
7. **Text.** `skills/wake/SKILL.md` gets a section for the new sentence: start
   no new issue, find each named waiting session by the key at the start of
   its title, send an open one foreman's begin message word for word, tell the
   person when none is found (for a proposal card, ask them to start it), and
   say that archiving a waiting session takes its issue out of the queue. The
   "one slot free" section says it comes only when no issue waits unclaimed.
   The cleanup step's reason that foreman counts an unmerged archived session
   as gone is reworded, and the gone section says it comes for a session
   listed unarchived but not running, or not proven missing. `README.md`
   updates its gone row, its slots and queue paragraphs, and its sentence list.

## Grafts

- From the simplest plan: the reason carries only the names, with no slot
  count, because the spec's sentence states none. Also from it: the explicit
  `standing === 'active'` guard on `goneRule`.
- From the extensible plan, narrowed: the over rule runs before the state
  rules, so a session already over gets no last action, but after
  `milestoneRule`, so no pull request report is lost, and only for records that
  are not `done`, so the `done` path stays as today.
- From the extensible plan: the mark in the `session.start` emptiness check,
  and the quiet notification.

## Rejected alternatives

- **Keeping `slotsNeedList` unchanged** (the simplest plan). With no queue, an
  archived sub session whose gone wake already fired would never cause a list
  read, so it would hold its slot and the parent would never hear the slot is
  free. The widened check costs about one list call every two minutes while a
  stale sub session exists, and nothing in the incident, where the queue
  already forced a read every time.
- **Replacing `endedIn` with a five-way classification and a policy set**
  (the extensible plan). It risks the mapping for `done` records, which still
  free on an incomplete list or a stopped session, and its seam prepares only
  for freeing sessions that are not running, which the spec rules out.
- **Building the notification in `decideNow`** (the simplest plan). Keeping it
  in `decide` lets every Verification bullet be a pure test.
- **Making a list complete only when every entry parsed** (proposed by the
  most robust plan). It goes beyond the spec, which defines complete as
  shorter than 100, and reverses a documented choice in `desktop.ts`. An entry
  foreman cannot parse is very unlikely to be one of its own sessions. It can
  be a follow-up if it ever matters.
- **Sharing the kept outcome with the Release path.** `slotFreed` already
  defers to a read whenever someone waits unclaimed, so the Release path never
  needs it.

## Steps

1. Add the spec line for the widened list check.
2. Write the failing tests below.
3. `act.ts`: `ListLook`, `overIn`, `queueStep` on the helper, `overRule` and the
   loop order, the `goneRule` guard, `slotsNeedList`, the wake choice,
   `NO_ANSWER`, the reason check, the mark and `listFailedNotice`.
4. `wake.ts`: the `slot-kept` reason and its words.
5. `tickets.ts` and `types/index.d.ts`: the mark.
6. `register.tsx`: pass the failure reason, import `NO_ANSWER`, the emptiness
   check.
7. The skill and the README.
8. Run all four gates for both mods, the first gate first because the types
   file changes.

## Test plan

Tests are written before the code, with the helpers in
`tests/queue.test.ts`, `tests/act.test.ts`, `tests/queued.test.ts` and
`tests/world.ts`.

- **Archived unfinished session** (`queue.test.ts`): an active `ABC-1` whose
  row says `waiting-on-builder` with no pull request, its session listed
  archived, and `ABC-2` waiting and listed. It is freed with the exact log
  line, `begins` claims `local_ft-b` for `ABC-2` in the slot `ABC-1` freed, and
  no reason goes out. A variant with a pull request logs its number. An
  archived merged `done` record logs only today's `done` line. A file that has
  already left the folder frees once. A later read frees nothing more. An
  archived idle record with a nudge due is freed with no nudge. Engine test in
  `queued.test.ts`: `queueOfTwo`, the first file rewritten to
  `waiting-on-builder` and its session archived, then the second issue begins
  and the parent gets no prompt.
- **Missing session** (`queue.test.ts`): missing from a complete list with a
  known id, it is freed. Missing from an incomplete list, with an id learned
  during the read, or with no desktop session id, it keeps its slot.
- **Not running but listed unarchived** (`act.test.ts`): standing stays
  active, the gone wake goes out, and no slot reason does.
- **List gate** (`act.test.ts`): the test that says a woken record does not
  need the list now says it does while the record is stale.
- **New wake** (`queue.test.ts`): the test near line 128 now expects
  `slot-kept` with `ABC-2`. A second read with the same state sends nothing,
  and a third whose list shows the waiting session claims the slot. Two freed
  slots with one claim and a second waiting session the list leaves out give
  `slot-kept`, and with nobody else waiting give `slot-free`. A waiting
  session whose name fails `isWhoName` gives the unnamed form. A failed read
  with someone waiting still sends nothing. The other tests that pinned the
  slot-free wake while someone waited, in `queue.test.ts` and in
  `queued.test.ts` for a young proposal card, change to the new sentence.
  `wake.test.ts` pins all three forms.
- **Notification** (`act.test.ts` for the pure part, `queued.test.ts` or
  `acts.test.ts` through `world`): a run of failed reads gives one quiet
  notify effect and sets the mark. An unread look keeps the mark. A read
  clears it, and the next failure notifies again. A reason outside the fixed
  set becomes the refused reason, and no notice contains the tool's own text.
  The engine tests cover `error`, `hang` with `NO_ANSWER`, `garbage` and
  `not-connected`, and update the tests that compare notices exactly after a
  failed list. `tickets.test.ts` checks that an old ledger and a damaged value
  read as false.
- **Gates:** all four, for both mods. They do not read the skill or the
  README, which reviewers check.
