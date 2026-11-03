# Builder and foreman show their status messages

Written 2026-11-03. Seeded from the tracker issue that follows up the change
in which builder tells foreman that its status file changed (see
`docs/specs/builder-tells-foreman-status-changed.md`).

## Goal

Since that change, builder in a sub session sends its foreman parent a fixed
marker after each changed status write, and foreman's `session.receive` hook
consumes the marker and reads its status folder at once. A consumed marker
reaches neither the transcript nor the model, and a send that fails is dropped
with at most a quiet log line. So when the parent is a desktop app session,
a marker that was delivered and consumed and a marker that never arrived look
exactly the same: nothing shows on either side.

That made the live check from a desktop app parent impossible to finish.
Its evidence so far is this:

- One marker did reach a desktop parent's model. It came from a sub session
  that the desktop app's `start_session` started, it was addressed to the
  parent's id from the brief, and its origin was a `peer` naming builder as
  its plugin. It arrived wrapped in the desktop app's header line, the
  `<cross-session-message ...>` element and the app's trailer line.
  Foreman's `isStatusChanged` returns true for that exact text, and for the
  bare element too.
- It reached the model only because it arrived about twenty seconds before
  the person quit and relaunched the parent, while the parent's foreman was
  not loaded.
- For about ten hours after the relaunch, no marker reached the parent's
  model, although five sub sessions changed status. A consumed marker and an
  undelivered one leave the same silence, and the desktop app's own log does
  not record these deliveries, so delivery after the relaunch is unproven.

This change makes the outcome visible on both ends. Foreman counts the
markers it consumes, and builder counts the sends it made to the parent and
how each ended. Both show their counts in their panes and copy them to their
stores, so the live check can be run after the merge and recorded.

## Users and trigger

- The person, who reads the panes of a parent session and of its sub
  sessions.
- The session that runs the live check after the merge, which can read files
  but cannot see either pane.
- Foreman's line changes when its `session.receive` hook consumes a marker.
- Builder's line changes when a send to the parent ends, in any way.

## Behavior

### Foreman counts the markers it consumes

1. Foreman keeps, in memory, a record of the markers its hooks consumed since
   they loaded: the time they loaded, the number consumed, the time of the
   first and the time of the newest. It starts at zero each time the hooks
   load, so the count always means "since foreman loaded".
2. Foreman's pane shows one line for this record whenever foreman is on,
   saying that it counts since the hooks loaded, for example
   `Status messages consumed since 14:02 UTC: 3, last at 14:55 UTC`, and
   `Status messages consumed since 14:02 UTC: none yet` before the first.
3. The first marker consumed since the hooks loaded also adds one line to
   foreman's log, saying that a builder status message arrived and was
   consumed. Later markers add no log line.
4. The record is copied to foreman's store under `markers:<parent session id>`
   each time it changes, and once when the hooks load.

### Builder counts its sends to the parent

5. When the session has a foreman parent, builder keeps, in memory, a record
   of its sends to the parent since its hooks loaded: the time they loaded,
   the number delivered, the number failed, the time and outcome of the
   newest send, and, when the newest failed, the reason.
6. A send counts as delivered when the engine reports it delivered. It counts
   as failed when the engine reports it not delivered or refused, when it
   throws, or when it runs past its 10-second limit. The reason is the
   engine's reason, the thrown error's message, or a sentence saying that no
   answer came within 10 seconds. It is kept as plain text on one line and
   cut to a short length.
7. Builder's pane shows one line for this record whenever the session has a
   foreman parent, for example
   `Messages to foreman: 12 delivered, 0 failed, last at 14:55 UTC`, and
   `Messages to foreman: 0 delivered, 0 failed` before the first send.
   While the newest send failed, the line is drawn in the warning colour and
   ends with the reason, as plain text, never as markup.
8. The record is copied to builder's store under `sends:<session id>` each
   time a send ends, and once when the hooks load in a session with a parent.

### The copies in the stores

9. Each copy carries a version number and the session id it belongs to.
   Writes to one key go through one at a time, as builder's copy of its
   spending already does, and a failed write is ignored.
10. When the hooks load, each mod deletes its own copies of this kind whose
    newest time is more than 14 days old, as builder already does for its
    spending.
11. Counting, drawing and copying never decide whether a marker is consumed
    and never hold up the status writer or a send. They run after the
    decision, and any error they raise is caught and ignored.

### The live check after the merge

12. Once this change has merged and the desktop parent has loaded the new
    foreman, the session that ran this change reads foreman's copy for the
    parent, builder's copies for the parent's sub sessions, and the parent's
    transcript. The check passes when foreman's count has grown since it
    loaded, every builder copy whose newest send was delivered after foreman
    loaded is matched by a consumed marker at or after that time, and no
    marker reached the parent's model after foreman loaded. It records the
    readings, quoted exactly, and the verdict in a comment on the tracker
    issue. The check is done only when that comment is posted, and the issue
    stays open until then.

## Edge cases

- Foreman or builder reloads: the in-memory count starts at zero and the
  store copy is overwritten with the new load time, so a copy never mixes two
  loads.
- A parent with no sub sessions sending: foreman's line shows `none yet` and
  its copy holds a zero count.
- A sub session without a parent line in its brief: builder shows no line and
  writes no copy.
- A burst of changed writes folded into one further send counts as one send.
- A reason with markup, control characters or several lines is drawn as plain
  text on one line.
- Two sessions writing their own copies at once touch different keys, so
  neither overwrites the other.
- A store write that fails leaves the pane right and the copy stale; the
  next change writes it again.

## Non-goals

- No change to the marker text, the send logic, the consume logic, the
  10-second limit or foreman's timer.
- No change to the status file's fields or its version, and the counts are
  never written into the status file or builder's memo, so a count can never
  cause another status write or another send.
- No retry of a failed send.
- No warning in the band above the prompt.
- No per-sub-session marker time in foreman's pane; the marker does not say
  which sub session sent it, and this change keeps it that way.
- No count kept across a reload of the hooks.

## Failure modes

- A store write fails: the pane still shows the count, and the live check
  reads a stale copy, which its load time makes visible.
- A send hangs past its limit: it counts as failed with the timeout reason,
  and the line turns the warning colour until a later send is delivered.
- The live check finds a mismatch: the comment records the readings and the
  mismatch, and the issue stays open for a fix.

## Verification

Tests on foreman:

- A consumed marker raises the count and the newest time, and the pane line
  shows both with the load time.
- Only the first consumed marker since the hooks loaded adds a log line.
- The copy is written under `markers:<parent session id>` with the version
  and session id, and an old copy is deleted when the hooks load.
- A counter or store write that throws does not stop the marker from being
  consumed or the folder from being read.
- A delivery that is not consumed changes no count.

Tests on builder:

- A delivered send, a refused send, an undelivered send, a send that throws
  and a send that times out each change the right count, newest time and
  reason.
- The pane line shows `0 delivered, 0 failed` before the first send, is drawn
  in the warning colour with the reason while the newest send failed, and is
  plain again after a later delivered send.
- A session without a parent shows no line and writes no copy.
- The copy is written under `sends:<session id>`, an old copy is deleted when
  the hooks load, and neither the status file nor the memo gains a field.

The gates in the project's `CLAUDE.md` all pass. The live check in point 12
is the evidence from a desktop app parent.

## Decided by the counsel

- When foreman's session.receive hook consumes builder's "status file changed" marker, how should foreman make that visible, so a person (or a live check) can see that markers arrive and are consumed? The counsel chose: Both: the counter line in the pane, and one log line only for the first marker consumed since foreman's hooks loaded. 5 of 7 members voted for it.
- How should builder, in a sub session with a foreman parent, show the outcome of its "status file changed" sends to the parent, so that a send that fails is visible instead of silent? The counsel chose: A line in builder's pane, shown whenever the session has a foreman parent, that counts the sends delivered and failed with the time of the newest, such as `Messages to foreman: 12 delivered, 0 failed, last at 14:55 UTC`; while the newest send failed, the line is drawn in the warning colour and names the reason the engine gave. 7 of 7 members voted for it.
- How should the live check from a desktop app parent be run and recorded, given that the parent and every sub session load the mods from the main checkout, so the new trace exists in a desktop parent only after this change merges and the parent loads it? The counsel chose: Record the evidence already gathered in the spec now, and after the merge, once the desktop parent has loaded the new foreman, this session reads foreman's counter line and first-marker log line and builder's delivered count, compares them, and records the result in a comment on the issue; the check is done only when that comment is posted. 7 of 7 members voted for it.
- Where should foreman's consumed-marker count (with its last time and the first-marker log line) and builder's delivered and failed send counts be kept, so that the after-merge live check can read them, given that this session cannot see the parent's pane? The counsel chose: In each mod's in-memory state for its pane, and also copied to that mod's store under a key with the session id (as builder already copies its spending to `usage:<session id>`), so the check reads them from the store files under the plugins store folder. 7 of 7 members voted for it.
- What is in and out of scope for this change, beyond foreman's counter line and first-marker log line, builder's send-outcome line, the store copies and the after-merge live check? The counsel chose: Narrow: only the decided lines, store copies with age pruning, tests, and the two README sections that describe each pane and what each mod keeps; no change to the marker text, the send or consume logic, the 10-second limit, the timer, the status file's fields or version, no retry, and no warning in the band above the prompt. 7 of 7 members voted for it.
