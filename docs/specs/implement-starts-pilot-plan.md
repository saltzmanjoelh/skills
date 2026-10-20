# Plan: /implement starts the pilot mod before it checks the issue

Spec: `docs/specs/implement-starts-pilot.md`. Written 2026-10-08.

## Chosen approach

The simplest plan won. One helper in `mods/pilot/hooks/register.tsx` makes
the existing `$.ui.open({ id: PANE, title: 'pilot' })` call and turns the
engine's answer into a sentence without a prefix. The new session tool
`mcp__pilot__open_pane` returns that sentence after `pilot: `, and the bare
`/pilot` command returns it as it is, because the host already names the mod
in front of a command's output (the same rule `/pilot watch` follows). The
skill's step 1 becomes an ordered list of five actions, the facts section
loses its sentence about when to speak, and Resuming begins by naming step
1's first two actions.

## Grafts from the other plans

- **The reply's wording, from the extensible plan.** When the pane waits,
  the reply reads: `The pane waits and is not drawn yet. The engine says:
  "<reason>" When the reason is the terminal's width, typing /pilot or
  widening the terminal shows it.` This says which remedy fits which reason
  without promising that `/pilot` works on every surface. The reason is
  quoted exactly as the engine gave it, with nothing trimmed.
- **Resuming names both actions, from the extensible plan.** It says "turn
  Remote Control on, then start the pilot mod with `mcp__pilot__open_pane`"
  rather than "the first two actions", because the owner's instructions
  forbid referring back by position.
- **A tool description that does not name `/implement`, from the
  extensible plan.** It matches the other five tools and keeps the mod
  generic, as the repository's hard rules require.
- **A `fakePanes(on)` test helper with a changeable answer, from the
  extensible plan.** It lets the test that compares `/pilot` with the tool
  run over both answers cleanly.
- **The facts section's first line is reworded, from the extensible plan,**
  to "The project's `CLAUDE.md` holds the facts below."
- **A repeated-call test, from the robust plan.** It pins the spec's edge
  case of a pane that is already open.

## Rejected alternatives

- **Catching a refused `$.ui.open`.** A `ui.open` hook in another plugin may
  refuse with `{ deny }`, which makes the call reject; the error would reach
  the `tool.call` hook's catch and the call would fail. Nothing in this
  repository refuses it and the spec does not name the case, so a catch
  would guard a hypothetical. If it is ever wanted, it is a spec change.
- **`isDeferred: false` on the new tool.** It is valid, but it would set this
  tool apart from its five siblings and cost prompt space on every turn. The
  skill's sentence telling the session to load the tool through ToolSearch
  before deciding it is missing does the same job.
- **Optional chaining on the engine's answer and trimming the reason.** The
  answer is a typed union, and trimming changes the words the spec says to
  quote exactly.
- **New skill branches for "the person refused the call" and "the pane did
  not open".** The spec did not decide these cases.
- **Registering the tool first.** If a later registration threw, the tool
  that proves the mod is loaded would exist while others did not.
  Registering it after `counsel_tally`, last, avoids that.

## Steps

1. **Tests first,** in `mods/pilot/tests/register.test.ts`, using
   `mock.clock`, `mock.store`, `engine`, `loose` and a new `fakePanes(on)`
   that answers `ui.open` beneath the mod and records each open:
   - the tool opens the pane with id `pilot` and title `pilot`;
   - the reply is `pilot: The pane is open.` when the engine places it;
   - the reply says the pane waits and holds the engine's reason exactly,
     and does not say it is open, when the engine answers `isPlaced: false`;
   - for each answer, the tool's reply equals `pilot: ` followed by
     `/pilot`'s reply, and `/pilot` never says `Pane opened.`;
   - a second call answers the same as the first;
   - a subagent's call is refused with `only the session`, and nothing
     opens.
   Run `claude plugin test .` and see them fail.
2. **The mod.** Add `OPEN_PANE_TOOL` to the constants and to
   `SESSION_TOOLS`; add the helper `openPane($)` beside `view()`; register
   `open_pane` after `counsel_tally` with no input schema; add its branch
   to the `tool.call` hook; make the subagent refusal and the hook's comment
   name the new tool; make bare `/pilot` return the helper's reply.
3. **The README.** A first row for `mcp__pilot__open_pane` in "What the
   session can call", and the `/pilot` row says it gives the same answer.
4. **The skill.** Delete "Say the base branch, the gates and the limits in
   one line before starting." and reword the facts section's first line;
   replace step 1's body with the ordered list of five actions, including
   the Remote Control failure sentence, the ToolSearch-then-stop rule for a
   missing tool, and the one-sentence repeat of a waiting reply; begin
   Resuming with the two named actions.
5. **Run all four gates.** No gate reads `skills/`, so the report says the
   skill text is checked only by the reviewers.

## Test plan

The tests in step 1 map one to one to the spec's Verification section, with
the repeated-call test added for the already-open edge case. The type check
confirms that narrowing on `isPlaced` reaches `reason`, and
`claude plugin validate` confirms the registration.
