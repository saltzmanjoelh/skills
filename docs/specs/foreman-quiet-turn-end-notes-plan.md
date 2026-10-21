# Plan: foreman keeps turn-end notes from the parent's model without a red warning

Written 2026-10-21 for `docs/specs/foreman-quiet-turn-end-notes.md`, from a
tournament of three plans: the simplest, the most robust and the most
extensible. The simplest plan won, because it meets the spec with the fewest
moving parts and was the only one to declare the new atom in foreman's types.

## Chosen approach

- **The rewrite.** In the `prompt.submit` hook in
  `mods/foreman/hooks/register.tsx`, the branch for a prompt of tracked
  turn-end notes writes the log line with `addLog`, sets a new atom,
  `quietLine`, to the same line, and returns `next({ ...e, text: line })`.
  `choiceFor` and `keptLine` do not change. The hook's existing `.catch`
  still passes the prompt on unchanged when anything throws, so a failed log
  write or marker write sets no marker and rewrites nothing.
- **The answer.** A new `turn.step` hook, an async generator, goes beside
  the `turn.start` hook.
  - A step whose `index` is not 0, or that has an `agentId`, returns
    `yield* next(e)` at once and touches nothing, so the marker waits for
    the next first step of the session's own loop.
  - Otherwise a plain async helper decides, inside one try/catch in which
    any error means no. It reads and clears the marker in one swap,
    `update($, quietLine, m => { held = m; return null })`, before it reads
    the conversation. When `held` is a line, it reads
    `$.session.messages()`, checks that the answer is an array, and answers
    yes only when the last message is a user message whose text is exactly
    the line and the message before it, if any, is not a user message.
  - Only after the decision does the hook either return `yield* next(e)`
    or yield the text chunk `Noted.` and a stop chunk with stop reason
    `end_turn` and no usage, and return the matching result. Neither `next`
    nor a yield sits inside the try, because the engine keeps a chunk once
    it is yielded and a failure after a yield would let the model's answer
    follow foreman's.
  - The hook does not check whether the role is on, because the marker is
    set only while it is on.
- **Constants.** `mods/foreman/hooks/notes.ts` loses `NOTES_KEPT`, gains
  `NOTED_REPLY = 'Noted.'`, and its comments say "rewrite" where they said
  "drop".
- **Types.** `mods/foreman/types/index.d.ts` declares `quietLine: string |
  null` beside `turnRuns`, with a comment, because `atom()` is typed against
  it.
- **README.** The Turn-end notes paragraph of `mods/foreman/README.md`
  describes the short line and `Noted.` in place of "Prompt dropped by a
  hook".

## Grafts

- **From the most robust plan:** the atomic swap that reads and clears the
  marker, so a new note's marker set between a read and a clear is not
  wiped; doing every fallible step before any yield; and the tests that a
  later step leaves the marker and that a marker left in state across a hot
  reload still answers.
- **From the most extensible plan:** updating the README, which quotes the
  old warning's text.

## Rejected alternatives

- **A pure decision function with table tests, and a `keepQuietly`
  helper,** from the most extensible plan. They add seams the spec does not
  ask for; the decision is small enough to test through the hook.
- **A streaming `.catch` on the `turn.step` registration.** A hook that
  fails before any yield is already skipped, so the model answers; after a
  yield, a catch that calls `next` would append the model's answer to
  `Noted.`.
- **Stand-ins for the model and the conversation inside `engine()` in
  `tests/world.ts`.** Every test file uses `engine()`, so the stand-ins live
  in `tests/turn-end.test.ts` instead.
- **A marker per turn id or a queue of markers.** The spec asks for one
  marker, and every way a single marker goes wrong ends with the model
  answering.
- **Builder changes.** Builder's `prompt.submit` hooks now see the line as
  a prompt the person typed, but in a parent session nothing they do
  changes: no hold is on, nothing is watched, and the ticket lookup reads
  the first user message.

## Steps

1. In `tests/turn-end.test.ts`, add local helpers: a stand-in `turn.step`
   hook beneath the mod that counts its calls and yields a text and a stop
   chunk, a `session.messages` stand-in whose answer a test sets or makes
   fail, and a helper that drains `$.turn.step` for given fields. Write the
   new tests and change the drop expectations to the rewrite, and see them
   fail.
2. Change `notes.ts`, the types file and `register.tsx` as above, and see the
   tests pass. Update `tests/notes.test.ts` for the removed constant.
3. Update the README's Turn-end notes paragraph and the comments.
4. Run the four gates.

## Test plan

Mapped to the spec's Verification section, in `tests/turn-end.test.ts`:

- A prompt of tracked turn-end notes enters as the log line, with no drop,
  the marker set and one line in the log; this replaces the drop tests for
  the app's shape today, a freed sub session, two sorted names with the
  repeat count, and the hot reload ledger.
- The next first step of the session's own loop, with the line last, yields
  `Noted.` and the stop without calling the stand-in model, and clears the
  marker, so a repeat of the same step calls the model.
- A step that is not the first calls the model and leaves the marker, so a
  first step after it still answers.
- A subagent's step calls the model and leaves the marker.
- A step whose last message differs, a step whose line follows another user
  message and a step with no marker each call the model.
- A stale marker is cleared by a step that refuses: a step whose last
  message differs, then a step with the line last, both call the model.
- A failed read of the conversation lets the model answer and clears the
  marker.
- A typed copy of the line with no marker passes unchanged and its step
  calls the model.
- After a hot reload, a marker left in state still answers.

The existing tests that pass prompts on unchanged or with the Noted context
stay as they are. The four gates run in the order `CLAUDE.md` gives. The
real run in the desktop app is the person's to make.
