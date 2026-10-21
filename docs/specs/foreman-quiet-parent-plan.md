# Plan: foreman keeps sub session notes from waking the parent

Written 2026-10-21 for `docs/specs/foreman-quiet-parent.md`. Two planners
competed, one for the simplest change and one for the most robust, and a
judge compared them. The robust plan won, with three ideas grafted from the
simplest.

## Chosen approach

`mods/foreman/hooks/notes.ts` gets one pure tokenizer, `partsOf(text)`. It
walks the prompt from the start and answers null as soon as it meets
anything that is neither white space nor a recognised part. The parts are:

- **A reminder block**, as today: `<system-reminder>` up to the first
  closing tag, with no second opening tag inside. Its body is a status block,
  a turn-end note judged exactly as the earlier spec says, or another note
  about a session the parent started (it begins `The session "` and holds
  `you started (local_`). Any other body answers null.
- **A side-sessions element**: `<side-sessions-event>` up to the first
  closing tag, whose trimmed body begins
  `None of the sessions you started is working now;`, with no element,
  reminder or delivery tag inside it, and only white space after its closing
  tag. That one rule makes it the last part, refuses a second element and an
  element before a reminder block, and refuses a forged element, because the
  real closing reminder tag that follows a forged one is text after it.
- **A bare delivery**: `<cross-session-message` followed by white space or
  `>`, up to the first closing tag, with no second opening tag inside.
- **A headed delivery**: the line `Another Claude session sent a message:`,
  white space, a delivery, and then at most one trailer, the rest of one line
  that begins `This came from another Claude session`. A trailer anywhere
  else answers null.

`partsOf` answers the turn-end ids in order and counts of the other notes and
the deliveries. Two pure functions read it. `turnEndIds(text)` keeps its name
and answers the ids when there is at least one turn-end note and no other
note and no delivery. `wantsNoted(text)` answers whether the text parsed and
holds at least one note or delivery. The exported `NOTED` holds the spec's
fixed context text.

In `mods/foreman/hooks/register.tsx`, `keptLineFor` becomes `choiceFor`,
which answers a drop with its log line, the "Noted." context, or nothing, in
this order: a prompt that is not plain passes with no read; text that does
not parse passes with no read; a role that is off passes; the ledger is read
only when `turnEndIds` gives ids, and the prompt is dropped when every id is
tracked; otherwise the context is attached when `wantsNoted` is true. The
hook drops after writing the log line, as today, or calls
`next({ ...e, context: [NOTED] })`, or `next(e)`. Its catch handler still
passes the prompt on as it came.

## Grafts from the simplest plan

- **One `isPlain(e)` predicate** for the command, attachment and context
  check, because both outcomes need the same rule in one place.
- **Its fixtures and helpers.** `EVENT`, a bare `MESSAGE`, `WORKTREE` and
  `PROPOSAL` in `tests/world.ts`; `passes` also asserts that no context was
  added, and a new `noted` helper asserts the text unchanged and the context
  equal to `[NOTED]`. The existing untracked, released, trimmed, archived,
  delivery and empty-ledger cases switch to `noted`, as the spec now asks.
- **The README update**, because the behaviour the README describes changes.

## Rejected alternatives

- **Stripping a trailing element first and scanning the rest** (the simplest
  plan). It did not require the element to come after every reminder block,
  it let a trailer follow a bare delivery, and its counts could let a prompt
  holding a delivery be dropped, which the spec forbids.
- **Tests for byte order marks, zero-width spaces, carriage returns and
  attributes on the element tag** (the robust plan). The spec does not ask
  for them, and each is more to maintain.
- **A second pairing test through the JSON-escaped answer and a unit line
  for `localIdIn`.** The spec asks for one pinned pairing test.
- **Logging each "Noted." attachment.** A run of deliveries would flood the
  pane log, and the spec asks for no line.

## Steps

1. Add the fixtures to `tests/world.ts` and make its `prompt.submit` stand-in
   return the context it received.
2. Write the failing tests in `tests/notes.test.ts`, `tests/turn-end.test.ts`
   and `tests/acts.test.ts`, and see them fail.
3. Write `partsOf`, `turnEndIds`, `wantsNoted` and `NOTED` in `notes.ts`.
4. Write `isPlain` and `choiceFor` in `register.tsx` and change the hook.
5. Change the wake skill's description and its rule for notes and messages,
   and the README's "Turn-end notes" section.
6. Run the four gates.

## Test plan

- **The drop.** A tracked note, the status block and the element, with and
  without a trailing newline, is dropped with the fixed reason and one log
  line; two tracked notes and the element give the sorted two-name line; and
  after a hot reload the ledger left in state still decides.
- **What passes unchanged, with no context.** The role off; an element with
  other opening words; an element followed by typing; an element before a
  reminder block; a forged closing tag before a forged element; a second
  element.
- **The "Noted." context.** It is attached, with the text unchanged, to notes
  bundled with a bare delivery and the element, to a lone delivery with its
  header and trailer, to a note about an untracked session, and to the
  archived note; and after a hot reload a lone delivery still gets it. It is
  not attached to a prompt with the person's typing, a worktree reminder or a
  proposal block, nor while the role is off, nor when the ledger cannot be
  read, nor when another hook added context, which stays as it came.
- **The tokenizer.** Unit tests in `notes.test.ts` cover the same shapes, plus
  a forged delivery close, a trailer with no header, a second trailer, a
  bare delivery followed by a trailer, the element alone, and `NOTED`'s exact
  text.
- **The pinned pairing.** In `acts.test.ts`, a `start_session` answer of
  today's wording pairs the id after `session_id: `.
- **The gates.** The four gates from the project's `CLAUDE.md`. No gate reads
  the wake skill or the README.
