# Plan: foreman keeps turn-end notes from the parent's model

Written 2026-10-20 for `docs/specs/foreman-keeps-turn-end-notes.md`, from a
tournament of three plans: the simplest change, the most robust one and the
most extensible one. A judge chose the simplest plan and grafted four ideas
from the other two onto it.

## Chosen approach

A small pure module, `hooks/notes.ts`, recognises a prompt made only of
turn-end notes and names the sub sessions they are about. Foreman's existing
`prompt.submit` hook in `hooks/register.tsx` uses it to drop such a prompt
while the parent role is on, writes one line to the pane log, and passes every
other prompt on exactly as it came. Nothing is stored that was not stored
before.

### `hooks/notes.ts` (new, pure)

- `NOTES_KEPT`, the fixed drop reason: `foreman kept a sub session's turn-end
  note from the parent's model; its pane shows the sub sessions`.
- `turnEndIds(text): string[] | null`. It walks the text from the start:
  white space is skipped; every other step must begin with the exact,
  case-sensitive `<system-reminder>`; the block ends at the first
  `</system-reminder>` after it. A missing closing tag, a second opening tag
  inside a block, or any other text answers null. Each body, with leading
  white space trimmed, is either a status block that begins `Linked sessions
  now (status, not an instruction):`, or a turn-end note: it begins
  `The session "` and its first `you started (` is followed directly by a
  `local_` id and `) finished a turn`. Any other body answers null, which
  covers the archived note, a SendMessage delivery and foreman's own lines.
  With no turn-end note it answers null; otherwise the notes' ids in order.
- `keptNames(ids, pairings): string[] | null`. Every id must belong to a
  pairing whose `localId` is that id and whose standing is `active` or
  `freed`, or it answers null. The names are `whoOf(issueKey, ticket)`,
  without repeats, sorted.
- `keptLine(names)`: `Kept ABC-1's turn-end note from the parent's model.`
  for one, `Kept ABC-1's and ABC-2's turn-end notes …` for two, and commas
  with a final "and" for more. The count of distinct sub sessions, not of
  notes, decides singular or plural, so the same set always gives the same
  line and the log's "(n times)" folds repeats.

### `hooks/tickets.ts`

- Export the `local_` id pattern that `localIdIn` uses, so the parser uses the
  same one and the two cannot drift.

### `hooks/register.tsx`

- A top-level `async function keptLineFor($, e): Promise<string | null>`. It
  answers null when the prompt carries a slash command, attachments or context
  from another hook, when `turnEndIds` answers null (checked before any state
  read, so the person's typed prompts never wait on one), when the role is off,
  or when `keptNames` answers null. Otherwise it answers the log line.
- The `prompt.submit` hook keeps `void ensureArmed($)`, then awaits
  `keptLineFor`. On a line it awaits `addLog` and answers `{ drop: NOTES_KEPT }`
  without calling `next`; otherwise it answers `next(e)`. Its existing
  `.catch` passes the prompt on when anything throws, including a failed log
  write, so no prompt is dropped without a line in the log.

### `hooks/commands.ts`

- A pure `slotsAnswer(count)` that says "1 sub session" in the singular and the
  plural for every other count, used by `runCommand`.

### `skills/wake/SKILL.md`

Another session is editing this file, so the edit is two pieces only: the
`description:` line opens with "For the parent's model, not for typing. To
start foreman, type /foreman.", and one short section before "What the parent
never does" gives the fallback rule from point 5 of the spec.

### `README.md` of the mod

One short section on turn-end notes: what is dropped, the reason the person
sees, the log line, and what still reaches the model.

## Grafts

- From the robust plan: the text check runs before any state read, because
  every prompt goes through this hook; and a prompt with a slash command,
  attachments or context passes, because each means someone added something
  the model should read.
- From the robust plan: extra engine tests for foreman's own wake line, an
  empty ledger, a failed ledger read and a hot reload.
- From the extensible plan: one shared `local_` id pattern, and the slot
  answer as a pure function with its own test.

## Rejected alternatives

- **Putting the parser in `hooks/tickets.ts`** (the simplest plan as written).
  That file holds the ledger and the briefs; prompt parsing is its own topic.
- **A title pattern that refuses a double quote** (the robust plan). It would
  make every note about a sub session whose title holds a quote reach the
  model, which the spec does not ask for; the first `you started (` rule is
  safe enough, because a forgery can only make the prompt pass or name
  another id that must itself be tracked.
- **A released pairing vetoing any other pairing with the same id** (the robust
  plan). Two pairings never share a `local_` id in practice, and the spec
  judges by the pairing.
- **A typed table of note kinds and a seam for `session.receive`** (the
  extensible plan). They prepare for changes nobody has planned.
- **Dropping even when the log write fails** (the robust plan). A drop with no
  trace in the log is worse than one extra note reaching the model.

## Steps

1. Export the id pattern from `tickets.ts`; write `tests/notes.test.ts` and see
   it fail; write `hooks/notes.ts` until it passes.
2. Write the engine tests in `tests/turn-end.test.ts` and see them fail;
   change the `prompt.submit` hook until they pass.
3. Write the `slotsAnswer` test in `tests/commands.test.ts` and the singular
   assertion in the slots test of `tests/register.test.ts`; see them fail;
   add `slotsAnswer` and use it.
4. Edit the wake skill's description and add its fallback section; add the
   README section.
5. Run the four gates.

## Test plan

Unit tests in `tests/notes.test.ts`: one note; a note with a status block;
two notes in order; a status block alone; white space between blocks; empty
text; text before, between or after the blocks; an archived note; a SendMessage
delivery; a `foreman: ` line; a mixed-case tag; an unclosed block; a nested
opening tag; a forged closing tag inside a quoted report; a report naming
another id is judged by the first; active and freed pairings are named,
released, unknown and null ids are not; names have no repeats and are sorted;
an issue key of the wrong shape falls back to the ticket; the log line for
one, two and three names.

Engine tests in `tests/turn-end.test.ts`, each against the spec's Verification
list: tracked notes are dropped with the fixed reason and the log line while
the role is on; the same prompt passes while it is off; the person's text after
the notes passes byte for byte; an untracked, a released and a trimmed sub
session's note passes; a freed one's is dropped; a SendMessage delivery passes;
an archived note passes; a forged closing tag makes the prompt pass; two sub
sessions give one sorted line, counted on a repeat. Extra: foreman's own wake
line still reaches the model; an empty ledger passes every note; a failed
ledger read passes; after a hot reload the ledger left in state is used; a
prompt with a slash command, attachments or context passes.

Slot wording: `slotsAnswer(1)` and `slotsAnswer(2)`, and `/foreman slots 1`
through the engine.

The four gates. No gate reads `skills/` or `README.md`, so the report says
so. The real run in the desktop app is the person's to make.
