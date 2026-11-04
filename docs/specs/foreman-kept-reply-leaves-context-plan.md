# Plan: foreman's own "Noted." reply leaves the parent's context

Written 2026-11-03 for `docs/specs/foreman-kept-reply-leaves-context.md`.
Three planners wrote blind plans: the simplest thing, the most robust and
the most extensible. A judge scored them 7, 7.5 and 5 out of 10. The most
robust plan won, once its turn id comparison was taken out.

## Chosen approach

Foreman keeps a second one-time marker, a boolean atom named `quietReply`
beside `quietLine`. Its `turn.step` hook sets the marker after
`answersAlone` has decided to answer and before it yields anything. A new
`session.append` hook, matched on the door `response`, looks only at rows
of the session's own loop. When the marker is set, the hook clears it in one
swap, and when the row is the single text block `Noted.`, it passes the row
on with an empty content list. Every other row passes on unchanged. The
main loop's `turn.start` clears a stale marker. Every new state access reads
first and writes only when the marker is set, so a turn that has nothing to
do with a kept note writes no new state, as the comment above
`answersAlone` already asks.

## Grafts

- **A boolean marker, from the simplest plan.** The most robust plan stored
  the answered step's turn id, so that a turn start carrying the same id
  would leave the marker set. A turn start always comes before the step it
  starts, so that branch could never run, and it read like a softer version
  of the spec's point 4. A boolean is the least state that meets the spec.
- **`markerOf(on, key)`, from the simplest plan.** The test helper that
  follows `quietLine` writes takes the atom's key, so one helper serves both
  markers.
- **The README and the follow-up issue written out, from the most
  extensible plan.** The other two plans left out the spec's points 5
  and 6.

## Rejected alternatives

- **Storing the reply text in the marker**, from the most extensible plan.
  The text is always `NOTED_REPLY`, so storing it adds state that can only
  disagree with the constant.
- **A shared helper that also rewrites `answersAlone`**, from the most
  extensible plan. The spec's point 3 keeps `answersAlone` unchanged.
- **Matching the joined text of all text blocks**, from the simplest plan.
  Foreman streams one chunk, so its row holds one text block. A row of
  several blocks that join to `Noted.` means the engine stored something
  else, and the spec says such a row is stored unchanged.
- **Writing the marker false on every turn start**, from the simplest plan.
  It writes state on every turn, and a failed write placed before the
  `turnRuns` write would skip that write.
- **Checking `e.door` again inside the hook.** The engine documents the door
  matcher, so the check repeats it.
- **Checking the row's origin.** The probe showed that foreman's row carries
  the model's origin, the same as a real reply, so the check tells nothing
  apart.

## Steps

1. **Types.** Add `quietReply: boolean` to `PluginState.foreman` in
   `mods/foreman/types/index.d.ts`, beside `quietLine`, with a comment
   saying that it is true from foreman's own `Noted.` answer until the next
   stored response row of the session's own loop, or the next start of a
   turn of that loop.
2. **The predicate.** Add `isNotedReply(content)` to
   `mods/foreman/hooks/notes.ts`, beside `NOTED_REPLY`. It is true only for
   exactly one block, of type `text`, whose text equals `NOTED_REPLY`, with
   no trimming.
3. **The atom and helpers** in `mods/foreman/hooks/register.tsx`:
   - `const quietReply = atom({ plugin: 'foreman', key: 'quietReply' } as const, false)`
     after `quietLine`.
   - `markReply($)` sets it true and swallows a failure, so the answer
     still goes out and the reply is stored as today.
   - `clearReply($)` reads first, writes false only when the marker is
     set, and swallows a failure.
   - `takeReply($)` reads first, returns false when the marker is clear,
     and otherwise swaps it to false and returns what it held. It does not
     catch, because its hook's catch does.
4. **`turn.step`.** After `answersAlone` returns true, await `markReply($)`
   before the first yield. The hook keeps no catch, and `markReply` cannot
   throw.
5. **`turn.start`.** In the main-loop branch, await `clearReply($)` before
   the `turnRuns` write, so that neither failure skips the other.
6. **`session.append`.** A new hook after `turn.step`, matched on
   `{ door: 'response' }`. A row with an `agentId` passes unchanged. When
   `takeReply` returns true and `isNotedReply` holds for the content, the
   hook calls `next` with the content emptied; otherwise it calls `next`
   with the row unchanged. Its catch calls `next(e)`, as the hooks around it
   do. Its comment says that the streamed `Noted.` chunk stays because an
   empty chunk makes the engine add a nudge and ask the model.
7. **README.** Replace the sentence saying that the transcript shows the
   short line and `Noted.` with three facts: the transcript shows the short
   line for each kept note, foreman's `Noted.` reply is stored empty so the
   model does not read it on later turns, and the line still reaches the
   model as text at the start of its next turn.
8. **The follow-up issue**, filed in the owner's tracker and never cited in
   the repository or the pull request. Its title reads "Foreman: hide the
   kept line of a turn-end note once the engine offers a quiet consume or a
   hidden-row flag". Its body names the engine gap, says that the work
   starts by checking whether the engine now offers either, and says that
   nobody has checked how the desktop app draws the streamed `Noted.` when
   no stored assistant message follows it.

## Test plan

The tests go in `mods/foreman/tests/turn-end.test.ts`, and are written
before the code and seen to fail. A `row($, content, over)` helper appends
a response row, and a `turnStart($, agentId?)` helper drives `turn.start`
with a bottom hook, as `acts.test.ts` does. Stored content is checked both
in the result and in `w.engine.appended`.

The spec's Verification items:

1. With the marker set, foreman's `Noted.` row is stored empty and the
   marker is cleared.
2. With no marker set, a `Noted.` row is stored unchanged, including the
   model's own `Noted.` to a prompt that carries foreman's Noted context.
3. A subagent's row, a `prompt` row and a `tool-result` row all reading
   `Noted.` pass unchanged and leave the marker set, and a main-loop row
   after them is emptied.
4. With the marker set, a row reading `Noted. `, `Noted`, two text blocks
   joining to `Noted.`, or no blocks, clears the marker and is stored
   unchanged, and a `Noted.` row after it is stored unchanged.
5. A main-loop turn start clears a set marker, and a subagent's turn start
   leaves it set.
6. The `turn.step` answer has set the marker by its first chunk, and a step
   that goes to the model writes no reply marker.
7. A marker that cannot be read lets the row pass unchanged.
8. Two kept notes in a row, with the first reply stored as `(no content)`,
   are both answered alone.

Tests for the plan's own claims:

- A marker that cannot be written still answers `Noted.`, and its reply is
  stored unchanged.
- After a hot reload, a marker left in state still empties the reply.
- When a hook beneath foreman refuses the empty row, the row is stored
  unchanged and the marker is cleared.
- `isNotedReply` holds only for the single text block `Noted.`, in
  `mods/foreman/tests/notes.test.ts`.

The existing tests must still pass. Then the four gates run in the order
the project's `CLAUDE.md` gives. The real run in the desktop app is the
person's to make, and the report says that it was not made.
