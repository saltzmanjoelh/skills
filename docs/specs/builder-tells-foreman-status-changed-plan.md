# Plan: builder tells foreman that its status file changed

Written 2026-10-31 for `builder-tells-foreman-status-changed.md`, after a
tournament of three plans: the simplest change, the most robust one and the
most extensible one.

## Chosen approach

The simplest plan won. All three plans met the spec, and this one does it
with the least state, the least code and no behavior the spec does not ask
for. It adds no new file and no dependency.

1. **The marker is one shared literal type.** `StatusChangedText` is declared
   in `mods/builder/types/index.d.ts` beside `ForemanNudgeText`. Builder's
   constant `STATUS_CHANGED_TEXT` in `hooks/status.ts` and foreman's constant
   of the same name in `hooks/notes.ts` are both typed with it, so the type
   check fails if the two copies differ.
2. **Foreman adds the parent line.** `tickets.ts` gains
   `PARENT_LINE = 'foreman-parent:'`. `briefFor(args, uuid, parentId)` takes
   the id as a required third argument and appends `\nforeman-parent: <id>`
   after the ticket line. `startSession` passes `await $.session.id()`.
3. **Builder reads and keeps the parent.** `status.ts` gains
   `parentIn(text)`, which mirrors `ticketIn`: it reads the first
   `foreman-parent:` line, trims it, and returns it only when it passes the
   existing `SAFE_ID` pattern. `lookForTicket` passes the result into the
   ticketed `newMemo` call. The memo field is `parentSessionId?: string`.
   `statusMemoIn` reads it leniently: a missing, non-string or invalid value
   reads as no parent and keeps the rest of the memo, and the field joins the
   list of lenient exceptions in the comment above `statusMemoIn`.
   `recordOf` names its fields one by one, so the id never reaches the file.
4. **Builder sends after a changed write.** In `writeStatus`, the writer
   works out `changed = text !== lastWrittenText` before its existing skip
   check, and after `lastWrittenText = text` calls `tellParent($, parent)`
   when `changed` holds and the memo has a parent. A write that gives up
   after its 30-second limit throws out of the loop before that line, so it
   sends nothing. `tellParent` keeps two module booleans, a send in flight and
   a send owed. When a send is in flight it marks one owed and returns.
   Otherwise it starts
   `withinTimeout($, Promise.resolve().then(() => $.session.send(...)), PARENT_SEND_TIMEOUT_MS)`
   with a 10-second limit, ignores every outcome, and in `finally` frees the
   slot and sends once more if one is owed. Nothing is awaited by the
   writer. `reopenForNextConversation` clears the owed flag. The comment on
   `lastWrittenText` says that a hot reload also costs one marker.
5. **Foreman consumes the marker.** `notes.ts` gains a pure
   `isStatusChanged(text)`: one anchored regular expression built from the
   existing `MESSAGE_HEAD`, `MESSAGE_OPEN`, `MESSAGE_CLOSE` and
   `MESSAGE_TAIL` constants accepts either the bare element or the header,
   the element and the trailer, and the function answers true only when the
   element's body, trimmed, equals the marker. Equality alone turns away two
   elements and extra words. `register.tsx` adds
   `on('session.receive', ...)`: when `e.origin.kind === 'peer'` and
   `isStatusChanged(e.text)`, it starts `readNow($)` without waiting and
   returns `{ consumed: ... }`; otherwise `next(e)`. Its `.catch` passes the
   delivery on. A comment says that `readAndSchedule` checks whether foreman
   is on before it lists the folder, so a marker that arrives while foreman
   is off is consumed and nothing is read.

## Grafts from the runners-up

- **Reuse `SAFE_ID`** (from the extensible plan), so the file keeps one
  character rule.
- **Read the memo's parent leniently** (from the robust and extensible
  plans), so a damaged field costs only the wake, not the ticket and the
  rest of the memo.
- **Name the field `parentSessionId`** (from the extensible plan), because
  foreman already uses `parent` for one of its own values.
- **A pure test that the marker does not begin with `foreman: ` and holds
  none of `&`, `<`, `>`, `"` or `'`** (from the robust plan), which pins rule
  5 and the claim that no entity decoding is needed.
- **One foreman test that covers both timer intervals with no message**
  (from the extensible plan), because the spec's last Verification bullet
  asks for both.
- **Accept the trailer line only when the header came first** (from the
  extensible plan's parser), which matches the two shapes the spec names.
- **A live check before merging** (adapted from the robust plan): after the
  build, send the marker from a real sub session to a real parent and confirm
  that the receive hook sees a `peer` origin and one of the two envelope
  shapes. The result goes in the pull request.

## Rejected alternatives

- **A self-send guard.** The spec does not ask for it, and the marker cannot
  loop, because the receive hook sends nothing.
- **Reading the parent line only right after the ticket line.** It is
  stricter than rule 2, and a forged id can only deliver a fixed harmless
  text to a session that passes the character rule.
- **Validating the id, and catching a failure of `$.session.id()`, in
  foreman.** The engine supplies the value, and builder validates it anyway.
- **A zero-delay timer in front of `readNow`.** The hook already does not
  wait for the read.
- **A generation check before an owed send, and dropping an owed send once
  the session has closed.** The first closes a harmless duplicate at the cost
  of a state read; the second loses the notice for the very last change.
- **An `isOn` check and an `ensureArmed` call in the receive hook.**
  `readAndSchedule` already checks `isOn`, and `readNow` re-arms the read
  timer through `schedule`; a second `schedule` call would race it.
- **A hand-written envelope parser.** It is larger than the regular
  expression and adds no strictness that the equality check does not give.
- **A probe in a real session before building.** The tests prove the logic,
  and a mismatch fails safe because the timer covers it, so the live check
  comes after the build instead.
- **Keeping the compared text in the memo** to avoid the extra marker after a
  hot reload. More state for a gain nobody would notice.

## Step sequence

1. Add `StatusChangedText` and `StatusMemo.parentSessionId` to builder's
   types.
2. Builder pure tests in `tests/status.test.ts`, then `parentIn`,
   `STATUS_CHANGED_TEXT`, the lenient memo reader and the `newMemo` option.
3. Builder engine tests in `tests/register.test.ts`, then `lookForTicket`,
   the `changed` decision in `writeStatus`, `tellParent` and the reset.
4. Foreman `briefFor` tests, then `PARENT_LINE`, the third argument and the
   `startSession` call. Update the brief expectations anchored at the end of
   the prompt in `tickets.test.ts`, `acts.test.ts` and `queued.test.ts`,
   including the ticket slicer in `queued.test.ts`, which must stop at the
   end of its line.
5. Foreman: add a bottom `session.receive` fake to `engine()` in
   `tests/world.ts`, write the pure `isStatusChanged` tests and the engine
   tests, then the constant, the function and the hook.
6. Update `mods/builder/README.md`, `mods/foreman/README.md` and the wake
   skill's description of the brief lines.
7. Run every gate in the project's `CLAUDE.md`, in order.
8. The live check, before the pull request merges.

## Test plan

Each test is written first and seen to fail.

Builder, pure (`mods/builder/tests/status.test.ts`):

- `parentIn` reads the first parent line, trimmed, and gives null for an id
  with a space or a slash, an empty value, and a prompt with no such line.
- `statusMemoIn` keeps a valid `parentSessionId`, and reads a missing,
  non-string or invalid one as none while keeping the rest of the memo.
- `newMemo` carries the parent, and `recordOf` of a memo with a parent has no
  parent field.
- The marker does not begin with `foreman: ` and holds none of `&`, `<`,
  `>`, `"` or `'`.

Builder, engine (`mods/builder/tests/register.test.ts`, status section), with
a first prompt that adds `foreman-parent: parent-1` to the ticketed one and a
`session.send` fake that records each call and answers as delivered,
undelivered, throwing, hanging or held until released:

- A ticketed first prompt with a parent line sends the marker to the parent
  after the first write.
- A parent id with other characters, and a ticketed prompt with no parent
  line, write the file and send nothing.
- A hot reload keeps the parent from the memo, and the next changed write
  sends to it.
- A resumed transcript whose first prompt holds both lines sends to the
  parent.
- A later changed write, such as a turn starting, sends again.
- The minute's rewrite with an unchanged record sends nothing, and a minute's
  rewrite whose record changed sends.
- Three changed writes while one send is held give exactly one more send
  after it is released.
- A send that hangs is dropped after 10 seconds, writes go on meanwhile, and
  the next change sends again.
- An undelivered, a refused and a throwing send are each dropped, the file
  keeps updating, and a later change sends.
- A write that gives up after 30 seconds sends nothing.

Foreman (`mods/foreman/tests/tickets.test.ts`, `notes.test.ts`,
`register.test.ts`):

- The brief ends with the ticket line followed by the parent line, and a
  `start_session` brief carries the parent's own session id.
- `isStatusChanged` accepts the marker bare, between the header and the
  trailer, and with extra white space, and refuses other words, two
  elements, a forged closing tag, a trailer without a header and text after
  the trailer.
- A peer delivery of the marker in each shape is consumed and lists the
  folder at once while foreman is on, and is consumed with no listing while
  foreman is off.
- A peer delivery whose plugin claim names another plugin is treated the same.
- A marker during a held folder read reuses it, with one listing.
- A peer question, the marker with other words, two elements, and the marker
  from an origin other than `peer` all pass on unchanged, with no listing.
- With no message at all, the folder is read at 30 seconds while a sub
  session works and at 2 minutes otherwise.
