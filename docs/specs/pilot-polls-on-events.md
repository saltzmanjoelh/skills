# The pilot mod polls less where an event already says when a wait ends

Written 2026-10-09.

## Goal

The issue behind this spec asks the skills to react to events instead of
polling, starting with GitHub label changes. This pull request does the part
that this repository can do safely today. It lists every place the skills poll
and which pushed event, if any, ends each wait. It lengthens the one interval
whose wait is ended by a pushed event. It writes the list where the next person
to change an interval will find it. It builds no webhook receiver, because no
skill waits on a label change and a receiver is a new way into the machine;
that work, and the polling in an outside scheduler, go to their own issues.

## Users and trigger

A session running `/implement` with the pilot mod watching its pull request.
The change matters while the session waits on its own subagents, such as the
focused reviewers and the counsel, which is the longest wait in a review round.

## The polling, as of 2026-10-09

The skills themselves never poll; `/implement` says never to sleep or poll
inside a tool call. The pilot mod is the only thing in this repository that
reads GitHub on a timer. Every look runs one `gh pr view` of the watched pull
request.

| What the mod waits on | Interval before | Interval after | What ends the wait, and whether it is pushed |
|---|---|---|---|
| An unhanded-over new head | 90 seconds | 90 seconds | The head being handed over. Not pushed: GitHub tells the session nothing when its own push lands. |
| An open question to the person (`owner`) | 10 minutes | 10 minutes | The answer, which is pushed. The interval stays, because a poll during the question is what holds a change for the turn's end; without one, a change made meanwhile waits up to 10 more minutes after the answer. |
| A running subagent (`agents`) | 5 minutes | 10 minutes | The subagent's finish. A background subagent's finish starts a turn of the session's own; a foreground one's returns inside the turn already running. Either way a turn of the session's own ends afterwards. |
| Pending checks (`ci`) | 90 seconds | 90 seconds | A check passing is not pushed. A check failing is, by the desktop app's CI event. |
| A failed check (`fix`) | 90 seconds | 90 seconds | A rerun that fails the same way is not pushed. |
| `ready-to-merge` set (`merge`) | 90 seconds | 90 seconds | Checks finishing or the merge landing; not pushed. |
| Nothing (`nothing`) | 10 minutes | 10 minutes | Anything anyone else does, including a label change. Not pushed. |

Besides the timer, the mod looks about 10 and about 40 seconds after each of
the session's own turns ends, and after each push or merge the session runs.
It looks at once when the desktop app's CI event arrives, which covers a
failing check and a merge conflict. That event is the only pushed source the
mod has, and it stays the only one.

Outside this repository, an outside scheduler runs every five minutes. It is not
changed here.

## Behavior

1. `POLL_MS.agents` in `mods/pilot/hooks/state.ts` becomes 10 minutes, the
   same as `POLL_MS.nothing`. No other interval changes.
2. When a subagent finishes and the session's turn then ends, the looks at
   the turn's end recompute the next poll from the new state and bring it
   forward. With checks pending, the next poll is then 90 seconds away, not
   what is left of the 10 minutes. This already holds in the code; this pull
   request proves it with a test.
3. `mods/pilot/README.md` gains a short section listing each waiting state,
   its interval, and the event that ends the wait or why none is pushed. The
   prose in the README that already gives intervals is folded into that
   section rather than repeated beside it.
4. The comment above `POLL_MS` points at that README section, so whoever
   changes an interval updates the list.
5. Neither the README section nor this spec describes the outside scheduler's
   code, which lives in a private repository.

## Edge cases

- A subagent runs while checks are pending. `waitingOn` returns `agents`
  before it looks at the checks, so the checks are now polled every 10
  minutes instead of 5 while the subagent runs. A rerun of a failed check and
  a pending merge are also polled every 10 minutes while a subagent runs, for
  the same reason. A failing check still arrives at once through the desktop
  app's CI event. A passing check, a rerun's result and a merge are seen
  after the subagent finishes: a background subagent's finish starts a turn
  of the session's own, a foreground one's returns inside the turn already
  running, and either way the looks at the end of that turn work the
  interval out again, which is when the session can act on it.
- Several subagents run, and one finishes. The state stays `agents` until the
  last one finishes; each finish starts a turn whose end recomputes the poll.
- A subagent finishes while a poll is already due in under 10 minutes for
  another reason. A look that only observes never puts that poll off, which
  the existing test "a look that only observes never puts off a poll already
  due sooner, so a change it finds is not handed over late" in
  `mods/pilot/tests/register.test.ts` covers.

## Non-goals

- No webhook receiver, local or hosted, and no GitHub Actions workflow for
  label events. That becomes its own issue, to be built once a skill needs a
  label event and a receiver is chosen.
- No change to an outside scheduler. Listing and converting its polling becomes
  its own issue, in that scheduler's own project, where changes to `scripts/` need
  the owner's approval.
- No change to how labels are read or described; a label change is still
  handed over at the next poll.
- No test that reads the README.

## Failure modes

- If the looks at a turn's end ever stopped bringing the next poll forward,
  a session whose subagent finished with checks pending would see the check
  result up to 10 minutes late instead of 90 seconds. The test in
  Verification fails in that case.
- If someone changes an interval and forgets the README section, the README
  goes stale silently, because no gate reads it. The comment above `POLL_MS`
  is the only guard, and reviewers read README changes.

## Verification

1. In `mods/pilot/tests/state.test.ts`: `POLL_MS.agents` equals
   `POLL_MS.nothing`, and the assertion that the open-question interval is
   longer than the subagent interval becomes "not shorter". The new
   assertion fails before the change.
2. In `mods/pilot/tests/register.test.ts`, a test drives the real hooks with
   the mock clock and the fake GitHub. With a subagent running and checks
   pending, the next look is 10 minutes away. When the subagent finishes and
   the session's turn ends, the look at the turn's end brings the next poll
   forward to 90 seconds. The test is seen to fail when that look is made not
   to reschedule.
3. The four gates in the repository's `CLAUDE.md` pass.
4. The README section names every key of `POLL_MS` and the new-head interval,
   checked by the reviewers.
5. When the pull request merges, the issue behind this spec is marked done
   and two issues linked to it are filed: the label receiver, and the outside
   scheduler's polling.

## Decided by the counsel

- The issue behind this spec asks the skills to react to GitHub label changes (issues and pull_request events with action labeled or unlabeled) instead of polling. The desktop app's relay into a session covers only CI failures, merge conflicts and review comments, not labels. How should a label event reach a running session in this pull request? The counsel chose Do not build a webhook path in this pull request. Write the polling inventory into the spec, keep the existing desktop-app CI event as the one pushed source, lengthen the fallback intervals where an event already covers the state, and file the label receiver as its own issue once a receiver is chosen, since nothing in the skills waits on a person changing a label today., 6 of 6.
- For this spec, which of the pilot mod's poll intervals should this pull request lengthen, given that the pushed event must cover leaving the state? The counsel chose Lengthen only the interval while a subagent runs, from 5 to 10 minutes, the same as when nothing is pending. The subagent's finish arrives as a notification that starts a turn, and the look at that turn's end brings the next poll forward., 5 of 6.
- For this spec, where should the written list of every place the skills poll (what each polls, its interval, what it waits for, and which pushed event, if any, covers it) live? The counsel chose In the spec, and also as a short section in mods/pilot/README.md listing each waiting state, its interval and the event that covers it or why none does, with the comment above POLL_MS in state.ts pointing at that section., 4 of 6.
- The issue behind this spec also covers an outside five-minute scheduler and the label receiver, and this pull request does neither. When this pull request merges, what happens to those two parts? The counsel chose Mark the issue done when this pull request merges, and file two follow-up issues linked to it: one for a label receiver, to be built once a skill needs a label event and a receiver is chosen, and one to list and convert the polling in an outside scheduler, in that scheduler's own project., 6 of 6.
- For this spec, what tests should prove the change: the subagent poll interval going from 5 to 10 minutes, and the new README section listing what the mod polls? The counsel chose The unit tests of the first option, plus a test in register.test.ts that drives the real hooks: with a subagent running and checks pending, the next look is 10 minutes away; when the subagent finishes and the session's turn ends, the look at the turn's end brings the next poll forward to 90 seconds., 6 of 6.
