# Plan: the counsel keeps every decision on record and words it cleanly

Date: 2026-10-14

Spec: `pilot-counsel-record-and-wording.md`.

## Chosen approach

Three planners competed: the simplest change, the most robust one and the
most extensible one. The judge chose the most robust plan, with four ideas
grafted from the other two.

The most robust plan won because it is the only one that closes a race in the
change prompt. `deliver` chooses the read to hand over twice: once before the
awaits that read `busy`, and again just before the submit. A look in "observe"
mode can store a newer read in between without holding `isDelivering`. The
other two plans read the owed decisions only when the read they saw before that
await was merged or closed. When a merged read arrives during the await, they
hand over "merged" with no decisions listed, and since polling stops once the
pull request is not open, nothing lists those decisions again unless the
session calls the watch tool. That is the loss the spec means by "A decision
can be written down nowhere". The chosen plan reads the owed decisions whatever
the state, after the `busy` block and before the read is chosen again, and
lists them only when the chosen read is merged or closed.

### What changes

- **`hooks/github.ts`.** A new `pullRequestStateIn(out)` parses the output of
  `gh pr view <n> --repo <repo> --json state` and returns `OPEN`, `MERGED` or
  `CLOSED` only when the JSON holds exactly one of those, and `null` for
  anything else: no output, text that is not JSON, a missing state or another
  state. It does not reuse `snapshotOf`'s mapping, which turns an unknown
  state into `OPEN`, because spec point 4 says an unknown state counts as not
  open.
- **`hooks/counsel.ts`.**
  - A private `withOneMark(option)` beside `decidedSentence` keeps the option
    as written when it ends in a full stop, a question mark or an exclamation
    mark, optionally followed by closing quotation marks or brackets, and
    otherwise adds a full stop.
  - `decidedSentence` returns "The counsel chose: <option> <n> of <m> members
    voted for it." `decisionLine` is unchanged, so the spec line and the
    review line follow.
  - A new exported `specRecordLines(lines)` gives the instruction to record
    lines in the spec under "Decided by the counsel", followed by the lines.
    The tally's answer and the owed list both use it, so the two cannot drift
    apart.
  - A new exported `endedDecisionLines(pr, state, lines)` words the decisions
    still owed to a pull request that merged or closed: one sentence saying no
    review will list them, then `specRecordLines`, then "Leave out any line
    the spec already has." It returns nothing for an empty list.
  - `counselAnswer` gains a fifth parameter, the pull request's state at the
    tally, of type `WatchedState` with a default of `'OPEN'`. Only the decided
    branch reads it. Open keeps today's line about the next review. Merged or
    closed says the pull request merged, or closed, before the tally. `null`
    says its state could not be read at the tally. The last three give the
    spec instruction and the line. The first line ends "tell the person in
    those words", because the sentence is now two sentences.
- **`hooks/prompts.ts`.** `changePrompt(s, changes, decisions = [])` takes
  finished lines and puts them after the state lines, so it knows nothing about
  the counsel.
- **`hooks/register.tsx`.**
  - `readPullRequestState($, target)` runs the `gh` command above from the
    session folder and returns `pullRequestStateIn` of its output. The `gh`
    helper already turns a failure, a throw, a timeout or cut-off output into
    `null`.
  - `owedSafely($, target)` is `owedDecisions` with a failure turned into an
    empty list, and `forgetListed($, owed)` deletes each listed key in its own
    `try`, so a failed delete stops nothing.
  - `serveTally`: for a decided round of a question with `pr`, it reads the
    state of the pull request the question stored, never the watched one,
    calls `oweDecision` only when it is `OPEN`, and passes the state to
    `counselAnswer`.
  - `deliver`: after the `busy` block and before the read is chosen again, it
    reads `owedSafely` for the watched pull request. After the guards, the
    decisions are listed only when the chosen read is merged or closed. A
    refused prompt returns as today and deletes nothing. An accepted prompt
    runs `tell` and then, in a `finally`, `forgetListed` for the decisions it
    listed. Nothing new is awaited between choosing the read and the submit.
  - `serveWatch`: when the read is merged or closed, it reads `owedSafely`,
    adds `endedDecisionLines` to the answer and then `forgetListed`. It reads
    nothing more for an open pull request.
  - `endedDecisionLines` is the only new name imported from `./counsel`.
    Pull request 47 rewrites that import line, so the rebase has a one-line
    conflict there, which is accepted.
- **`hooks/pane.tsx`.** `counselLines` writes "Without a vote:" in place of
  "Abstained:", and its comment says so.
- **Documents.** `pilot-counsel.md` (point 6, rule 7 of "Abstentions", rule 7
  of "Every member votes", rule 4 of "The owner's advocate", and a sentence
  saying lines written before 2026-10-14 keep the old shape), the pilot
  README (the counsel paragraph and the paragraph on what the store keeps)
  and the Questions section of `skills/implement/SKILL.md`.

## Grafts

- **From the simplest plan: the default `'OPEN'`.** The most robust plan
  defaulted the new parameter to `null` so that a forgotten argument would
  fail toward the spec. That forces an edit at `tests/counsel.test.ts:704`,
  which the follow-ups change's hunk uses as context, so the rebase would conflict.
  `serveTally` is the only caller in production, and the register tests prove
  it passes the state it read.
- **From the simplest plan: "tell the person in those words".** Spec point 9
  says so, and "that one sentence" is wrong for a line of two sentences.
- **From the most extensible plan: `specRecordLines` and "Leave out any line
  the spec already has."** One function gives the spec instruction for the
  tally's answer and for the owed list, so the line a question put without
  `pull_request` gets is literally the same code, and the duplicate edge case
  is covered in the words the session reads.
- **From the most extensible plan: `changePrompt` takes finished lines.**
  `prompts.ts` stays free of counsel logic.

## Rejected alternatives

- **Reading the owed decisions only when the earlier read was merged.** It
  leaves the race described above. Refusing the handover when the two reads
  differ would be worse, because with polling stopped the merge would never
  be handed over at all.
- **Deleting the listed keys before `tell`.** It puts awaits between the
  accepted submit and the told record, which `deliver`'s comments keep tight.
- **A fourth state value, `'unread'`.** `null` says the same thing and is the
  type the mod already uses for an unknown state.
- **Parsing `gh` output in `counsel.ts`.** Parsing GitHub's answers belongs in
  `github.ts`, beside `snapshotOf`.
- **Merging `withOneMark` with the follow-ups change's `sentence` helper.** That
  helper ends members' reasons; changing it would change the follow-ups
  change's behaviour. The two can be merged once both are on main.
- **Listing owed decisions in the desktop app's CI event context.** That event
  comes for a failed check or a merge conflict, not a merge, and the spec does
  not ask for it. The pull request names it as a gap.

## Step sequence

1. Write the failing tests for the decision sentence in
   `tests/counsel.test.ts`, then change `decidedSentence` and `counselAnswer`'s
   first line, and update the old literals in the counsel and register tests.
2. Write the failing pane tests, then change the label.
3. Write the failing tests for `pullRequestStateIn`, then add it.
4. Extend the fakes in `tests/register.test.ts`: a map of states by pull
   request number for `--json state`, with modes for failure, a throw, cut-off
   output, text that is not JSON and an unknown state; and `deletesRefused`
   and `keysRefused` switches on `memoryStore`.
5. Write the failing tally tests, then change `serveTally` and
   `counselAnswer`.
6. Write the failing change-prompt and watch tests, then change `changePrompt`,
   `deliver` and `serveWatch`, and add `endedDecisionLines`,
   `specRecordLines`, `owedSafely` and `forgetListed`.
7. Run the existing race tests around `deliver`. If the extra await breaks an
   exact interleaving, adjust the test's hold counts; the guards are checked
   again after the await, so the production behaviour holds.
8. Rebase onto the follow-ups change if it has merged, then edit the documents.
9. Run every gate.

## Test plan

Each item maps to the spec's Verification section, and each test fails when
its change is removed.

1. **Open.** A decided round with `pull_request: 7` and the state `OPEN`
   stores `counsel-owed:o/r#7:session-1:c1`, answers that the next review on
   o/r#7 lists it, and calls `gh pr view 7 --repo o/r --json state`.
2. **Merged and closed.** The same round with each state stores nothing and
   answers that o/r#7 merged, or closed, before the tally, with the spec
   instruction and the new line.
3. **Unknown.** The same round with a failure, a throw, cut-off output, text
   that is not JSON and `{"state":"DRAFT"}` stores nothing and answers that
   the state could not be read at the tally, without the words "merged" or
   "closed". Unit tests pin `pullRequestStateIn` on each input.
4. **The stored pull request.** With the question owed to #7 and the watch
   moved to #8, the tally reads #7 and never `--json state` for #8. A question
   without `pull_request`, and an undecided round, make no state read.
5. **The change prompt.**
   - With owed keys for o/r#7 from two sessions and one for o/r#70, a merged
     handover lists both o/r#7 lines and the instruction, deletes both o/r#7
     keys and keeps the o/r#70 key.
   - A refused prompt deletes nothing, and a later watch answer lists them.
   - A key stored while the list is read is neither listed nor deleted, and a
     later watch answer lists it.
   - A merged read stored by another look while `deliver` waits on `busy` is
     handed over with the owed decisions listed.
   - A refused delete still submits the prompt and records it as told; a
     refused `keys` call still submits the prompt, without decisions.
   - An open pull request with owed keys lists nothing and keeps them; a
     merged one with nothing owed has no instruction.
6. **The watch answer.** On merged and on closed it lists the owed decisions
   and deletes their keys; on open it lists nothing and keeps them, and does
   not read the keys. After a restart, a watch on the merged pull request
   lists a decision tallied before the merge.
7. **The sentence.** Options ending in a full stop, a question mark, an
   exclamation mark, a full stop inside straight or curly closing quotation
   marks, a full stop inside a bracket, and no mark; and options starting with
   a capital letter or with `gh`. None of the outputs contains "?.", ".." or
   "., ".
8. **The pane.** A round sent to the person and an old tally holding
   `abstain` votes list their members under "Without a vote:" and never under
   "Abstained:".

Then the four gates in `CLAUDE.md`. The documents are read by no gate, so the
reviewers check them.
