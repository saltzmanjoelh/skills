# Plan: builder records the tokens and cost its session spends, and foreman adds them up

Written 2026-10-28 for `docs/specs/session-token-cost.md`. Three planners
worked blind, from the simplest change, the most robust change and the change
easiest to extend; a judge compared them against the spec and checked their
claims against the engine's types and the code.

## Chosen approach

The simplest plan won. It satisfies every item of the spec's Behavior, Edge
cases and Verification sections with the fewest new moving parts: one state
value in builder, one store key per session, one new hook, and two new fields
in foreman's existing ledger. Its state also has the fewest edge cases on a
restart, a resumed or cleared session, a hot reload and two copies running at
once, because builder keeps only one value and rebuilds it from the store. The
other two plans keep two values in builder's state, which can disagree after a
hot reload. The simplest plan's own weaknesses are mended by the grafts below.

**Builder.**

- A new pure module, `mods/builder/hooks/usage.ts`, holds the rules, so the
  tests check them without the engine:
  - `usageIn(raw, sessionId)` reads a stored or held value. A value that is
    damaged in any part, or that is stamped with another session id, reads as
    none.
  - `emptyUsage(sessionId, now)` makes a ledger with no counts.
  - `afterStep(ledger, turnId, index, usage, now)` adds a step only when its
    `usage` is not null and its index is higher than the one remembered for its
    turn. It keeps only the newest 50 turns, ordered by when each was last
    counted. A step it does not add gives back the same object, so nothing is
    written.
  - `afterCost(ledger, usd)` leaves the ledger as it was when `usd` is not a
    finite number of zero or more. Otherwise it adds the reading in full when
    there is no earlier reading or the reading is lower than the earlier one,
    adds only the increase when it is higher, and remembers the reading. The
    same reading twice adds nothing.
  - `usageLines(usage)` gives the pane's words: one line with the four kinds
    summed over the models followed by the dollar total or the words "cost
    unknown", then one line per model with its four counts. Counts are written
    in thousands below a million and in millions above it.
- One new state key, `usage`, in builder's state contract, holds the whole
  ledger: `{ sessionId, models, usd, lastEngineUsd, turns, at }`. `models` is a
  list of `{ model, input, output, cacheRead, cacheWrite }` sorted by model
  name. `usd` is the running dollar total, or null while no reading has
  arrived. `lastEngineUsd` is the engine's last reading. `turns` is a list of
  pairs of turn id and highest counted index. The comment on the key says that
  foreman reads `sessionId`, `models` and `usd`, and that the other fields are
  builder's own bookkeeping.
- Every change to the ledger goes through `update`, which runs the change again
  when another write got in first. The main loop's steps and every subagent's
  steps therefore cannot lose each other's counts, and neither can the copies
  of the module on either side of a hot reload.
- After each change, the whole ledger is written to `$.store` under
  `usage:<sessionId>`, taking the session id from the ledger itself. Because
  the remembered turns and the totals are in that one value, a step's key and
  its addition always land together. The writes go through one chain held in a
  module variable, in the same way as foreman's `persistTickets`, and each
  write reads the newest ledger from state when its turn comes. A refused write
  is therefore repeated with the newest totals at the next step.
- A new `turn.step` hook passes the step through untouched, with
  `const r = yield* next(e)`, yields nothing of its own and returns `r`. It
  then starts the counting without waiting for it, with
  `void countStep($, r, e).catch(() => undefined)`, so a failure in the
  counting or a slow store can never hold up or change the model's response.
  The hook itself has no `.catch`, for the reason given above foreman's own
  `turn.step` hook: a hook that fails after it has yielded can let a second
  answer through.
- `countStep` seeds the state from the store when it holds no ledger for this
  session, runs `afterStep` inside `update`, and asks for a store write when
  the ledger changed. The change inside `update` prefers a ledger already held
  in state for this session over the seed, so it has no side effects when it
  runs again, and two first steps after a restart both build on the first
  one's result.
- The dollar figure is read from three places, and each passes the engine's
  `cost.usd` to `afterCost`: `session.start`, so that a resumed session whose
  engine figure starts again from zero is seen near zero; a new
  `session.measure` hook, which the engine calls after each main-thread turn
  with `cost` when it has one; and `measureContext`, which already calls
  `$.session.usage`. `UsageRead` in `hooks/context.ts` gains the optional
  `cost` field.
- `session.start` also seeds the ledger, so the pane shows the totals after a
  restart before any step, and prunes `usage:` keys whose `at` is more than
  14 days old, beside `pruneTold`.
- The existing `state.set` hook leaves out the `usage` key as it leaves out the
  memo's key, so a step never forces a status file write. The status record is
  built from the ledger whenever it is written for any other reason, and the
  minute's forced write carries it at least once a minute.
- `StatusFacts` and `recordOf` in `hooks/status.ts` gain the usage, and the
  record gets `usage: { models, usd }` when the ledger exists and leaves the
  field out otherwise. `BuildStatus.usage` is optional and `STATUS_VERSION`
  stays 1.
- The pane's `View` gains the usage, and the lines from `usageLines` are drawn
  after the context block in both branches of `paneTree`.

**Foreman.**

- A new pure module, `mods/foreman/hooks/spend.ts`, holds:
  - `usageIn(raw)`, which reads a status file's `usage` field. Every count must
    be a finite whole number of zero or more and `usd` a finite number of zero
    or more or null; anything else reads as no usage.
  - `withReadings(tickets, rows)`, which takes a reading only from a row for
    which `ownsTicket(pairing, row)` holds and whose file is the pairing's
    `ownerFile`, so a fork's file is never read. It sums the reading's models
    into one set of four counts, replaces that ticket's entry in place keeping
    the larger value in each count and in the dollars, appends an entry for a
    ticket it has not seen, and gives back the same object when nothing
    changed.
  - `folded(tickets)`, which, while the list holds more than 200 entries,
    removes the oldest entries by their place in the list whose ticket has no
    pairing and adds each into the `earlier` total. An entry whose pairing
    still exists is never folded.
  - `spentSum(tickets)`, the entries plus the `earlier` total, whose dollar
    figure is the sum of the known figures, or null when none is known.
  - `spendWords(spend)`, which says "unknown" for a missing value and never
    says $0.
- A compile-time line in `spend.ts`, in the style of `STATES_MATCH_BUILDER` in
  `hooks/record.ts`, stops the type check when the shape foreman reads differs
  from builder's.
- `ForemanTickets` gains `spent: { ticket, counts, usd }[]` and
  `earlier: { counts, usd } | null`. `TICKETS_EMPTY` and `ticketsIn` read them
  tolerantly: a `spent` that is not a list reads as empty, an entry that does
  not parse is dropped, and a bad `earlier` reads as null.
- `recordIn` in `hooks/record.ts` takes the field through `usageIn` and leaves
  it out when it does not parse.
- In `decide` in `hooks/act.ts`, the readings are taken from the joined ledger
  and the fold runs after the pairings are decided, so it sees which pairings
  were forgotten: `folded(capped({ ...withReadings(input.tickets, rows), pairings }))`.
  The readings, the forgetting and the fold therefore land in the one ledger
  write that `decideNow` already makes, and `persistTickets` already skips a
  ledger equal to the one stored, which meets "only when an entry changed".
- The emptiness check in foreman's `session.start` also requires `spent` to be
  empty and `earlier` to be null, so a hot reload with only readings held does
  not swap the newer ledger in state for the older stored one.
- Foreman's `view` reads `$.state.get({ plugin: 'builder', key: 'usage' })` and
  takes it as the parent's own spending only when its `sessionId` is this
  session's id, and as unknown otherwise. Its manifest already names builder
  under `dependencies`.
- Each row in foreman's pane gains a dim line with the sub session's tokens and
  dollars, and the pane gains two lines before the log, one for the sum over
  the sub sessions and one for this session's own spending.

## Grafts from the runners-up

1. **The status file is not written after every step (from the extensible
   plan).** The simplest plan let the existing `state.set` hook rewrite the
   status file after nearly every model step, because the totals change each
   time. Foreman reads the folder at most every 30 seconds, so those writes
   would reach no reader, and with several subagents running they would be
   many. Leaving the `usage` key out of the hook, and letting the minute's
   forced write carry the field, bounds how stale the field is at one minute.
   The robust plan said it would not ask for a write after each step but did
   not leave the key out of the hook, so it would have written after each step
   too.
2. **A step with no usage does not use up its index (from the robust plan).**
   Otherwise a failed request would mark its index as counted, and a request
   repeated at the same index with real usage would be dropped.
3. **The models are a sorted list, not an object keyed by name (from the robust
   and extensible plans).** A model name from the API is then never an object
   key, and the text of the record compares the same from one write to the
   next.
4. **The store key comes from the ledger's own session id (from the robust
   plan).** Taking it from `$.session.id()` at the time of the write could
   store an old conversation's totals under a new conversation's key after a
   `/clear`.
5. **The dollar figure is also read at the session's start and in
   `session.measure` (from the robust plan).** `measureContext` runs only at the
   end of a turn that replied. A resumed session whose engine figure starts
   again from zero could grow past the stored reading before that, and only the
   difference would then be added.
6. **The counting runs without being awaited, behind a hook that only passes
   the step through (from the robust plan).** The extensible plan awaited the
   counting inside the hook, which puts the state and store writes on the path
   of every model response.
7. **Foreman keeps summed counts for each sub session (from the robust
   plan).** Foreman's rows and its sum show no split by model, so its 200
   entries need only four counts and the dollars each, and "the larger in each
   count" is one comparison per kind.
8. **A compile-time check of the shared shape, and stub modules first (from the
   extensible plan).** `usage.ts` and `spend.ts` are first written as stubs with
   typed exports that return empty values, so the type gate passes and each new
   test fails on its assertion rather than on a missing import.
9. **The pure rules in their own modules (from the robust and extensible
   plans).** The simplest plan put them in `hooks/context.ts`, whose top half
   is meant to be copyable to other mods, and in foreman's `tickets.ts`.

## Rejected alternatives

- **Adding the agent id to a step's key (the extensible plan).** The plan
  argued that parallel subagents could share a turn id. The engine's types say
  otherwise: `turn.start` mints a turn id for each run of a loop, main's or a
  subagent's, and "each run of the loop is one turn"; `TurnStepInput.turnId`
  is that turn's id. Two loops never share a turn id, so the spec's key of turn
  id and index is enough, and the extra field would only make the stored turns
  larger.
- **Two state keys in builder, a private ledger and a public value (the robust
  and extensible plans).** Each step would write both, and they cannot be
  written together. After a hot reload, an old copy could set the public value
  from an older ledger over a newer one, and the pane, the status file and
  foreman's reading of the parent would disagree until the next step. One key
  has no such case. The cost is that the published value also carries the
  remembered turns and the last engine reading, which the comment on the key
  names as builder's own, and foreman's type declares only the fields it reads.
- **At most 20 models, with an "other models" row (the robust plan).** A
  session reports a handful of model names, and a folded row could not be split
  again. The spec does not ask for it.
- **Emptying the remembered turns at the session's end (the robust plan).** It
  saves a few kilobytes per stored ledger at the cost of a write inside the
  end's tight budget, and pruning after 14 days already bounds the store.
- **Keeping stored ledgers for 30 days (the extensible plan).** Builder counts
  in every session, ticketed or not, so 30 days of ledgers of a few kilobytes
  each could press on the store's limit of 4 MiB, which builder's other
  records share.
- **Folding by a stored read time (the extensible plan).** An entry is appended
  when its ticket is first read and replaced in place afterwards, so its place
  in the list already orders the entries by age.
- **A count of sub sessions whose cost is unknown beside the dollar sum.** The
  spec does not ask for it, and the folded total could not keep it.
- **Writing the status file after every step (the simplest plan).** See the
  first graft.

## Where the plan refines the spec

- **A step with no usage leaves its turn's index as it was.** The spec says
  such a step adds nothing; the plan also does not remember its index, so a
  later request at that index can still be counted.
- **The first dollar reading.** The spec says a reading lower than the last one
  is added in full. With no earlier reading, the plan adds the first one in
  full as well. That reading may include calls made before builder loaded,
  while the tokens do not, which the spec already names as a known gap.
- **A missing `cost` after a known reading.** The dollar total stays as it was
  and stays known. It reads as unknown only while no reading has arrived.
- **The published value.** The spec says builder publishes "the same totals"
  under `usage`. The value also holds the session id, the remembered turns and
  the last engine reading, because it is the one ledger builder keeps. Foreman
  reads `sessionId`, `models` and `usd`, and treats a value stamped with
  another session id as missing.
- **How often the status file carries the usage.** The spec does not say. The
  file carries the usage whenever it is written, and the minute's forced write
  bounds how stale the field is at one minute. This widens the spec's accepted
  gap of spending just before a file is deleted by up to a minute.
- **Foreman's entries hold summed counts.** The spec says the list holds "the
  last usage it read". Foreman keeps that usage summed over models, because
  nothing it shows is split by model.
- **The dollar sum.** It is the sum of the known figures, and unknown only when
  no entry and no earlier total has one.

## State kept and its edge cases

Builder keeps one state value, `usage`, and one store key per session,
`usage:<sessionId>`, holding the same ledger. The state value is the live
truth while the process runs, and the store key is the durable copy it is
rebuilt from. Foreman keeps two new fields inside its existing ledger, which
is already held in state and stored under `tickets:<sessionId>`.

- **A restart.** The state starts empty. `session.start` and the first step
  both seed it from the store. A step that finished but whose store write had
  not landed before the restart is lost, never counted twice.
- **A hot reload.** The state survives, and the seed is not used because the
  state already holds a ledger for this session. A step that the old copy
  still has in flight lands through `update` on the same value. The old copy's
  write chain may store a slightly older ledger after the new copy's write;
  the next step's write corrects it, and only a restart in that gap loses the
  step.
- **A resumed session.** It keeps its session id, so the stored ledger comes
  back. An engine dollar figure that starts again from zero is read at the
  session's start as a lower reading and is added in full. If a resume ever
  gives a new session id, counting starts again from zero, as the other
  records keyed by session id already do.
- **A cleared session.** `/clear` gives a new session id. The held ledger is
  stamped with the old one, so `usageIn` reads it as none and counting starts
  from zero, as the context measure already does. Until the first step, the
  published value still carries the old session id, and foreman reads it as
  unknown. If the engine does not start its dollar figure again from zero on a
  clear, the first reading charges the earlier conversation's dollars to the
  new one; the hand check looks at this.
- **Two copies running at once.** Two sessions use separate state and separate
  keys. Two processes resuming the same session write over each other's key,
  and the stored totals then undercount; this is accepted and stated in the
  README.
- **The store's size.** A ledger is a few kilobytes, and ledgers older than 14
  days are pruned, so a session resumed after two weeks starts again from
  zero.
- **Foreman.** `spent` and `earlier` ride inside the existing ledger and come
  back with it after a restart, a reload and a resume; the widened emptiness
  check covers the reload. A ticket whose entry was folded and that comes back
  is counted twice, which the spec accepts.

## Steps

Every test is written first and seen to fail before the code that passes it.

1. Add the types to `mods/builder/types/index.d.ts`: the token counts, the
   ledger, `BuildStatus.usage` and the `usage` key in `PluginState`. Add the
   foreman types to `mods/foreman/types/index.d.ts`. Run the first gate again,
   because the manifests' types are rewritten from these.
2. Write `mods/builder/hooks/usage.ts` and `mods/foreman/hooks/spend.ts` as
   stubs whose typed exports return empty values, and run the type gate.
3. Write the transcript fixture and the builder tests of the pure rules in
   `usage.test.ts` and `pane.test.ts`, and see them fail.
4. Implement `usage.ts` until they pass.
5. Write the builder engine tests in `register.test.ts` and the record test in
   `status.test.ts`, and see them fail.
6. Wire builder: the `turn.step` hook, the seed, the store write chain, the
   three dollar readings, the pruning, the `state.set` exclusion, the status
   field and the pane.
7. Write the foreman tests in `spend.test.ts`, `tickets.test.ts`,
   `act.test.ts`, `record.test.ts` and `register.test.ts`, and see them fail.
   Every `ForemanTickets` literal in the existing tests gains the two new
   fields.
8. Implement `spend.ts`, `ticketsIn`, `recordIn`, `decide`, the emptiness
   check, the view and the pane until they pass.
9. Update the sections of both mods' READMEs on the status file, the pane and
   what each mod keeps. The gates do not read them.
10. Run all four gates for both mods, in the order `CLAUDE.md` gives.
11. Do the hand check in one real session.

## Test plan

Each item follows the spec's Verification section in order. The builder test
files are under `mods/builder/tests/` and the foreman ones under
`mods/foreman/tests/`.

1. **The transcript fixture.** The fixture is
   `mods/builder/tests/transcript-fixture.ts`, holding one main transcript and
   two subagent transcripts as inline JSONL text, with each response written as
   two or three lines sharing a message id, and two invented model names. The
   test, in `usage.test.ts`, sums the fixture's usage with duplicates removed
   by message id, and asserts that the sum with duplicates left in is
   different, so a reference sum that forgot to remove them cannot pass. It
   then mounts builder, replays each response as a `$.turn.step` answered by a
   bottom hook with that usage, as `model()` in foreman's `turn-end.test.ts`
   does, sends some steps twice, and checks that the `usage` state value's
   models equal the reference sum. It is seen to fail against an `afterStep`
   that does not check the remembered index.
2. **A repeated step and a lower index add nothing.** In `usage.test.ts`,
   against `afterStep`: a repeated step, a lower index for the same turn, a
   step with null usage that leaves the index free for a later step at that
   index, two turns counted separately, and the bound of 50 turns. In
   `register.test.ts`, the same repeated step through the engine.
3. **One store write.** In `register.test.ts`, a `store.set` hook records every
   write. One counted step gives exactly one write to `usage:session-1`, whose
   value holds both the turn's entry and the added counts. A repeated step
   gives no write. A refused write leaves the pane's totals right, and the next
   step's write carries both steps.
4. **Dollars.** In `usage.test.ts`, against `afterCost`: a lower reading is
   added in full, a higher one adds only the increase, the same reading twice
   adds nothing, a missing cost leaves `usd` null before any reading, and a
   missing cost after a reading leaves the total as it was. In `pane.test.ts`,
   `usageLines` with no dollar reading says "cost unknown" and holds no `$0`.
   In `register.test.ts`, `usageAnswers` is extended with `cost`, and a
   session that starts with a lower engine figure than the stored one keeps a
   growing total.
5. **A damaged stored total reads as none.** In `usage.test.ts`, `usageIn`
   reads a malformed value, a value with one bad model entry and a value
   stamped with another session id as none. In `register.test.ts`, a store
   seeded with garbage under `usage:session-1` gives counting from zero.
6. **Foreman.**
   - In `spend.test.ts`: a newer read replaces the entry; a fork's file leaves
     the entry as it was; past 200 entries the oldest entries without a
     pairing fold into the earlier total and `spentSum` is unchanged; an entry
     whose pairing still exists is not folded; `spendWords` of a missing value
     says unknown and never $0.
   - In `act.test.ts`: when the owner's file disappears, the pairing is
     forgotten, the entry stays and the sum is unchanged.
   - In `tickets.test.ts`: a damaged `spent` reads as an empty list with no
     earlier total.
   - In `record.test.ts`: a file without `usage`, and one with a malformed
     `usage`, parse with the field left out.
   - In `register.test.ts`: the pane shows unknown for a row whose file has no
     `usage`; it shows this session's spending as unknown when builder's state
     value is missing and when it carries another session id; a hot reload
     keeps a ledger that holds only readings.
   - In `status.test.ts` in builder: `recordOf` writes `usage` when the ledger
     exists and leaves it out when it does not, and the version stays 1.
7. **The four gates** pass for both mods.
8. **The hand check.** In one real session, the totals in builder's pane match
   a sum taken from that session's transcripts with duplicates removed by
   message id. The check also notes whether the engine's dollar figure starts
   again from zero after a `/clear`.
