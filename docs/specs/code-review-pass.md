# /implement runs a /code-review pass once both verdicts approve

Written 2026-11-06, from the owner's issue asking that every pull request
`/implement` opens also gets Claude Code's built-in `/code-review` skill as one
more reviewer.

## The incident behind it

On projects where a second person reviews pull requests by hand, that person
runs `/code-review` against the pull request and posts its findings as review
comments. Those findings often arrive after the session's own reviewers have
approved, so each one costs another round and the person's time. Solo projects
never get that read at all. `/code-review` is a different reviewer from the
builder mod's six, with its own recipe, so running it before the merge catches
what the session's own reviewers miss, without waiting on a person.

## Goal

Once both verdict reviewers approve at a head, the session runs `/code-review`
at medium effort against that head, before any outside reviewer is asked and
before the merge. The first pass reads the whole pull request; each later pass
reads only what changed since the previous pass. Its findings go through the
claim checker and the scope rules exactly as the focused reviewers' findings
do. A pull request never merges from a head where both verdicts approve until
the pass has run there, or the person has said to merge without it.

## Users and trigger

A session running `/implement` with the builder mod watching its pull request.
The trigger is the mod's step chooser seeing both verdicts approve at the head
while the head carries no record of a pass or of a waiver.

## Behavior

### The record of a pass

- `mcp__builder__post_review` gains one optional input, `code_review`. It is
  either `{ since: "<full sha>" }`, the head the pass started from, or
  `{ since: "base" }` for a pass that read the whole pull request, or
  `{ waived: true }` when the person said to merge without the pass.
- When the input is given, the mod writes a second line under the `VERDICTS`
  line itself, `CODE-REVIEW <sha8> since=<sha8>`, `CODE-REVIEW <sha8>
  since=base` or `CODE-REVIEW <sha8> waived`, where the first sha is the head.
  The session never writes this line in the body.
- The mod refuses `code_review` when either verdict it is given is
  `REQUEST_CHANGES`, because the pass runs only at a head where both approve,
  and when `since` is neither `base` nor a full sha.
- The mod reads the marker only from reviews posted by the session's own
  login, only from the review's second line, and only when the review's
  commit is the head the marker names, the same way it reads the `VERDICTS`
  line today. The snapshot carries two facts: whether the head has a pass or a
  waiver, and the head to start the next pass from, which is the head of the
  newest pass marker (never a waiver) that is one of the pull request's
  commits, or none when there is no such marker.

### The step

- A new step, **Run the /code-review pass at this head**, comes after
  **The newest verdict at this head requests changes** and before every
  outside-reviewer step, so it is chosen whenever both verdicts approve at the
  head and the head has neither a pass nor a waiver. Failed checks, conflicts
  and the limits still come first, as they do for every step.
- The step gives `in-review`, because it is the session's turn.
- The step's text names the head and the head to start from, or says the pass
  reads the whole pull request, and points to the new skill section.

### The pass, in the skill

A new section, "The /code-review pass", under the review round:

1. The range is `<since>..<head>`, or, for the first pass,
   `<merge base>..<head>`, where the merge base comes from
   `git merge-base origin/<base> <head>`.
2. The session records `git status --porcelain` and `git rev-parse HEAD` in
   the worktree, then invokes the Skill tool itself with `code-review` and the
   args `medium <range>`, never with `--fix`, `--comment` or any other flag,
   then records both again. If either changed, it discards nothing, sets stuck
   with `mcp__builder__set_stuck` and asks the person.
3. If the skill is missing, errors, is stopped, or returns something that is
   not a list of findings, the session tries once more. If that fails too, it
   sets stuck and asks the person whether to merge without the pass, and
   records nothing at the head, so the step keeps asking for the pass until
   the person answers. When the person says to merge without it, the session
   posts a review with `code_review: { waived: true }`.
4. The session drops findings that repeat an earlier review's, gives every
   finding left to one `builder:claim-checker`, and treats the result as the
   first half's point 3 and point 4 do: it fixes every finding that survives
   and is in scope, and sends findings outside the spec to the counsel as
   `{ text, outside_spec: true }`, which may only file or drop them.
5. Before any fix is pushed, the session posts the record review at the head
   with `mcp__builder__post_review`, carrying both verdicts as they stand and
   `code_review` with the head the pass started from. Its body says that the
   `/code-review` pass ran, the range it read, each finding with the claim
   checker's verdict and what happens to it, and repeats the **Follow-ups**
   section of the review before it. Then it pushes the fixes, which make a new
   head that goes through a normal round, and whose pass later reads from this
   head. With nothing to fix, it posts the record review and calls
   `mcp__builder__watch`.

The section is added to the mod's list of skill sections that step texts point
to, and the mod's README lists the step.

## Edge cases

- **The head moves during the pass.** `post_review` refuses the record review,
  and the new head goes through a normal round. Its pass starts from the
  newest marked head, so nothing is skipped.
- **A force push removes a marked head.** That head is no longer one of the
  pull request's commits, so the next pass reads the whole pull request.
- **A waiver at an earlier head.** A waiver never becomes the start of a later
  pass, so the next pass starts from the last head a pass really read.
- **Someone else writes a `CODE-REVIEW` line,** or the session's own line
  names a head other than the review's commit. The mod ignores it.
- **The check after approval carries the verdicts over to a cheap-fix head.**
  Both verdicts then approve at that head, so the pass runs there. No pass
  ran at the approved head before it, because the cheap fix is pushed in
  the same turn as the round's review, so the pass reads from the last head
  a pass read, or the whole pull request when there is none.
- **An inert change only.** The pass still runs; the range is small.
- **A snapshot stored by an older build has neither fact.** It counts as no
  pass at the head, so the pass runs once more; the marker on the pull request
  is the real record.
- **A resumed session.** The marker is on the pull request, so a restart
  neither repeats nor skips a pass.

## Non-goals

- Any change to how outside reviewers are handled, or to `/pr-comments`,
  including how the session answers review comments other people leave.
- Posting the pass's findings anywhere except the session's own review through
  `post_review`; the pass never runs with `--comment` or `--fix`.
- Naming the pass on the package tool's `Focused reviewers to launch:` line,
  since the pass is not a package reviewer.
- Skipping the pass at a head whose change since the last pass is inert.
- Running `/code-review` at any effort other than medium, or before the
  verdicts approve.
- Any change to the check after approval or to the focused reviewers.

## Failure modes

- The skill is missing or fails twice: the pull request is stuck, the person
  is asked whether to merge without the pass, and nothing merges until they
  answer.
- The pass changes the worktree or moves `HEAD`: the pull request is stuck and
  the person is asked; nothing is discarded.
- The record review is refused because the head moved: the next turn runs the
  pass at the new head once its round approves.
- Fixes keep coming: the existing push and round limits stop the loop and name
  **Over a limit**.

## Verification

- Step chooser tests: both verdicts approve and no marker gives the new step
  with the start head; a pass marker or a waiver at the head moves on to the
  outside-reviewer and merge steps; a marker from another login, or one whose
  head is not the review's commit, is ignored; the start is the newest pass
  marker among the pull request's commits; a waiver is never the start; a
  marked head missing from the commits gives the whole pull request; changes
  requested still wins over the new step.
- `post_review` tests: it writes each of the three marker lines under the
  `VERDICTS` line, and refuses `code_review` with a `REQUEST_CHANGES` verdict
  or a malformed `since`.
- The step's text names the head and the start and points to a heading that
  exists in the skill, which the existing check of the skill's sections
  covers.
- The four gates in the project's `CLAUDE.md` pass.

## Decided by the counsel

- Where should the mod keep the record of which head the last /code-review pass looked at, so that the next pass reviews only the change since then and so that the step chooser knows whether the pass has run at the current head? The counsel chose: A marker line that the mod itself writes into a review the session posts at the head through mcp__builder__post_review (a new optional input saying the pass ran and which head it started from). The mod reads it back only from reviews posted by the session's own login, the same way it reads the VERDICTS line today, so it survives a restart and is visible on the pull request. 7 of 7 members voted for it.
- How should the session run the /code-review medium pass, and how does it make sure the pass only reports and changes nothing? The counsel chose: The session invokes the Skill tool itself with `code-review` and the args `medium <since>..<head>` (or `medium <head>`'s whole pull request range against the base for the first pass), never with --fix, --comment or any other flag. The skill already runs in its own separate context and hands back only its list of findings. Before and after, the session records `git status --porcelain` and `git rev-parse HEAD` in the worktree; if either changed, it discards nothing, sets stuck and asks the person. 6 of 7 members voted for it.
- After the claim checker has checked a /code-review pass's findings and their scope, which surviving in-scope findings does the session fix in the pull request (starting a new round), and which go to the counsel as follow-ups? The counsel chose: Treat them exactly like the focused reviewers' findings in the first half: fix every finding that survives and is in scope, in every round; findings outside the spec go to the counsel as follow-ups that may only be filed or dropped. The existing push and round limits stop a loop. 5 of 7 members voted for it.
- What should the session do when the /code-review pass cannot run or its result cannot be used: the Skill tool has no code-review skill (an older or different Claude Code), the skill errors or is stopped, or it returns something that is not a list of findings? The counsel chose: Try once more; if it fails again, set stuck with mcp__builder__set_stuck and ask the person whether to merge without the pass, recording nothing at the head, so the step keeps asking for the pass until the person answers. 6 of 7 members voted for it.
- What does this change deliberately leave out of scope, in particular whether the pass is skipped at an approved head whose only change since the last pass is inert (spec, plan or README lines, or whole-line comments in code)? The counsel chose: The pass runs at every head where both verdicts approve, inert changes included, and the change leaves out: any change to how outside reviewers are handled or to /pr-comments; posting the pass's findings anywhere except the session's own review through post_review; and naming the pass on the package tool's Focused reviewers to launch line, since the pass is not a package reviewer. 7 of 7 members voted for it.
