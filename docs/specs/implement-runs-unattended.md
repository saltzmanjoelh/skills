# An /implement session runs unattended

Written 2026-10-12.

## Goal

An `/implement` session should be able to run overnight with nobody at the
keyboard. Today two things stop it until a person comes back. The first is
a session that ended its turn believing it waits on something that will
never come, such as a check that never reports or a handover the mod
missed: the mod starts a turn only for a change on the pull request, so
nothing wakes it. The second is a usage window that runs out: the turn dies
on an API error, and nothing starts the next one once the window resets.
This change has the pilot mod start a turn in both cases. It also tests,
as far as a test can, that a resumed session finds the state it left, and
it rewraps the "Resuming" paragraph of `skills/implement/SKILL.md`.

## Users and trigger

A session running `/implement` with the pilot mod loaded, left alone. The
stuck prompt matters once its pull request is open and watched. The
usage-limit hold matters at any stage, from the spec interview to the
merge.

## Behavior

### The stuck prompt

1. The mod keeps the time the session last went quiet: the latest of the
   end of the session's own turn, the end of any of its subagents, a look
   that found the watched pull request changed, and the end of a
   usage-limit hold, so that a hold the person clears does not draw a
   stuck prompt at once.
2. When the session has been quiet for the current interval, the mod starts
   a turn whose prompt tells the session that nothing has happened for that
   long, that it should check with `gh` whether what it waits on is real,
   and that it should then take the first step of the list in
   `/implement` that applies, or end the turn if the wait is real.
3. It fires only when all of these hold at that moment: a pull request is
   watched and open; the session's own turn is not running; no subagent
   runs; no question the session asked with `AskUserQuestion` is
   unanswered; and no usage-limit hold is on. A `stuck` label on the pull
   request does not stop it. A condition that fails postpones the prompt:
   the mod looks again one interval later, and sooner when the end of a
   turn or of a subagent restarts the quiet time first. The mod reads the
   engine's list of agents before it decides, so an agent the engine has
   dropped cannot postpone the prompt for good.
4. The interval starts at 45 minutes and doubles after each stuck prompt:
   45, 90, 180 and 360 minutes, and then 360 minutes, which is the ceiling,
   every time after that. The turn a stuck prompt starts does not reset the
   interval; its end only restarts the quiet time.
5. The interval goes back to 45 minutes when a look finds the watched pull
   request changed, when a new pull request is watched, and when the person
   starts a turn. A prompt counts as the person's when its origin is
   `composer`, `bridge`, `slack-ping`, or `sdk` other than the desktop
   app's CI event, which the mod already tells apart by its text; a prompt
   the mod submits (origin `plugin`) and every other origin do not count.
   Answering a question is part of the session's turn and counts
   as the session going quiet again when that turn ends, not as a reset.

### The usage-limit hold

6. The hold starts when the session's own turn (a `turn.complete` with no
   `agentId`) ends with reason `error`, the session is running
   `/implement`, and either `$.session.usage().rateLimits` shows a window
   at 100 percent or more, or the `StopFailure` hook reported error
   `rate_limit` for that turn.
7. The session is running `/implement` when a pull request is watched, or
   the session has reported a stage with `mcp__pilot__progress`, and in
   either case its work has not ended. Work has ended when the pull request
   the mod last read for it is merged or closed, which is the same test by
   which the progress bar shows the work as finished.
8. The hold resumes one minute after the latest `resetsAt` among the
   windows at 100 percent or more. With no such window, or none with a
   `resetsAt`, it resumes 15 minutes after the turn ended.
9. While the hold is on, the line says `waiting on the usage limit until
    <time>`, with the time of the resume written in UTC as `/pilot wakes`
    writes its times, and the date before it when the resume is not on the
    same UTC day. The mod does not poll GitHub and no look runs, except a
    `/pilot poll` the person asks for, and the one read at the resume time.
    No stuck prompt fires.
10. At the resume time the mod clears the hold, reads the watched pull
    request once, and starts a turn only if the work has not ended. That
    read hands nothing over, and `/pilot wakes` lists it as `resume`; with
    nothing watched there is nothing to read. The turn tells the session
    that the usage limit has reset and that it should carry on from the
    stage it was in, and the mod then polls as it did before the hold. If
    that turn also dies on the limit, the hold starts again by the same
    rule, with a fresh resume time that replaces the old one. When a turn
    is already running at the resume time, the mod clears the hold without
    a prompt, because that turn's end decides again.
11. The person starting a turn during the hold clears it at once, without
    the resume turn. A turn of the session's own that ends with reason
    `answer` or `refusal`, whatever started it, clears it too, without the
    resume turn; one that ends `aborted` leaves it (see the section of
    `pilot-true-state.md` on a hold that outlives a clean turn). A hold that
    finds the work has ended by its resume time clears itself without
    starting a turn.

### The needs-decision label

12. A question the session asks while `needs-decision` is already on the
    pull request counts as labelled by the mod, so the mod takes the label
    off once no question is open. Today it does not, so a label left on
    by a session that was killed mid-question, and found again by the
    resumed session's question, is never taken off. The mod cannot tell
    who put the label on, so a label that a person or another tool put on
    also comes off once the session's question is answered, and this is
    accepted because the mod manages the label itself, as
    `skills/implement/SKILL.md` says.

### The skill

13. `skills/implement/SKILL.md` says, where it lists what starts a turn
    with the pull request open, that a stuck prompt enters the list from
    the top like any other, and, in step 5 and before, that a turn the mod
    starts after a usage limit carries on the stage it names.
14. The "Resuming" paragraph is rewrapped to the file's width, and it says
    that a usage-limit hold and the stuck prompt's interval do not survive
    a restart, so a resumed session starts with neither.

## Edge cases

- A quiet stretch that crosses a hot reload of the mod's hooks: the quiet
  time and the interval live in the mod's atoms, which survive a reload.
  The timers do not, and the mod arms them again from those atoms when its
  hooks next run, as it does for its poll.
- A look that found the pull request changed hands the change over and
  starts a turn as today; that turn is a change, not a stuck prompt, and
  resets the interval.
- Two signals at once: a stuck prompt due while a change is being handed
  over is dropped, because the handover's turn is the turn.
- A hold whose `resetsAt` is already past when the turn ends resumes one
  minute after the turn ended.
- A spend limit that reads past 100 percent with a `resetsAt` a month away
  holds until then; the person can clear it by starting a turn. That is
  longer than the engine's longest timer (2147483647 milliseconds, about
  24.8 days), so the mod waits in steps of at most six hours and checks
  the time at each step.
- A question left open all night keeps its `needs-decision` label all
  night, and no stuck prompt fires while it is open. A hot reload during
  the night is the exception: the mod already marks every open question
  answered when its hooks load again and takes the label off, because it
  can no longer see the call.
- A real restart starts the mod with none of its atoms, so it has no
  record of a question the killed session left open, and its label stays
  on. The resumed session asks again; with item 12 that question takes
  the label over, and the label comes off when it is answered.
- In the real engine an open question is asked inside the session's own
  turn, so the turn-running condition already covers it. The question
  condition stays, because it is the one that names the person.

## Non-goals

- Resuming after any API error other than an exhausted usage window, such
  as an overloaded or failing server.
- A usage-limit hold or stuck prompt in a session that is not running
  `/implement`.
- Keeping a hold or the stuck prompt's interval across a restart of the
  session.
- Proving in a test that a model follows the "Resuming" section: that part
  of the issue's item 3 is run by hand (see Verification).

## Failure modes

- The stuck prompt's or the resume's prompt is refused by the engine: the
  mod treats it as it treats a refused handover today, and tries again at
  the next interval or the next resume rule.
- `$.session.usage()` throws or answers no windows: the hold rests on the
  `StopFailure` signal alone, and resumes 15 minutes later.
- A wrongly set hold (a short throttle read as an exhausted window) costs
  at most 15 minutes, and the line says so with the time.

## Verification

Tests in `mods/pilot/tests`, each of which fails when the behavior it names
is removed:

- After a watch and 45 quiet minutes on the fake clock, exactly one stuck
  prompt is submitted; after its turn ends, the next comes 90 minutes
  later, then 180, then 360, then 360 again.
- No stuck prompt fires while a question is open, while a subagent runs,
  while the session's turn runs, or with no pull request watched; one with
  a `stuck` label does fire.
- A look that finds the pull request changed, and a prompt the person
  submits, both bring the interval back to 45 minutes.
- A question left open across twelve hours of polls keeps its
  `needs-decision` label and draws no stuck prompt.
- A restart over the same store (the mod's atoms back at their defaults,
  including the questions and the turn-running flag, then a watch) after
  a session was killed with a question open: the stuck prompt counts from
  the watch, and when the resumed session asks again and the question is
  answered, `needs-decision` comes off.
- A hot reload during a hold resumes once, at the original time, and one
  during a quiet stretch keeps the stuck prompt at its original time. The
  test kit has no call that reloads a module, so each of these tests loads
  the mod afresh, as every test does, over atoms seeded as a reload finds
  them: the watch, the quiet time and the interval, or the hold. The
  module's first arming then finds nothing armed and arms from those atoms.
  Separate tests check that a second session start during a quiet stretch
  or a hold neither moves nor doubles the stuck prompt or the resume.
- A refused stuck prompt is tried again one interval later without the
  interval doubling.
- A hold on a spend limit 30 days away has not resumed after 25 days and
  resumes 30 days and one minute after it began.
- A prompt with origin `sdk` that is not the CI event resets the interval
  and clears a hold, and one with origin `task-notification` does neither;
  the end of the turn that task notification started, with reason
  `answer`, does clear the hold (`pilot-true-state.md`).
- A turn that ends with reason `error` and a window at 100 percent with a
  `resetsAt` holds: the line shows `waiting on the usage limit until
  <time>`, no `gh` runs during the hold, and one resume prompt is
  submitted one minute after `resetsAt`.
- A turn that ends with reason `error` after a `StopFailure` of
  `rate_limit` and no window at 100 percent resumes 15 minutes later; a
  resume turn that dies the same way holds again.
- A turn that ends with reason `error` and neither signal does not hold,
  and neither does one in a session with no watch and no progress report,
  nor one whose watched pull request has merged.
- The person's prompt during a hold clears it with no resume prompt.

The four gates in `CLAUDE.md` run green.

By hand, after the merge, as a follow-up for the person, filed as its own
issue: in a repository with checks, kill an `/implement` session while it
waits on checks, start a new session in the same worktree with
`/implement --resume #N`, and confirm it enters the list at the right
step; confirm that passing `Max pushes per round` sets `stuck` and asks
once; and confirm that a question left open overnight still has its
`needs-decision` label in the morning. This pull request does not claim
that part as verified.

## Decided by the counsel

- Item 3 of the issue asks that /implement --resume be "tested end to end": kill a session while it waits on checks, start a new session in the same worktree with /implement --resume #N, and confirm it picks up at the right step; also confirm that hitting Max pushes per round sets stuck and asks once, and that a question left open overnight keeps its needs-decision label. This repository has no checks, and a session cannot kill and restart itself. What should this pull request do to satisfy item 3? The counsel chose Add mod tests that simulate a restart (a fresh engine over the same store, then a watch) to prove the mod's half, and write the manual procedure for the skill's half into the spec as a follow-up for the person., 6 of 6.
- Item 1 of the issue asks the pilot mod to start a turn telling the session to check with gh whether its wait is real, once 45 minutes pass with no change, no turn and no running agent, and no open question to the person. If the session checks, finds the wait is real (or finds nothing to do) and ends its turn again, how often may the stuck prompt fire after that? The counsel chose Backing off: 45 minutes, then 90, then 180, doubling up to a ceiling of 6 hours, and back to 45 after any change the mod sees on the pull request or a turn the person starts., 5 of 6.
- Item 2 of the issue asks the pilot mod, when the session's own turn ends with an error because a usage window is exhausted, to show "waiting on the usage limit until <time>", stop polling, and start a turn telling the session to continue once the window resets. The mod is loaded in every session, not only /implement ones. In which sessions should the hold start that continue turn? The counsel chose Whenever the session is running /implement: a pull request is watched, or the session has reported an /implement stage with mcp__pilot__progress, so a limit hit during the spec, plan or build also resumes., 6 of 6.
- Item 1 of the issue says the stuck prompt fires only when the session "is not waiting on the person". Today the mod counts the session as waiting on the person only while an AskUserQuestion it asked is unanswered. But skills/implement/SKILL.md also has the session set the `stuck` label and end its turn without an open question: for example after the person answered "no" to merging a head without checks, which leaves `stuck` and ends the turn until something changes. Should the `stuck` label on the watched pull request also count as waiting on the person, so the stuck prompt does not fire? The counsel chose No: only an open question counts; a `stuck` label still draws the backing-off stuck prompt, and the session, reading the label and the earlier answer, ends the turn again., 5 of 6.
- For the usage-limit hold, what should count as "the turn ended because a usage window is exhausted", and what should the mod do when it cannot read a reset time? The counsel chose Either signal: hold when the main-loop turn ended with reason 'error' and either a window reads 100 percent or more, or the StopFailure hook reported error 'rate_limit'. Resume one minute after the latest exhausted window's resetsAt; with no reset time, resume 15 minutes later, and hold again the same way if that continue turn also dies on the limit., 6 of 6.
