# Plan: the /code-review pass once both verdicts approve

Written 2026-11-06 for `docs/specs/code-review-pass.md`, from a tournament of
three plans. The simplest-thing plan won, with three ideas grafted in from the
other two.

## Chosen approach

The pull request's reviews are the only record. The mod rebuilds every fact
from them at each look, the way it reads the `VERDICTS` line, so a restart, a
resumed or cleared session and a hot reload need nothing carried over. No new
files are added.

1. **Writing the marker.** `codeReviewLine(head, record)` in
   `mods/builder/hooks/review.ts`, beside `verdictsLine`, returns
   `CODE-REVIEW <sha8> since=<sha8>`, `CODE-REVIEW <sha8> since=base` or
   `CODE-REVIEW <sha8> waived`.
2. **Reading the marker.** `codeReviewOf(review)` in
   `mods/builder/hooks/github.ts`, beside `verdictsOf`, accepts a marker only
   when line 1 is a `VERDICTS` line that approves with both verdicts, line 2
   matches the marker exactly, and the review's commit sha starts with the
   marker's sha. It returns the review's full commit sha and whether the marker
   is a waiver.
3. **The snapshot.** `snapshotOf`, through its existing filter on the session's
   own login, sets `codeReviewed: true` when a pass or a waiver is at the head,
   and `codeReviewSince` to the full commit sha of the newest pass marker (never
   a waiver) that is among the pull request's commits. Both fields are left out
   when they do not apply, so a snapshot without them fingerprints as before.
   `mods/builder/types/index.d.ts` gains both as optional fields.
4. **News for the poll.** `fingerprintOf` adds a `code-reviewed` part only when
   `codeReviewed` is true, and `changesBetween` gives one sentence when a pass
   or a waiver appears at an unchanged head.
5. **The step.** `mods/builder/hooks/step.ts` gains
   `{ kind: 'code-review', head, since }`, chosen right after the line that
   returns `changes-requested` whenever `codeReviewed` is not true. `since` is
   used only when it is a full sha. `labelFor` gives `in-review`, `nameOf` gives
   "Run the /code-review pass at this head", and `textOf` names the head and the
   start, or says the pass reads the whole pull request from
   `git merge-base origin/<base> <head>`, and points to the skill's new
   paragraph. `SKILL_SECTIONS` gains `The /code-review pass`.
6. **The tool.** In `mods/builder/hooks/register.tsx`, the `post_review` schema
   gains `code_review`, either `{ since }` or `{ waived: true }`, and the tool's
   description says the mod writes the line. With `code_review` given,
   `serveReview` refuses either verdict being `REQUEST_CHANGES`, a `since` that
   is neither `base` nor a full sha, and an input with both keys or neither. It
   replaces the "a verdict review is already posted" refusal with two others:
   the head has no verdict review yet, so a record cannot stand in for a round,
   or the head already has a pass or a waiver. It writes the verdicts line, the
   marker line, a blank line and the body, and it skips `stampTiming`.
7. **The skill.** A paragraph headed `**The /code-review pass.**` in
   `skills/implement/SKILL.md`, after the paragraphs on the check after
   approval and before `### Updating the linked checkout`, holding the spec's
   five points. Its point 5 says to commit the fixes, then post the record
   review, then push, which is the spec's order and leaves the fixes in the
   worktree if a turn ends between the post and the push.
8. **The README.** `mods/builder/README.md` names the step, its place before
   the outside-reviewer steps, and its label.

## Grafts

- **From the most-robust plan: `verdictHeadOf` skips any review that carries a
  valid marker.** Without this, a record review posted at a cheap-fix head
  whose verdicts were carried over becomes the next round's verdict head, so
  the spec reviewer would never read the cheap-fix commit. That is the spec's
  own edge case about the check after approval. At a normally reviewed head the
  change makes no difference, because the round's own review has the same sha.
  The pull request description says why this touches code near the check after
  approval.
- **From the most-extensible plan: no timing stamp for a record review.**
  `afterReview` in `mods/builder/hooks/timing.ts` would otherwise log a
  carried-over round that never happened, and the timing ledger keeps it across
  a restart.
- **From the most-robust plan: a strict marker reader** that requires an
  approving `VERDICTS` line above the marker and takes the start from the
  review's full commit sha rather than from the `since` text, so git always gets
  a full sha.

## Rejected alternatives

- **A new `pass.ts` module, with `isFullSha` moved to avoid an import cycle**
  (most-extensible). It adds churn the feature does not need, and a nested
  snapshot field makes the fingerprint and the older-snapshot comparison
  harder to get right than two flat optional fields.
- **Skipping record reviews in the `earlierLines` lookup** (most-extensible).
  It would cut the record review to one line in the next package and lose the
  pass's findings, which the spec keeps by having the record repeat the
  **Follow-ups** section.
- **Showing both the round's review and the record review in the package**
  (most-robust). It changes the package tool, which the spec leaves alone.
- **Extra refusals in `post_review`**: verdicts that differ from the head's, a
  `since` not among the live commits, a second waiver (most-robust). The spec
  names exactly its refusals, and the commits check can misfire after a force
  push.
- **Extra skill procedure**: fetching first, requiring the worktree's `HEAD` to
  equal the step's head, falling back when `since` is not an ancestor, and
  retrying a failed post (most-robust). None of them is asked for by the spec.

## Steps

1. Write the failing tests named below and see them fail.
2. Add `codeReviewLine` and `codeReviewOf`, the snapshot fields, the
   fingerprint part and the change sentence.
3. Add the step, its label, name, text and section.
4. Change `post_review` and `serveReview`, and the `verdictHeadOf` skip.
5. Write the skill paragraph and the README lines.
6. Run the four gates.

## Test plan

Tests run with `claude plugin test .` from `mods/builder`.

- **Written first, `tests/step.test.ts`:** both verdicts approve with no marker
  gives the new step with `since` null; a pass marker and a waiver at the head
  each move on to the outside-reviewer and merge steps; a marker from another
  login, one whose sha is not the review's commit, one on line 1 or line 3, and
  one under a `REQUEST_CHANGES` verdict are ignored; the start is the newest
  pass marker among the commits; a waiver is never the start; a marked head
  missing from the commits gives null; changes requested and a failed check
  still come first; a snapshot without the fields gives the new step;
  `labelFor` gives `in-review`; the text names the head and the start; the
  step is in the list of every step, so the existing section test covers its
  pointer.
- **Written first, `tests/register.test.ts`:** `post_review` writes each of the
  three marker lines on line 2; it refuses `REQUEST_CHANGES`, a malformed
  `since`, both keys or neither, a head with no verdict review, and a second
  marker at the head; it accepts a record at an approved head; a second review
  without `code_review` is still refused; a record review adds no timing round.
- **`tests/review.test.ts`:** `codeReviewLine`; `verdictHeadOf` skips a record
  review at a carried-over head and gives the same answer as before at a
  normally reviewed head.
- **`tests/github.test.ts`:** `codeReviewOf`; the fingerprint is unchanged
  without a marker and changes when one appears; `changesBetween` gives its
  sentence.
- The four gates. They do not read the skill or the README, so the report says
  those were checked only by the reviewers.
