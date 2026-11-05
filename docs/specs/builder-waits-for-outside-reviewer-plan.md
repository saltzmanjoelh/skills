# Plan: builder waits for an outside reviewer

The plan for `docs/specs/builder-waits-for-outside-reviewer.md`, chosen by a
plan tournament between a simplest plan, a most robust plan and a most
extensible plan, all three starting from an uncommitted draft of the feature.

## Chosen approach

The most robust plan won, trimmed. It was the only plan that found that the
pull request read reports a GitHub app's automatic review with a plain login,
so the draft would have counted the app as a reviewer who never approves and
left every pull request in such a repository at `stuck`. The counsel then
settled who holds the merge (see the spec's "Decided by the counsel"), which
removed the need for the robust plan's extra read of each author's type.

Every look rebuilds the outside reviewers from GitHub and the two `CLAUDE.md`
files. The mod keeps no new state beyond the snapshot it already stores, so a
restart, a resumed or cleared session, a hot reload and two copies running at
once add no edge cases.

- `PR_FIELDS` already asks for `reviewRequests`. The reviews it reads gain
  `authorAssociation`, which `gh pr view --json reviews` already returns.
- `outsideOf` puts a reviewer in the outside list when the fact names them,
  their review is requested now as a user, or their newest review that is not
  pending carries `OWNER`, `MEMBER` or `COLLABORATOR`. A dismissed newest
  review counts as no review and gives Unrequested.
- A new `othersOf` returns the other reviewers whose newest review that is not
  pending comments or requests changes, with that review's time. The snapshot
  keeps them as `others`, left out when empty, and the fingerprint and the
  change sentences cover them, so their review wakes the session.
- `outsideSentences` also says when a reviewer leaves the list.
- `chooseStep` keeps the draft's three steps and order. The request, waiting,
  merge and ask-merge texts name the other reviewers with comments and tell
  the session to address any comment with no answer yet through
  `/pr-comments` before merging, without asking them again. The Feedback step
  addresses them alongside the outside reviewers.
- The Feedback text gains the loop guard: when the watch names it again for
  the same reviewers with nothing pushed, set `stuck` and ask the person.
- The merge and ask-merge texts, which already fetch the base branch and read
  its `CLAUDE.md`, gain: when that file names a `Reviewer:` who has not
  approved, merge nothing and end the turn.
- `readBaseFacts`, `readUserClaude`, `reviewersOf`, the `reviewer` poll and the
  pane words stay as drafted.

## Grafts

- From the most extensible plan: a test that every existing `chooseStep`
  fixture with no outside reviewer chooses what it did before, and a solo
  fingerprint compared with a literal string, because together they prove that
  a solo project behaves exactly as before.
- From the most extensible plan: tests at the level of `register.tsx` for the
  facts read, through `CLAUDE_CONFIG_DIR` and `world.baseClaude`, because the
  new file reads are otherwise untested.
- From the most extensible plan: the `step.ts` header and the README list
  "logins that passed `isLogin`" among the values put into step texts, so that
  rule stays written down.
- From the most extensible plan: the Feedback guard's condition "with nothing
  pushed". The robust plan's wording would set `stuck` after a push that the
  session's own round then reviews.
- From the simplest plan: the three new steps in `EVERY_STEP` in
  `tests/step.test.ts` and in the label table, so the tests that read every
  step text cover the new ones, and its list of documents.

## Rejected alternatives

- **A REST read of each review author's type, with a hold step when it fails.**
  The association already in the read leaves out app reviewers and strangers,
  and the extra read adds a call to every look and a new way to block a merge.
- **Carrying the named reviewers from the stored snapshot when the base read
  fails.** That snapshot is saved under the session id, so the carry fails
  exactly when a session is cleared or resumed. The merge-time check of the
  fetched `CLAUDE.md` covers the same hole from a durable source.
- **An in-memory cache of which logins are bots.** It is state, and with the
  association rule there is nothing to cache.
- **Leaving out the pull request's author, a toast for a bad `Reviewer:` line,
  and a state line listing the outside reviewers.** Each adds size for little:
  the author is almost always the session's own login, and the change
  sentences and step texts already name the reviewers.
- **A new `hooks/outside.ts` module with seams for team reviewers, a round
  cap and a label moved by hand.** The spec makes two of those non-goals, and
  moving working code adds churn and an import loop between the modules.

## Steps

1. Tests first in `tests/outside.test.ts`: the association rule (an app review
   with `CONTRIBUTOR`, a stranger with `NONE`, a collaborator never asked, a
   requested reviewer who has reviewed), `othersOf`, the leaving sentence, the
   fingerprint with others, the other reviewers named in the request, waiting
   and merge texts, the Feedback guard, and the merge-time `Reviewer:` check.
   See them fail.
2. `types/index.d.ts`, `hooks/github.ts`: `authorAssociation` on a review,
   the association rule in `outsideOf`, `othersOf`, `Snapshot.others`, the
   fingerprint part, `othersIn`, and the sentences.
3. `hooks/step.ts`: carry the other reviewers into the request, waiting,
   merge and ask-merge steps and their texts, the Feedback guard, the
   merge-time check, and the header comment.
4. `tests/step.test.ts`, `tests/pane.test.ts`, `tests/register.test.ts`: the
   new steps in `EVERY_STEP` and the label table, the solo table and literal
   fingerprint, the pane words, and the facts read through the register.
5. `skills/implement/SKILL.md`: the `Reviewer:` row and the facts paragraph,
   the State labels sentence, and a section headed exactly
   "Outside reviewers". `mods/builder/README.md`: the poll bullet, the steps,
   the values in texts, the `Reviewer:` row, and the pane words.
6. Run the four gates for both mods.

## Test plan

Mapped to the spec's Verification section:

- The `Reviewer:` fact: `reviewersOf` unit tests (kept) and register tests for
  the project line, the user line, `none`, and an unreadable base file.
- The states: request, newest review, dismissed, teams, bots, the session's own
  login (kept), plus the association rule and the other reviewers.
- The steps: each step, the order and the labels (kept), plus `EVERY_STEP`,
  the solo table, the other reviewers in the texts, the Feedback guard and the
  merge-time check.
- The fingerprint and sentences: kept, plus the literal solo fingerprint, the
  other reviewers and the leaving sentence.
- The waiting state and poll: kept, plus the pane words.
- The gates: all four, for both mods. No gate reads `skills/`, `docs/` or the
  README, so the report says those were checked only by their reviewers.
