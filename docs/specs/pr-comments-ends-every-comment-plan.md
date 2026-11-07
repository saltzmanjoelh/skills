# Plan: every review comment ends, and no requested review waits forever

Written 2026-11-06 for `docs/specs/pr-comments-ends-every-comment.md`, from a
plan tournament between three planners: the simplest change, the most robust
change and the most extensible change. A judge compared them against the spec.

## Chosen approach

The simplest plan won. It has the two step kinds that the spec's Verification
section names, and it keeps nothing that a restart could lose except a cache of
repositories already known to have the label. Several ideas from the other two
plans are grafted onto it, as listed below.

Everything the step chooser needs is read at the look and stored on the
snapshot. The chooser stays a pure function of the snapshot, and its clock is
the time the look happened, so the tests get a fixed clock without a fake.

### The request time

- `OutsideReviewer` gains an optional `requestedAt`, and `Snapshot` gains an
  optional `lookedAt`, in `mods/builder/types/index.d.ts`. Both are optional,
  so a snapshot stored by an older build still reads, and the foreman mod's
  type check still compiles.
- `fetchSnapshot` in `register.tsx` reads `lookedAt` from `$.clock.now()`.
  When the pull request has a review request for a user other than the
  session's own login, it also reads the request times. They come from one
  GraphQL query for the newest 100 review-request events in the pull request's
  timeline, which runs in the same `Promise.all` as the other reads. With no
  such request, nothing extra is read.
- `requestTimesOf` in `github.ts` keeps the newest time for each lower-cased
  login, comparing with `Date.parse`. A read that fails or cannot be parsed
  gives no times, so no limit applies at that look.
- `outsideOf` sets `requestedAt` only on a reviewer in the Requested state.
  `outsideIn` and `snapshotIn` keep `requestedAt` and `lookedAt` when they read
  a stored snapshot, because `settleStateLabel` and `serveSetStuck` choose the
  step again from the stored snapshot and must agree with the look.

### The limits and the two steps

- `github.ts` gains `PICK_UP_MS` (ten minutes), `ARRIVAL_MS` (two hours) and
  the pure function `overdueOf(snapshot)`. It answers two lists of logins:
  `arrival` for reviewers still requested two hours after the request, and
  `pickUp` for reviewers still requested ten minutes after it while the pull
  request lacks `reviewer-working`. A reviewer with no readable time, or a
  snapshot with no `lookedAt`, is in neither list.
- `step.ts` gains the step kinds `review-not-picked-up` and
  `review-not-arrived`. In `chooseStep`, in the Requested branch that today
  gives `awaiting-review`, the arrival step comes first, then the pick-up
  step, then the waiting step. Feedback and Unrequested still come first.
- `labelFor` gives `stuck` for both. Their text names the reviewers and the
  limit that passed. It tells the session to ask the person in one question
  whether to ask for the review again or to leave it to them on GitHub. Asking
  again means `gh pr edit <n> --remove-reviewer <login>` and then
  `--add-reviewer <login>`, after which the session calls
  `mcp__builder__watch`. When the person has already said to keep waiting on
  this request, the session says so and ends the turn.
- `fingerprintOf` gains the part `overdue:<arrival logins>/<pick-up logins>`,
  only while both verdicts approve, with the same guard as `runs-unread`. So
  crossing the ten-minute limit starts one turn, and crossing the two-hour
  limit starts another even when the person said to keep waiting at ten
  minutes. `requestedAt` itself stays out of the fingerprint.
  `changesBetween` gains a sentence for a change in the overdue lists.

### The `reviewer-working` label

- `github.ts` gains `WORKING_LABEL`. It joins `WORKFLOW_LABELS` and stays out
  of `STATE_LABELS`, so the fingerprint ignores it.
- `step.ts` gains `labelsRemovedWith(stepLabel, kept, live)`. It answers the
  other state labels, as `otherStateLabelsOf` does, plus `reviewer-working`
  when the live read shows it and the label that follows from the step is not
  `waiting-on-reviewer`. The decision rests on the step's label, not on the
  label being put on, because the keep and record paths of `labelActionOf`
  put `stuck` on while the step can still give `waiting-on-reviewer`.
  `otherStateLabelsOf` itself is unchanged, so the `isStuckAloneInSnapshot`
  shortcut keeps working and the mod never fights a reviewer that put the
  label on.
- `labelActionOf`'s write, keep and record paths and `removeLabelsBeside`
  use the new helper. `LabelAction.remove` stays a list. A label is removed
  only when the live read saw it, because removing a label the repository
  lacks fails the whole edit. A failed removal saves no record, so the next
  look tries again.
- `ensureWorkingLabel` in `register.tsx` reads
  `gh api repos/<repo>/labels/reviewer-working`, creates the label with
  `gh label create` without `--force` when the read fails, and remembers the
  repository in a module-level set once the label is known to exist. The label
  queue runs it at each look whose step is `request-review`, `awaiting-review`
  or one of the two new steps, so a failed create is tried again at the next
  look.

### The rulings in `## Already decided`

- `servePackage` reads the review threads with one paginated GraphQL query,
  beside its other reads. Resolved threads are kept, because every ruled
  thread is resolved. A thread with more than 100 comments counts as a failed
  read.
- `rulingsOf(output, login)` in `review.ts` keeps a comment only when its
  author matches the session's login, ignoring case, and its first line,
  with leading spaces trimmed, starts with `Ruling:`. It answers null when the
  output cannot be parsed.
- `decidedItems` takes the rulings as a third argument and lists them after
  the commit and review items, with the source `thread at <path>:<line>`, the
  same cap and the same deduplication.
- `decidedSection` takes a flag for a failed read and then writes a line of
  its own saying the review threads could not be read. That line takes the
  place of `None yet.` when the list is empty.

### The skills

- `skills/pr-comments/SKILL.md`. Step 3 sends an invalid comment to the
  disproof in step 8 and defines a repeat. Step 8 becomes the disproof with
  `builder:bug-reproducer`, or a `general-purpose` agent without the mod, with
  its three outcomes. A new step covers a repeated rejection, the counsel, the
  `Ruling:` reply, a ruling against an outside reviewer who holds the merge,
  and a question with no answer. Step 9 also resolves ruled threads. Steps 10
  and 11 report each thread's ending.
- `skills/implement/SKILL.md`. The section on outside reviewers gains the two
  limits, the two steps, how to ask again and the label. The section on state
  labels lists the two steps among those that give `stuck` and describes
  `reviewer-working` beside `needs-decision`. The merge step names the check
  for open questions, and `mergeText` and `askMergeText` in `step.ts` gain the
  same sentence.
- `mods/builder/README.md` gains the new steps and the label.

## Grafts from the other plans

- **A separate removal helper that reads the step's label**, from the most
  robust plan. Extending `otherStateLabelsOf` would take `reviewer-working`
  off under a kept `stuck` judgement while the step still gives
  `waiting-on-reviewer`, and would stop the shortcut for a lone `stuck` label
  from ever applying, so the mod would remove the label at every look.
- **A GraphQL read of the newest 100 review-request events**, from the most
  robust and most extensible plans, in place of paging through the whole REST
  timeline every five minutes.
- **A set of missing label names in the test fake**, from the most robust
  plan. The fake's single `labelMissing` flag is cleared by any
  `gh label create`, so creating `reviewer-working` would break the existing
  test for creating a missing label.
- **Resolved threads kept in the thread read**, from the most robust plan.
- **A thread with too many comments counts as unread**, from the most
  extensible plan, so a partial read never looks whole.
- **An empty thread answer in the fake** for the existing package tests that
  expect `None yet.`, from the most robust plan.

## Rejected alternatives

- **GitHub's HTTP `Date` header as the clock** (most robust plan). It adds
  parsing and a fallback and competes with the fixed-clock tests, while clock
  drift on a desktop is small next to ten minutes.
- **Three read states for the decided section** (most robust plan). The spec
  asks only for a failed read to be told apart from an empty list.
- **A fingerprint part that names logins only** (most robust plan). Crossing
  the two-hour limit would start no turn after the person said to keep waiting
  at ten minutes, so nobody would be told.
- **One `review-overdue` step kind with a list of limits** (most extensible
  plan). It departs from the two steps that the spec names. Its limits
  parameter, its table of labels kept only under another label and its new
  threads module add extension points that nothing needs yet.
- **`gh label list --search`** (most extensible plan). It matches loosely and
  lists only 30 labels by default, while a read of the one label answers yes
  or no.
- **Removing a stray `reviewer-working` when no state label changes** (most
  extensible plan). The retry the spec asks for already happens, because a
  failed removal saves no record, and the spec does not ask the mod to remove
  the label where it sets no new state label.

## Known limits

- The mod looks every five minutes while a review is requested, so a stuck
  step can come up to five minutes after its limit passes.
- An older copy of the mod running at the same time counts
  `reviewer-working` as an ordinary label and may start turns that are not
  needed. The pull request description says so.
- A new commit after a ruling shifts the ruling's number in the next round,
  because the spec lists rulings after the commit items.

## Steps

1. Types: the optional `requestedAt` and `lookedAt`, read and kept by
   `outsideIn` and `snapshotIn`.
2. `github.ts`: the label constant, the limits, `requestTimesOf`,
   `overdueOf`, `outsideOf` and the fingerprint part, each test first.
3. `step.ts`: the two step kinds, their labels and text, `labelsRemovedWith`,
   `labelActionOf` and the merge text, each test first.
4. `review.ts`: `rulingsOf`, `decidedItems` and `decidedSection`, each test
   first.
5. `register.tsx`: the request-time read, `ensureWorkingLabel`, the label
   queue, `removeLabelsBeside` and the thread read in `servePackage`,
   with the fake made to track missing labels by name and to answer the two
   new reads.
6. The skill text and the README.
7. The gates.

## Test plan

- `review.test.ts`: a ruling by the session's login is listed with its file
  and line; a `Ruling:` comment by another login is not listed; a comment
  whose first line does not begin with `Ruling:` is not listed; ruling numbers
  run on from the commit and review items; a failed thread read gives its own
  line instead of `None yet.`; a long ruling holding Markdown is capped and
  printed on one line; output that cannot be parsed counts as a failed read.
- `step.test.ts`, with a fixed `lookedAt`: before ten minutes, the waiting
  step; after ten minutes without the label, the pick-up step; after ten
  minutes with the label, the waiting step; after two hours with the label,
  the arrival step; a request time that could not be read gives the waiting
  step; both new steps give `stuck`; the merge steps name the check for open
  questions.
- `step.test.ts`, for the label: setting `waiting-on-reviewer` keeps
  `reviewer-working`; setting any other state label removes it; a kept
  `stuck` judgement while the step gives `waiting-on-reviewer` keeps it; it
  is removed only when the live read saw it.
- `outside.test.ts`: `requestTimesOf` keeps the newest request for each login,
  so a new request after an earlier one counts from the new one;
  `reviewer-working` is a workflow label and not a state label; it leaves the
  fingerprint unchanged; crossing each limit changes the fingerprint; a
  stored snapshot keeps `requestedAt` and `lookedAt`.
- `register.test.ts`: the request step creates `reviewer-working` when the
  repository lacks it; a failed create is tried again at the next look; a
  failed removal of `reviewer-working` is tried again at the next look; a
  failed timeline read sets no `stuck`; the package lists a ruling read from
  the threads.
- The four gates, for both mods. No gate reads `skills/` or the README, so
  only the reviewers check those changes.
