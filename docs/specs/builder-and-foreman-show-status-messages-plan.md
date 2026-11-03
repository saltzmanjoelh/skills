# Plan: builder and foreman show their status messages

Written 2026-11-03 for `docs/specs/builder-and-foreman-show-status-messages.md`.
Three planners worked blind from different priors: the simplest change, the
most robust and the most extensible. A judge chose the most-extensible plan
and named ideas from the other two to graft onto it.

## Chosen approach

Each mod gets one small module of pure functions that holds its new record:
the record's shape, a lenient reader, the one function that changes it, and
the words of its pane line. Each `register.tsx` keeps the record in a module
variable, records an outcome after the decision it follows, and copies the
record to the store through one chain of writes that run one at a time.

The record is a module variable, not a `$.state` atom, for two reasons.
Builder's `state.set` hook asks for a status write after every builder atom
write except a listed few, so an atom would put the counts on the path to the
status writer. A module variable never reaches that hook, the status file or
the memo, which meets the non-goal by construction. Each change asks for a
redraw with `$.ui.invalidate('ui.render')`, as builder already does for other
module variables.

### Builder

- `mods/builder/hooks/sends.ts`, new and pure: `SENDS_PREFIX = 'sends:'`,
  `sendsKey`, `SENDS_KEPT_MS` of 14 days, `REASON_MAX` of 120,
  `emptySends({ sessionId, parentSessionId, since })`,
  `sendOutcomeOf(settled, limitMs)`, `afterSend(record, outcome, at)`,
  `sendsIn(raw, sessionId)`, `sendsNewest(record)` and
  `sendsLine(record, now)`, which answers `{ text, isWarning }`.
- The record, kept under `sends:<session id>`:

  ```ts
  { version: 1, sessionId, parentSessionId, since,
    delivered, failed,
    last: null | { at, outcome: 'delivered' } | { at, outcome: 'failed', reason } }
  ```

  `since` is the hooks' load stamp. `last.at` is the time the send began, so
  that the live check never sees a delivered send whose time falls after the
  marker it caused was consumed. `parentSessionId` lets the live check find
  every copy that belongs to one parent from the store alone. The reason is
  cleaned with `printable(reason, REASON_MAX)` when it is recorded.
- `sendOutcomeOf` counts an answer with `isDelivered: true` as delivered.
  Every other answer counts as failed, with the engine's reason or "the engine
  gave no reason". A thrown error counts as failed with its message, and a
  timeout counts as failed with "no answer came within 10 seconds", worded
  from the limit.
- `withinTimeout` rejects with a new `TimedOut` error class whose message is
  unchanged, so `tellParent` tells a timeout apart from other errors and the
  other callers see no difference.
- `tellParent` captures `countedFor`, the session id of the record at the
  moment the send starts, and the start time. Once the send settles, and
  before the `finally` fires any owed send, it records the outcome
  synchronously through `noteSend`, which counts only when the record still
  belongs to `countedFor`. A send of an earlier conversation that ends after a
  `/clear` is therefore dropped, not counted against the new one. Recording
  never holds up the owed send, and the send logic itself does not change.
- `session.start` sets the record to null before anything else, so the count
  starts at zero on every load, including a reload in the same module.
- `adoptMemo` calls `startSends` when the memo has a ticket and a parent and
  the record does not already belong to that session. `startSends` creates a
  zero record with the load stamp, redraws and writes the copy. Every way a
  memo is taken up passes through `adoptMemo`, so this covers a reload, the
  first prompt of a fresh session, and a resume.
- `reopenForNextConversation` sets the record to null beside
  `parentSendOwedTo`.
- `copySends` follows the chain of `persistUsage`. When its turn comes it
  takes the newest record, reads the stored copy, skips the write when the
  stored copy's `since` is greater than its own (a newer load owns the key) or
  when the text equals the last text it stored, and ignores a failed write.
- `pruneSends` is a plain copy of the `pruneUsage` loop with the new prefix
  and reader, called in `session.start` beside `startUsage`. The spending
  ledger's code is not touched.
- `view` gains `sends`, the record only when its session id is the current
  one, for the pane only. `pane.tsx` gains `View.sends` and a `sendsTree`
  drawn right after `usageTree` in both branches of `paneTree`, as one
  `<Text>` coloured yellow when `isWarning`. The reason is a string child, so
  markup in it is never interpreted.

### Foreman

- `mods/foreman/hooks/markers.ts`, new and pure: `MARKERS_PREFIX = 'markers:'`,
  `markersKey`, `MARKERS_KEPT_MS` of 14 days, `emptyMarkers(sessionId, since)`,
  `afterConsumed(record, at)`, `markersIn`, `markersNewest`,
  `markersLine(record, now)` and `FIRST_MARKER_LOG`.
- The record, kept under `markers:<parent session id>`:

  ```ts
  { version: 1, sessionId, since, consumed, first: number | null, last: number | null }
  ```

- `session.start` always starts a fresh record with the current time and
  resets a per-load `markerLogged` flag, then prunes old copies, and writes
  the load copy when the stored parent is on. `becomeParent` writes the load
  copy too, when the role is turned on in the middle of a session.
- The `session.receive` hook keeps its decision and `void readNow($)` exactly
  as they are and first, then calls `void noteConsumed($).catch(() => undefined)`,
  then returns `consumed` as today. Nothing is awaited before the return, so a
  count that fails can never send the marker on to the model.
- `noteConsumed` reads the time and the session id, starts a fresh record when
  there is none or it belongs to another id, and in one synchronous block
  raises the count and decides whether this is the first marker of the load
  from `markerLogged`. Then it redraws, adds `FIRST_MARKER_LOG` to the log when
  it is the first, and copies the record, each in its own `try`.
- `copyMarkers` and `pruneMarkers` follow builder's shape. Foreman cannot
  import builder's hooks, so the small loop is written again.
- `view` gains `markers` while foreman is on, and `paneTree` draws the line
  after the session's spending line.

### Times

Both lines use each mod's existing `timeOfDay` followed by ` UTC`. It prints
hours, minutes and seconds, with the date in front on another day. The spec
gives its lines as examples, and the seconds help the live check.

## Grafts

- From the most-robust plan: `last.at` is the time the send began, because
  foreman consumes the marker before builder learns the send was delivered.
- From the most-robust plan: a per-load `markerLogged` flag decides the first
  log line, so a change of the parent's session id within one load never logs
  "first" twice.
- From the most-robust plan: the extra tests listed under the test plan for a
  marker consumed while foreman is off, a `sends:` write that is always
  refused, and a held send of an earlier conversation.
- From the simplest plan: an explicit reset at `session.start` in both mods,
  which matches "starts at zero each time the hooks load" and is the only
  reset the existing `reloads()` test helper can prove, since that helper
  keeps module variables.
- From the simplest plan: `pruneSends` copies the `pruneUsage` loop instead of
  refactoring it, which keeps the spending ledger out of this change.
- From both: the time is taken when the send starts and the outcome is
  recorded synchronously before the owed send fires, so no sequence numbers
  are needed.

## Rejected alternatives

- An atom in `$.state` for the counts: it would run through builder's
  `state.set` hook, which asks for a status write, and it does not reset on a
  reload without extra work.
- Writing the counts into the status file or the memo: ruled out by the spec,
  because a count could then cause another status write and another send.
- A time limit on each store write, from the most-robust plan: a write that
  timed out and later landed would leave the copy staler than no limit does,
  for a hang the spec never names.
- Sequence numbers on sends, from the most-robust plan: needed only when the
  outcome is recorded after the owed send fires, which this plan avoids.
- A shared `pruneStored` helper, from the most-extensible plan: it touches the
  spending ledger, which the counsel's narrow scope leaves alone.
- Writing builder's first copy only when the first send ends, from the
  simplest plan: it misses "once when the hooks load in a session with a
  parent" and leaves a previous process's copy standing meanwhile.
- A `utcMinute` helper in both mods: `timeOfDay` already exists and the spec's
  wording is an example.

## Steps

1. Builder: write the pure tests in `tests/sends.test.ts` and see them fail,
   then write `hooks/sends.ts`.
2. Builder: write the engine and pane tests in `tests/register.test.ts` and
   `tests/pane.test.ts` and see them fail. Let `foremanSession` expose a store
   the tests can read, switching to `memoryStore` if `mock.store` gives no
   handle.
3. Builder: `TimedOut`, the module variables, the reset in `session.start`,
   `startSends` in `adoptMemo`, `noteSend` in `tellParent`, `copySends`, the
   reset in `reopenForNextConversation`, `pruneSends`, `view().sends` and
   `sendsTree`.
4. Foreman: add `store.keys` and `store.delete` fakes to `tests/world.ts`,
   write the pure tests in `tests/markers.test.ts`, then `hooks/markers.ts`.
5. Foreman: write the engine tests and update the exact pane snapshot in
   `tests/issue-links.test.ts`, then the module variables, the reset, prune
   and load copy in `session.start`, the load copy in `becomeParent`,
   `noteConsumed`, `copyMarkers`, `view().markers` and the pane line.
6. The READMEs: builder's "The pane", "The status file for the foreman" and
   "What it keeps"; foreman's "The pane" and "The status folder".
7. Rewrite the earlier plan's live-check wording (the bullet that says the
   check runs before merging, and step 8) to point at point 12 of this spec,
   which the counsel asked for when it decided how the check is run.
8. Run every gate in the project's `CLAUDE.md`, in order, and search the
   staged changes for issue keys and pull request numbers before each commit.
9. After the merge, run the live check in point 12 of the spec and post its
   comment on the tracker issue.

## Test plan

Foreman, mapped to the spec's Verification section:

- A consumed marker raises the count and the newest time, and the pane line
  shows both with the load time; before any marker the line says `none yet`.
- Only the first marker consumed since the hooks loaded adds a log line, and
  a reload through `reloads()` lets a new first line be logged.
- The copy is written under `markers:<parent session id>` with the version and
  session id, at load in a parent, when the role is turned on, and after each
  marker. A copy 15 days old and a damaged one are deleted at load, a copy 13
  days old is kept, and a session that is not a parent writes no load copy.
- With the `markers:` key refused and the log write denied, the marker is
  still consumed and the folder is still read once.
- Deliveries that pass on change no count.
- A marker consumed while foreman is off is counted and copied, and no pane
  line is drawn.
- Pure tests of `afterConsumed`, `markersLine` and `markersIn`.

Builder, mapped to the spec's Verification section:

- A delivered, refused, undelivered, thrown and timed-out send each change the
  right count, newest time and reason, in the pane and in `sends:<session id>`.
- A burst of changed writes folded into one further send counts as one send.
- The pane line shows `0 delivered, 0 failed` before the first send, is yellow
  with the reason while the newest send failed, and is plain after a later
  delivered send. A reason with markup, an escape sequence and several lines
  is drawn on one line as plain text.
- A session without a parent shows no line and writes no copy.
- The copy carries the version, session id, parent id and `since`, is written
  at load and after each send, and a copy 15 days old or damaged is deleted at
  load while one 13 days old is kept.
- Neither the status file nor the memo gains a field, and the number of status
  writes and sends does not change because of a count.
- After `reloads()` the count is zero and the copy carries the new `since`.
- A stored copy with a greater `since` is not overwritten.
- With every `sends:` write refused, sends and status writes go on and the
  pane still counts.
- A held send of an earlier conversation, released after a `/clear` and after
  the new conversation's first send, leaves the new key with only its own
  counts.
- Pure tests of `sendOutcomeOf`, `afterSend`, `sendsIn` and `sendsLine`.

The gates in the project's `CLAUDE.md` all pass.
