# Plan: the pilot line and pane show the true state

Spec: `pilot-true-state.md` (SAL-295). Written 2026-10-14 from a plan
tournament of three planners (simplest thing, most robust, most extensible)
and a judge. The simplest plan won; the grafts below come from the other two
and from the judge.

## Chosen approach

All code changes are in `mods/pilot/hooks/register.tsx` and
`mods/pilot/hooks/pane.tsx`, with tests in `mods/pilot/tests/register.test.ts`
and `mods/pilot/tests/pane.test.ts`. Nothing stored changes shape; the new
state is in memory and starts again at zero after a hot reload, which is safe
because every comparison only asks whether a number moved during one tick or
one save.

### The ticker race (spec items 1 and 2)

- A module counter, `backgroundWrites`, moves on each time a write of the
  background list answers successfully.
- One small helper, `wroteBackground(tasks)`, sets `backgroundIds` from the
  list a write answered with and moves the counter. `replaceBackground` and
  the writing branch of `removeBackground` both use it, so the two can never
  move apart. It does not call `ensureLive`; `replaceBackground` still does.
  The comment above `backgroundIds` says every writer goes through it. The
  read-only branch of `removeBackground` that fills the ids after a hot reload
  stays as it is and does not move the counter.
- `liveTick` captures the counter before its first read, does its three reads
  as today, and then, when the counter moved, returns at once: it neither sets
  the ids, nor changes `idleRead`, nor redraws, nor cancels. Otherwise it sets
  the ids from its read and decides as today. A comment says no await may come
  between that check and the decisions after it.
- A write that answers after a tick has cancelled the ticker restarts it
  through `replaceBackground`'s `ensureLive`, which now finds no ticker.

### The hold (spec items 3 to 5)

- `ownTurnsStarted` moves on as the first statement of `turn.start`.
- `repliedTurn` is set, synchronously and before any await in
  `turn.complete`'s own-turn branch, to `ownTurnsStarted` when the reason is
  `answer` or `refusal`.
- A new `repliedTurnClearsHold($)`, awaited in that branch for `answer` and
  `refusal` before the held handover and the turn-end looks, reads the hold.
  When the read fails it returns and touches no timer. When no hold is on it
  returns. Otherwise it calls `clearHold`, and when that clear is refused it
  calls `armHold` so the resume still comes.
- `turn.complete`'s own-turn branch captures `ownTurnsStarted` as its first
  statement, before any await, and that number rides through
  `errorTurnHolds`, `pendingErrorTurn`, `holdsFor` and `startHold` to
  `saveHoldOrTakeItOff`, which after the save keeps the hold only when the
  person's prompts have not moved and `repliedTurn` is not past that number.
  (The first version captured it at the save's own entry, which missed a turn
  that started and replied while the error turn's end was still deciding.)
- `aborted` and `error` take neither path; `error` goes on to
  `errorTurnHolds` as today. Nothing that refuses to start a hold changes.

### Round 1 in the pane (spec items 6 and 7)

- The finished round's tally and abstainer lines move into
  `tallyLines(options, tally, indent)`; the finished branch calls it with two
  spaces, so its output does not change.
- The rerun branch draws:

  ```
  c22 · round 2 · voting · Question 22?
    Round 1:
      Tally: 1. first way 2, 2. second way 2, no option 0, of 4 who took part
      Without a vote: <member> (<reason>)
      New in round 2: 3. third way
    Lean: <lean>
  ```

  Round 1's tally covers `q.options.slice(0, t.counts.length)`. The added
  options are `q.options.slice(t.counts.length)`, keep their numbers and carry
  no count, and the line is left out when there are none. The `Without a vote:`
  line appears only when a member had no vote.

### The output button (spec item 8)

- `MessagesReading` gains `answer: MessagesRead | null`, set when its read
  settles. Every read, whether the press or a draw started it, asks for a
  redraw when it settles, if it is still the cached read. `refreshOutput`
  stores its messages as an already-settled read.
- `showOutput` notes the number of reads started, writes `outputAgent`, then
  reuses the cached read when it is for the same agent and started after that
  number, and starts one otherwise, sets it as the cache, opens the pane and
  asks for a redraw. It no longer waits on the read, so the pane opens at once.
- The agent pane's render passes `outputCache.answer` (null until the read
  settles) to `agentPaneTree`, which already draws `Reading the messages.` for
  null, and starts a read when the cache is for another agent.

### The older specs and the README (spec item 9)

- `pilot-counsel.md` point 5: the round 2 pane, pointing to the new spec.
- `implement-runs-unattended.md` rule 11 and the `task-notification`
  verification line: a clean turn end clears a hold; the prompt alone does
  not.
- `pilot-finished-work-leaves.md` items 2 and 4: a tick whose reads a write
  overtook neither refreshes the ids nor stops.
- `mods/pilot/README.md`, the hold paragraph: a turn that ends with an answer
  or a refusal takes the hold off. No gate reads the README or `docs/`.

## Grafts, with why

1. From the robust and extensible plans: a failed read of the hold at a turn
   end touches no timer, and `armHold` runs only after `clearHold` is refused.
   `armHold` with no hold saved cancels the `after-clear` and `arm` retries in
   the hold's timer slot, so the winner's catch-all `armHold` could throw away
   a pending resume.
2. From the extensible plan, cut down: the `wroteBackground` helper, because
   the ids and the counter must always move together and the existing comment
   already asks every writer to refresh the ids.
3. From the robust plan: the comment forbidding an await between the counter
   check and the decisions, in the style `resumeAfterClear` already uses.
4. From the robust plan: edge-case tests for a second agent's press, a turn
   still running when the save lands, a Stop that empties the list during a
   held tick, and a removal landing during a held tick.
5. From the extensible plan: the README sentence, because the README lists
   what clears a hold and would otherwise be incomplete.
6. From the judge: the output button's reuse check and redraw-on-settle for
   every read, in place of a pressed-agent variable or a newer-read-wins rule.

## Rejected alternatives, with reasons

- Counting refused background writes (robust plan): a refused write leaves the
  stored list unchanged, so a tick that read around it read the truth.
- Threading a `{ personPrompts, turnStarts }` mark through `startHold`,
  `holdsFor` and `pendingErrorTurn` to refuse to start a hold (robust plan):
  refusing a hold touches what starts one, a non-goal. Review later found
  that a turn which starts and replies while an error turn's end is still
  deciding the hold left the hold on, so the number of turns started, counted
  at the very top of that end, now rides in `pendingErrorTurn` and through
  `holdsFor` and `startHold` for the take-off check after the save only. The
  extra refusals to start a hold stay rejected.
- `apiReplied` in `state.ts` and an `isHoldLiftedSince` predicate (extensible
  plan): generality for a two-value condition used in one place.
- Moving `ensureLive` into the background helper (extensible plan): it would
  make a removal start the ticker, a change nobody asked for.
- Putting the tally on the `Round 1:` line and dropping added options' numbers
  (robust plan): it breaks the spec's "exactly as a finished round draws it",
  and the numbers let the reader match an option to round 2's tally.
- A guard against a malformed stored `counts` (robust plan): no other code
  path guards stored tallies that way.
- A `pressedAgent` variable (robust plan) or a newer-read-wins rule
  (extensible plan): the reuse check does the same with less state, and
  newer-read-wins ignores which agent a read is for.

## Steps

1. Write the tests below, run them, and commit them once each is seen to fail
   on the code before this change.
2. The ticker: `backgroundWrites`, `wroteBackground`, the check in `liveTick`,
   the comments.
3. The hold: the two counters, `repliedTurnClearsHold`, the check in
   `saveHoldOrTakeItOff`, the comments.
4. The pane: `tallyLines` and the rerun branch.
5. The output button: the `answer` field, redraw on settle, the new
   `showOutput`, the render.
6. Adjust the existing tests named below.
7. The older specs and the README.
8. Run the four gates.

## Test plan

Spec verification, each seen to fail first:

- register: a tick's read of the background list held with
  `answerWaits(on, 'state.get', 'background')` while a Stop writes a task, at
  the tick that would otherwise stop the ticker (confirmed by counting reads):
  afterwards redraws continue, the line counts the task, and its notification
  row takes it off.
- register: a turn that starts and ends with `answer` while the hold's save is
  held (the `holdBeingSaved` fixture): once the save lands the hold is off,
  `gh pr view` runs, one stuck prompt comes, and no resume prompt.
- register: a saved hold, then a turn ending with `answer`; then `refusal`:
  the hold comes off with no resume prompt and the poll restarts. With
  `aborted`: the hold stays and its resume comes once. (`ownTurn` takes the
  four reasons.)
- register: a `task-notification` prompt during a hold leaves it on; that
  turn's end with `answer` takes it off.
- pane: a question in round 2 after a rerun draws the lines above exactly, and
  never shows an added option with a count; a second case with every member
  voting has no `Without a vote:` line.
- register: the output button pressed while the message read is held: the
  agent pane is open and a draw finishes showing `Reading the messages.`; once
  released, the messages are drawn and only one read was made.

Edge-case guards:

- A refused clear at a turn end keeps the hold, and its resume comes once.
- A turn still running when the save lands keeps the hold until it ends with
  `answer`.
- A Stop that empties the list during a held tick lets the ticker stop after
  its idle read.
- A removal landing during a held tick leaves the ids as the removal wrote
  them.
- A second agent's press while the first is shown switches at once to
  `Reading the messages.`.

Existing tests to adjust:

- Near line 7104, the refused take-off test whose `ownTurn($, 't2')` ends with
  `answer`: call `refuseClear()` again before that turn, so it also covers a
  refused clear at a turn end.
- The agent-pane tests that press and draw at once, and the shared-read test
  near line 5581: settle between the press and the draw, and assert the
  messages after the read is released.

Every test releases what it holds in a `finally`.
