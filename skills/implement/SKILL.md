---
name: implement
description: One session per issue, from the issue to a merged pull request. Spec, plan tournament, build, verify, open the pull request, then drive it with the builder mod's reviewers until both verdicts approve and the checks are green, and merge it. Use when the user says "/implement <issue>", "implement this", or "/implement --resume #N" to pick up a pull request after a restart.
---

# Implement

One session takes one piece of work from the issue to a merged pull request.
It delegates as much as it can to agents, so it stays free to answer the
person and to react when the pull request changes. It needs the `builder`
mod: the mod watches the pull request, starts a turn when it changes, shows
the state in its pane, and owns the reviewer agents.

The person's part is the questions, in the spec interview or later, that
the counsel (the builder mod's six reviewers and its owner's advocate, seven
members voting) does not decide, and
the few questions that always go straight to them (see **Questions**). Everything else runs without them, so the session can be
left alone.

## Invocation

- `/implement <issue id or URL>` seeds the work from the issue tracker.
- `/implement <a sentence>` is the brief when there is no issue.
- `/implement --resume #N` picks up pull request N after a restart (see
  "Resuming").

## The project's facts

The project's `CLAUDE.md` holds the facts below. Each fact is one line,
`Label: value`, anywhere in it; each has a default.

| Fact | Default |
|---|---|
| `Base branch:` | `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name` |
| `Spec directory:` | `docs/specs/` |
| `Architecture document:` | `docs/architecture.md`, skipped if missing |
| `Gotchas document:` | `docs/gotchas.md`, skipped if missing |
| `Issue tracker:` | none; the argument is a sentence |
| `Worktree setup:` | none; a plain `git worktree add` |
| `Max pushes per round:` | 8 |
| `Max rounds:` | 5 |
| `Merge command:` | `gh pr merge <n> --merge --match-head-commit <sha>`; a project whose merges go through its own gate names that command, with `<n>` and `<sha>` in it |
| `Checks:` | `expected` when the base branch has files under `.github/workflows`, else `none`; a project whose checks report from an outside service writes `Checks: expected` |
| `## Gates` heading, one bullet per gate | detect from the manifests, confirm once, offer to write it |
| `## Hard rules` heading | none |

`Merge command:`, `Checks:`, `Max pushes per round:` and `Max rounds:`
govern how the pull request is merged, so read them from the base branch,
never from the branch under review: once the pull request exists, take the
base from GitHub (`gh pr view <n> --json baseRefName`), not from any
`Base branch:` line, and read `git show origin/<that base>:CLAUDE.md`. If the
branch changes any of these lines, or `Base branch:`, ask the person before
merging.

## Reporting the stage

The builder mod draws a progress bar above the prompt over the nine stages of
this skill, and the session tells it which stage it is in by calling
`mcp__builder__progress` with a `title` (the issue in a few words, such as
`ABC-123 short issue name`, the same for the whole issue), a `stage`, and,
when it helps, a `note` for a sub-step such as `round 2`. Report a stage on
entering it, not on finishing it:

| Stage | When |
|---|---|
| `grounding` | right after `mcp__builder__open_pane` in step 1 |
| `issue` | before the Explore check in step 2 |
| `spec` | at the start of step 3 |
| `plan` | at the start of step 4 |
| `build` | at the start of step 5 |
| `verify` | at the start of step 6 |
| `pr` | once the pull request is opened and watched in step 7 |
| `review` | when the first review round starts, with the round as the note on later ones |
| `merge` | when running the merge command |

The bar never moves back, so reporting `build` again while fixing a review
finding only changes the label. The mod marks the bar finished on its own
when it sees the pull request merged. A report is never a reason to stop or
wait; if the tool is refused, carry on.

## Before the pull request

When a usage limit stops a turn, the mod starts a turn once the limit
resets, and that turn carries on the stage it names. With the pull request
open, such a turn enters the list in "With the pull request open" from the
top.

### 1. Ground

Do these in this order, each one before the next. Checking the issue, in
step 2, comes after all of them.

1. Turn Remote Control on, with `set_remote_control` for `"self"`, so the
   person can follow and answer the session from another device. The
   person asked for this explicitly, so turning it on is their request. If
   it is refused, by a permission check or because the app reports it
   unavailable, say in one sentence, at that moment, that Remote Control is
   off and why, and carry on. The session works without it; only following
   it from another device is lost.
2. Start the builder mod by calling `mcp__builder__open_pane`, which opens the
   mod's pane. The tool may be deferred, so look for it with ToolSearch
   before deciding it is missing. If there is no such tool, the mod is not
   loaded: say so and stop, because watching the pull request and every
   reviewer depend on it. If the tool answers that the pane waits, say what
   it answered in one sentence and carry on. Then report the `grounding`
   stage (see "Reporting the stage").
3. Read the project's facts (see "The project's facts") and say the base
   branch, the gates and the limits in one line.
4. Work in a worktree, never in the repository's main checkout:
   `git worktree add .claude/worktrees/<slug> -b claude/<slug> origin/<base>`,
   then the project's worktree setup if it has one.
5. Read the architecture and gotchas documents if they exist.

### 2. Check the issue is still real

Launch one `Explore` agent to answer whether the issue is already done on the
base, or already open in another pull request, with file evidence. If it is
done, say so with the evidence, offer to comment on the issue, and stop. A
spec for finished work is worse than none. If the issue hinges on a product
choice nobody has made, ask (see "Questions") before going on. Once the
issue is read and checked, tell the person in two or three plain sentences
what it is about. Move the
issue to its in-progress state when the spec starts.

### 3. Spec, committed alone

Run `/spec`. Commit the spec file by itself, staged by path, before any
other file changes. A spec written after the code it describes is worse
than none, and the reviewers check the order.

### 4. Plan tournament, committed alone

Run `/plan-tournament`. Commit its plan file by itself too.

### 5. Build

Write each test the plan names first and see it fail before making it pass.
Where the plan has independent steps, give each to a `general-purpose`
agent working in this worktree, one at a time or on disjoint files; never
give such an agent `isolation: worktree`, because an isolated worktree starts
from the default branch, not from this branch. Follow the project's hard
rules. Commit in coherent steps with complete-sentence messages.

### 6. Verify

Run `/verify-loop` in a background agent. Report which gates ran with their
counts, and which did not and why. A gate that did not run is never green.

### 7. Open the pull request

Check the diff against the base lists only this change's files, check it
for credentials (see "Rules"), then push and open it with
`gh pr create --base <base>`. The body says what the change does and what
was measured, written once; history goes in the reviews, not the body. If
the project's `CLAUDE.md` says the body must begin with particular lines,
write them. Set the state label to `in-review` (see "State labels"), then
call `mcp__builder__watch` with the number, and go straight on into the list
below, from the top, in the same turn: the watch records the state at
opening as already told, so no turn may come for it. From here the pull
request drives the session.

## With the pull request open

On every turn that starts from the pull request's state (a turn the mod
starts, the mod's stuck prompt, the desktop app's CI event, a reviewer
finishing, or resuming), read the state from the mod's last report or
`mcp__builder__watch`, and take the first of these that applies. Decide from
the reviews, checks, commits and mergeability, never from the state labels,
which are for the person to read.

The mod sends the stuck prompt when the session has been quiet for a long
time with the pull request open. That turn enters the list from the top
like any other, after first checking with `gh` whether what the session
waits on is real; if the wait is real, the session ends the turn.

1. **Merged.** First update the linked checkout (see "Updating the
   linked checkout" below). Then move the issue to done. Then list the
   commits the worktree holds and the pull request lacks, as "Commits the
   pull request lacks" below says, before anything is filed. Then file at
   most one issue for the follow-ups. The list to file is the `To file:` list
   of the last verdict review, together with the `To file:` items of any
   cheap-fix commit that no verdict review lists, whether it is on the
   pull request or only in the worktree (see "Commits the pull request
   lacks" below). That list holds what the counsel decided to file,
   together with the fix decisions and the visible problems that the
   limit rule of the second half's point 4 moved there, what the person
   decided when the counsel could not sit, and items carried over from
   reviews posted before the counsel decided follow-ups. So nothing new
   reaches the issue tracker on the session's judgement alone, except a
   visible problem it meant to fix in this pull request and could not.
   Take the first of these that applies:
   - The last verdict review has no **Follow-ups** section, because a
     session that predates it posted the review: file nothing, and say in
     the report which review holds the follow-ups.
   - The list to file is empty: file nothing.
   - The project names no issue tracker and the session has none
     connected: file nothing, and say in the report that the list is in
     the last review.
   - A search of the issue tracker for the exact title
     `Follow-ups from <owner>/<name>#<n>`, with the repository's owner
     and name as GitHub gives them, finds an issue, because an earlier
     session filed it: file nothing.
   - The search fails: file nothing, and say so in the report, because
     filing twice is what this step exists to prevent.
   - Otherwise file one issue with that title in the issue tracker, with a
     link to the pull request, holding every item of the list, each in one
     sentence saying what a person would see.

   Then, when the worktree held commits the pull request lacks, do what
   "Commits the pull request lacks" says for a merged pull request, and
   stop. Otherwise run `/cleanup`, report, and stop.
   The person's request for `/implement` already counts as their agreement
   to the archive that ends `/cleanup`, whether they started this session
   directly or through a foreman parent session that they started, so never
   wait for, or ask for, a second agreement. When that archive, or the call
   that turns Remote Control off before it, is refused, do what step 7 of
   `/cleanup` says, and nothing more.
   **Closed without merging:** set `stuck`, say so, stop.
2. **An open question** to the person: wait for the answer.
3. **Over a limit.** Set `stuck`, ask the person once with a summary of
   what keeps failing, tell the session that started this one as
   **The line to the starting session** says, and wait, when either of
   these holds:
   - **Pushes:** more commits since the last changes-requested verdict
     than `Max pushes per round`. Before the first such verdict, count the
     commits committed after the pull request was opened, from
     `gh pr view <n> --json createdAt,commits`; commit dates only
     approximate when a commit was pushed, which is close enough for a
     limit.
   - **Rounds:** the round the mod reports ("Round N") is past
     `Max rounds`.
4. **Conflicting.** Merge the base in (never rebase), rerun the gates the
   merge could move, push.
5. **A check or a workflow run failed at the head.** What counts as a
   failed run is defined in the step **Both verdicts approve at this
   head**; a run can fail without registering any check. Read it with
   `gh run view <id> --log-failed`, or `gh run view <id>` for a run that
   failed before its first job, and establish why it is red before
   changing anything.
   - **The code is wrong**, including a workflow file that is broken and so
     failed at startup: fix it, set `waiting-on-author`, push. A run that
     failed at startup is never rerun; rerunning cannot fix its file.
   - **The check never really ran** (it was not scheduled, or it timed out
     waiting for a machine): if `gh run view <id> --json attempt` says
     this is its first attempt, rerun it with `gh run rerun <id> --failed`
     and end the turn; otherwise set `stuck` and ask the person.
   - **Something outside the code stopped it** (Actions is disabled, a
     billing or spending limit refused it, or it ended `action_required`,
     waiting for someone to approve it): neither a fix nor a rerun helps.
     Set `stuck` and ask the person.
6. **The focused reviewers have not run at this head.** Run a review
   round's first half (below), whether or not checks are still running.
   The focused reviewers run at every head that changes the pull request's
   own diff; a head that only merged the base in counts them as run if
   they ran at the head before it. A head that a review was carried over
   to, with the verdicts of the approved head before it (see the second
   half's point 6), counts them as run too.
7. **No verdict review at this head.** Run the review round's second half
   and post the review, whether or not checks are still running. A review
   carried over to this head from the approved head before it is this
   head's verdict review.
8. **The newest verdict at this head requests changes.** Fix its blocking
   findings, except those outside the spec and those the owner's answer
   dropped, in a commit that carries the fix lines (see "A review round"),
   set `waiting-on-author`, push. The push also carries the cheap fixes
   that the second half committed, and the next round reviews them. If it
   has no blocking finding left to fix, which should not happen (see the
   second half's point 3), set `stuck` and ask the person rather than wait
   for a change that will not come.
9. **Both verdicts approve at this head.** Waiting on checks happens here,
   and only here, so reviews and fixes never wait on them. Read the pull
   request again (`gh pr view <n> --json headRefOid,statusCheckRollup`) and
   every workflow run on the head, keeping only the fields this step uses:
   `gh api --paginate "repos/<repo>/actions/runs?head_sha=<head sha>"
   --jq '.workflow_runs[] | {id, workflow_id, event, run_number, status,
   conclusion, run_attempt}'` (`gh run list` stops at 20 runs). The step
   uses four definitions:
   - **When a run is replaced.** An older run is replaced, and stops
     counting, when any run of the same `workflow_id`, started by the same
     `event`, with a higher `run_number`, has not completed or did real
     work. Runs of one workflow from different events all count. A
     completed run did real work when its conclusion is not `skipped` and
     at least one of its jobs ended other than `skipped`, read with
     `gh api --paginate "repos/<repo>/actions/runs/<id>/jobs"
     --jq '.jobs[].conclusion'`. An empty jobs list, or a jobs read that
     fails, means the run did no real work. This holds whatever the older
     run ended as, cancelled, failed or passed. A run that did no real
     work replaces nothing and still counts itself by its own conclusion,
     so a run that skipped every job counts as passed. A newer run that
     has not completed replaces the older one only until it completes, and
     then this rule decides again. Read the jobs only for a completed run
     whose replacing of an older run is in question, so a head with one
     run per workflow and event reads no jobs.
   - **When a check passed.** A check counts as passed when it succeeded,
     or was skipped or neutral.
   - **When a run is unfinished.** A run is unfinished until its status is
     `completed`, whether it is queued, in progress, requested, waiting
     for an approval or pending in a concurrency group.
   - **When a run failed.** A completed run failed when its conclusion is
     anything other than success, skipped or neutral.

   For example, take a workflow that listens for `labeled`, skips its jobs
   on that action, and cancels pending runs through a concurrency group.
   Run #40, started by a push to the pull request, is cancelled before any
   of its jobs start, because setting `ready-to-merge` started run #41,
   which skipped every job. Both report `event: pull_request`. Run #41 did
   no real work, so it replaces nothing: #40 still counts, as failed, #41
   counts as passed, and the step reaches **A check failed, or a run
   failed**. The same holds when #40 failed rather than being cancelled.
   A push would move the head, so a later run on this head comes from
   another event of the same kind, such as closing and reopening the pull
   request. When that starts run #42 and it passes, #42 did real work and
   replaces both #40 and #41. While #42 is still running, it replaces them
   for now and is unfinished, so the step waits for it.

   Take the first of these cases that applies; where one says to start the
   list again, decide the list from this read, not from the mod's earlier
   report:
   - **The head moved:** set `in-review` and start the list again from
     **Merged**.
   - **A check failed, or a run failed:** set `waiting-on-author` and
     start the list again from **Merged**, which reaches **A check or a
     workflow run failed at the head**.
   - **A check is pending, or a run is unfinished:** set `ready-to-merge`,
     say "waiting on checks" and end the turn; the mod starts a turn when
     they finish.
   - **At least one check exists, and every check passed:** merge (below).
   - **No checks at all, with `Checks: none`:** merge.
   - **No checks at all, with `Checks: expected`:** nothing will change to
     start another turn, so the person decides whether to merge this head
     without checks. An answer covers the head and the set of workflow
     runs that this read found; it lapses when either changes. A session
     that restarts has no record of answers and asks again, which is the
     safe direction.
     - **They already said no to this head and these runs:** leave
       `stuck` as it is and end the turn.
     - **They already said yes to this head and these runs:** merge after
       **Read again before merging on a yes**.
     - **Otherwise,** ask. On a no, set `stuck`, say what it waits for,
       and end the turn. On a yes, merge after **Read again before
       merging on a yes**.

     **Read again before merging on a yes.** Read the pull request and its
     runs again, as above. Merge only if it is still this head with no
     checks, no unfinished run and no new run; otherwise take this step's
     cases again from **The head moved**.

   Before merging, when the worktree holds commits the pull request
   lacks, do not merge: do what "Commits the pull request lacks" says,
   and after a push go on as **When a turn ends** says.
   To merge, set `ready-to-merge` and run the merge command with the pull
   request's number and the head the verdicts approved. Never merge any
   other way: a project that names a gate means no session merges around
   it. If the command refuses, say why and wait.

**When a turn ends.** After any push, what follows depends on `Checks:`,
and either way **Over a limit** is checked after every push:

- **`Checks: expected`:** end the turn. The mod looks at the pull request
  about 10 seconds after the turn ends, which only shows it the new head;
  it hands the new head over at its next poll, 90 seconds after that look,
  so the next turn comes within about two minutes of the push and starts
  the list again from **Merged**.
- **`Checks: none`:** there are no checks to wait for, so do not wait for
  the mod to hand the push over: call `mcp__builder__watch` with the pull
  request's number, which reads the new state and records it as told.
  Then start the list again from **Merged** in the same turn. If the watch
  fails, or the head it reports is not the commit just pushed (GitHub has
  not shown the push yet), end the turn as under `Checks: expected`
  instead, and say why; the mod hands the new head over once it sees it.

After a review round's first half finds nothing to fix, and after its
second half posts the review without pushing, start the list again from
**Merged** in the same turn: the mod does not start a turn for a review
the session posted itself, and going through the list again is what
reaches **Both verdicts approve at this head** and the merge. When
nothing applies but waiting, say what the session waits on and end the
turn. Never sleep or poll inside a tool call.

### Commits the pull request lacks

The worktree can hold commits the pull request does not have: cheap fixes
whose push failed or never came, or a fix committed just before a restart.
Read the pull request's state and head with
`gh pr view <n> --json state,headRefOid`, fetch that head with
`git fetch origin pull/<n>/head`, since someone else may have moved it,
and list those commits with `git log <that head>..HEAD` in the worktree.
When the fetch, the listing or the ancestor check below fails, assume the
worktree holds commits the pull request lacks: set `stuck`, ask the
person, and never run `/cleanup`.

- A cheap-fix commit is the one whose first line is the one the second
  half's point 4 gives. Its message holds the round's
  `Fixed:`, `Dropped:` and `To file:` lists. No other commit carries
  lists, except that a commit fixing review findings may hold the
  `Dropped:` and `Outside the spec:` lists of the head it fixes. To find
  cheap-fix commits already on the pull request, look for that first line
  in `gh pr view <n> --json commits`.
- While the pull request is open and the newest verdict at its head
  requests changes, push nothing here: step 8 pushes the commits with the
  blocking fixes, so the next round reviews both together.
- Otherwise, while the pull request is open, push the commits when the
  head is an ancestor of the worktree's `HEAD`
  (`git merge-base --is-ancestor <head> HEAD`), checking for credentials
  as before any push. When it is not, or the push fails, set `stuck` and
  ask the person. Never force a push.
- Once the pull request is merged or closed, push nothing and do not run
  `/cleanup`: name the commits in the report, so a person can move them.
- The next review repeats the lists of a cheap-fix commit that no review
  lists, as it repeats an earlier review's.

### State labels

The pull request carries exactly one of `in-review`, `waiting-on-author`,
`ready-to-merge` and `stuck` at a time. Setting one removes the others
(`gh pr edit <n> --add-label <new> --remove-label <old>`), and a label the
repository lacks is created first with `gh label create <name>`. The mod
manages `needs-decision` itself; it is not a state label. The mod cannot
tell who put that label on, so a `needs-decision` label that a person or
another tool put on also comes off once the session's question is
answered.

### A review round

The rule for rounds: from round 3, a blocking finding must be classed
`REGRESSION:`, `SAFETY:` or `UNFIXED:`, and anything else is a
`FOLLOW-UP:`. A verdict reviewer that requests changes with no classed
finding is asked once more with that rule quoted; a second unclassed
request counts as follow-ups only.

The rule for scope: every finding, focused and verdict alike, carries a
`Scope:` line, either `in the spec` with the passage that asks for the
feature the finding is about, `breaks working behaviour` with what works on
the base branch and stops working at the head, or `outside the spec`, for a
finding that asks for behaviour the spec does not ask for and the base
branch does not have. A defect in code that the pull request adds to deliver
what the spec asks for is in the spec, even when the spec does not name the
protection that is missing. A finding that breaks working behaviour is in
scope, whatever the spec says, and so is a safety finding, which blocks as
before. A safety finding is any finding classed `SAFETY:`, any `[security]`
finding, and any other finding that describes a security hole (an
authorization boundary, injection, untrusted text reaching a shell or a
model as an instruction, a widened privilege), data loss or corruption, a
migration that cannot be undone safely, a credential exposed, a wrong deploy
to production, or a breach of a guarantee the project's `CLAUDE.md` names as
protected, whatever its label or the reviewer that raised it. The claim
checker checks every scope mark. A finding whose scope after the check is
outside the spec, or unsettled because the spec and the base cannot settle
it, and that is neither a safety finding nor one that breaks working
behaviour, is not fixed in this pull request, in either half, and does not
block; it is listed under `Outside the spec:` and becomes a follow-up for
the counsel (second half, point 4). Every later finding in an area that a
`Trend:` line closed counts as outside the spec too, unless it breaks
working behaviour or is a safety finding, which stays in scope as the rule
above says (see **A streak of 3** below). A finding that a `Tidied:` line
names a fix that changed what the code does is in the spec, whatever the
spec says (see "The fix lines" below).

The rule for repeats: the package's `## Already decided` section numbers the
findings that earlier rounds dropped or put outside the spec, as `D1`, `D2`
and so on. Before the claim checker, drop every finding that matches a
decided item and brings no evidence the item did not have, whether or not
the reviewer marked it with a `Repeats:` line, and list it under `Dropped:`
as a repeat of D<n>. A repeat with new evidence goes to the claim checker
like any finding.

The rule for owner questions: a finding whose claim holds only if the owner
works in a certain way, and that nothing the owner has written down settles
(see **Questions**), is neither fixed nor sent to the counsel. A finding
whose mechanism the claim checker refuted is dropped as before, and a cheap
follow-up is fixed as before. Every other such finding of the round goes to
the owner in one question. If the owner says the case happens, the finding
goes on as any other finding. If not, it is dropped and listed under
`Dropped:` with the owner's answer as its reason, which puts it in
`## Already decided`. A question about a safety finding says that it is one
and what would be lost. A hole that someone else could open, such as an
attacker or untrusted input, never depends on the owner's habits and never
goes to the owner.

The round's lists: every refuted, speculative and repeat finding is listed
under `Dropped:`, with the claim checker's reason or the item it repeats,
and so is every finding the owner's answer dropped, with that answer as its
reason. Every finding outside the spec is listed under `Outside the
spec:`. Both lists go in the fix commit of the head where the finding was
settled, or, when that head drew no fix commit, in the review posted at
that head. The package reads them from there to build `## Already
decided`, so write each list exactly so: the heading alone on its line,
then one line per item starting `- `, and a blank line after the last
item. An item repeated from an earlier list is copied word for word.

The fix lines: every commit that fixes review findings, in the first half's
point 4 or for a blocking verdict in step 8 of "With the pull request open",
carries the line `Reviewed: <head>`, naming the head the findings were
raised at, and one line for each area a fixed finding lies in, in the form
`<file>: <function or mechanism>`:

- `Area:` for a fix that changes what the code does. A change to an
  instruction file that Claude Code loads, such as a skill, an agent, a
  command or a mod, changes what a session does, so it is an `Area:` fix
  even though the file is Markdown. An `Area:` line counts toward the
  area's streak.
- `Tidied:` for a fix that only adds or changes tests, comments,
  documentation, names or wording, and changes nothing the code does. A
  `Tidied:` line neither lengthens nor breaks a streak.

A commit with fixes of both kinds carries both kinds of line. Reuse the
wording that the package's `## Areas fixed so far` gives an area already
named, because an area worded differently starts a new streak. A commit that
fixes only cheap follow-ups carries neither line. Write every value bare,
without backticks: the package reads a sha only from the value's first word,
and only when it has at least 7 hex characters and names exactly one commit
on the branch. Give `Reviewed:` the full head sha that the package tool's
answer gives; a value it cannot match keys a group of its own, which the
package lists.

A reviewer raises a `Tidied:` line on a fix that changed what the code does
as a finding in the spec. When the claim checker confirms it, the next
commit corrects the record with the line `Retag: <sha>: <area>`, naming the
mislabelled commit by the short sha that the `Tidied:` listing prints, or by
its full sha, and the area as its `Tidied:` line words it. The package then
reads that `Tidied:` line as an `Area:` line at its own commit's place, so
the streak comes out as if it had been labelled right. A confirmed mislabel
is fixed in this pull request in any round, and the rule for rounds does not
change: in the first half its `Retag:` line goes in the round's fix commit,
and in the second half it is a cheap fix at point 4, listed under `Fixed:`.
When the limit rule makes no commit, the `Retag:` line goes in the next
commit that is made, and until then the package keeps listing the `Tidied:`
line as not corrected. There is no line that turns an `Area:` line into a
`Tidied:` one.

**A streak of 3.** When the package tool's first line says an area's
streak has reached 3, launch no reviewer on that package. The stop always
happens, whatever the findings behind the streak were, safety findings and
findings that break working behaviour included, and the session never skips
it on its own judgement. Put to the counsel, with `pull_request`, whether to
keep going in that area, file the rest of the area's findings, or cut the
area out, naming the area, its streak and the findings fixed there, read
from the fix commits that name it. The question says that a later safety
finding in the area, or a later finding that breaks working behaviour,
stays in scope and blocking whatever the answer, so the answer governs only
the area's other later findings, and that cut it out removes the area's code
and any hole in it with the code. If the counsel does not decide, the person decides. Tell the session
that started this one, as **The line to the starting session** says.
Record the answer in a commit of its own with the line
`Trend: <area>: <keep going | file the rest | cut it out>`, made with
`git commit --allow-empty` when nothing else needs committing. For cut it
out, that commit also removes the code in the area that this pull request
added, and the gates that removal could move are rerun. Push it before any
reviewer runs and go on as **When a turn ends** says; the new head's first
half builds a new package. Keep going counts the area's streak from zero
after that commit. File the rest and cut it out close the area. A `Trend:`
line for one area changes nothing for any other, and its commit counts as a
push like any other.

**The line to the starting session.** When the session was started by
another session that it can message, such as the session whose brief
started it, it sends that session one short line whenever it puts a streak
of 3 to the counsel or asks the person about a limit under **Over a
limit**, whatever the counsel decides. The line names the issue and the
area or the limit, and says either that the session waits on the person's
answer or, when the counsel decided, what it decided.

**First half, at a head where the focused reviewers have not run** (**The
focused reviewers have not run at this head** says which heads those are).

1. Call `mcp__builder__package` with the issue in a few lines, the spec and
   plan paths, and the test summary line. It answers with the package
   folder and the full head. When its first line reports a streak of 3, do
   what **A streak of 3** says instead of going on.
2. In one message, launch `builder:security-reviewer`,
   `builder:maintainability-reviewer`, `builder:performance-reviewer` and
   `builder:data-reviewer`, each with "Review package: <folder>. Head:
   <full sha>." Never with `isolation: worktree`: they read this worktree,
   and the mod refuses them any tool that changes it. Each agent's report
   arrives as its own message once it finishes; wait for all four before
   going on.
3. Merge findings that describe the same problem into one, naming every
   reviewer that raised it, and drop the repeats as the rule for repeats
   says. Number every finding left and give them all, with the package
   folder and the head, to one `builder:claim-checker`, saying which are
   marked `Needs checking: yes`; it checks the claim of those and the scope
   of every one. Drop what it refutes and what it answers speculative,
   never making a code change for either. Set aside every finding whose
   scope is outside the spec or unsettled, unless it is a safety finding or
   breaks working behaviour. A finding that the rule for owner questions
   sends to the owner is neither dropped as speculative nor set aside; it
   waits on the owner's answer.
4. Fix every finding left. Mechanical fixes can go to an implementation
   agent. Commit with the fix lines and the round's lists, rerun the gates
   the fixes could move, push, and go on as **When a turn ends** says for a
   push: end the turn under `Checks: expected`, or re-read with
   `mcp__builder__watch` and start the list again under `Checks: none`.
5. With nothing to fix, start the list again from **Merged** in the same
   turn (see "When a turn ends"). The head's lists then go in its review.

**Second half, once the focused reviewers found nothing to fix at the head.**

1. In one message, launch `builder:spec-reviewer` and
   `builder:adversarial-reviewer` with "Review package: <folder>. Head:
   <full sha>. This is the round package.md states." Every head that
   drew a verdict review was a round, whichever way it went.
2. Drop the repeats as the rule for repeats says, and give every finding
   left to one `builder:claim-checker`, as the first half's point 3 does.
   Drop what it refutes, and set aside every finding whose scope is outside
   the spec or unsettled, unless it is a safety finding or breaks working
   behaviour, or the rule for owner questions sends it to the owner.
3. Settle each reviewer's verdict. Take it from its `VERDICT:` line,
   except that a `REQUEST_CHANGES` whose blocking findings the claim
   checker all refuted or the owner's answer dropped, or that the rule for
   rounds turns into follow-ups, or whose surviving blocking findings are
   all outside the spec, counts as `APPROVE`, and the review says so and
   why. Otherwise the pull request would wait on a change nobody has to
   make. The points below use the verdicts settled here.
4. Sort every `FOLLOW-UP:` that survived, including those point 3 turned
   into follow-ups, into one of three kinds. A follow-up with no
   `If never fixed:` part counts as `If never fixed: nothing visible`,
   unless the finding plainly describes a visible failure. A finding
   outside the spec, blocking or not, is always for the counsel, however
   cheap, and so is every item listed under `Outside the spec:` at this
   head or at an earlier head since the last review.
   - **Cheap:** wording in specs, plans, comments and the README,
     rewrapping, renames, and small test tightening. Fix it in this pull
     request. A visible problem small enough to fix is fixed in this pull
     request too, like a cheap one.
   - **Speculative:** a follow-up the claim checker answered speculative,
     or could not confirm, except a finding the rule for owner questions
     sends to the owner. Change nothing for it, file nothing, and list it
     as dropped, because a vote to fix or file it would act on a claim
     nobody verified.
   - **For the counsel:** every other follow-up, whether it describes
     something a person could run into (a wrong result, a stall, a
     misleading message, lost work) or is marked `nothing visible`. The
     session does not decide these itself; the counsel decides whether
     each is fixed in this pull request, filed as an issue or dropped.

   An earlier review on this pull request that has no **Follow-ups**
   section, because a session that predates it posted the review, has its
   `FOLLOW-UP:` lines sorted here too, so that they reach this review's
   lists.

   Only follow-ups the counsel has not yet decided go to it. Which ones
   those are is read from the **Follow-ups** sections of the earlier
   reviews on this pull request, and from the lists in any
   `Fix this round's cheap follow-ups` commit that no review lists, never
   from the session's memory, so that a resumed session does not put a
   decided follow-up to the counsel again. An item listed under `Fixed:`,
   `To file:` or `Dropped:` in one of those is decided, including an item
   of a review posted before the counsel decided follow-ups, whose sort
   stands as it was made. An item listed under `Undecided:` or
   `Outside the spec:` is not.
   - **A verdict requests changes:** the counsel does not sit. List every
     follow-up for the counsel that it has not yet decided under
     `Undecided:` in this round's review, so that the next round in which
     both verdicts approve puts it to the counsel. An item outside the spec
     keeps its scope there, ending with the words "outside the spec", so
     that it reaches the counsel as outside the spec.
   - **Both verdicts approve and no follow-up is left to decide:** the
     counsel does not sit.
   - **Both verdicts approve and follow-ups are left to decide:** put every
     one of them to the counsel in a single call, or in several when more
     than twenty are left, before this round's review is posted, as
     "Follow-ups questions" under **Questions** says.
     Then act on each follow-up's decision. A follow-up the counsel decided
     to fix is fixed together with the cheap ones. A follow-up it decided
     to file goes in `To file:`. A follow-up it decided to drop goes in
     `Dropped:` with the counsel's reason, and is filed nowhere. A
     follow-up the counsel did not decide, because no option had 4 of the
     7 votes, goes in `Dropped:` with its tally and the words "the counsel
     did not decide", and is filed nowhere.

   When committing the fixes would take the pull request past
   `Max rounds` or `Max pushes per round`, counted as **Over a limit**
   counts them, and nothing else in this round needs a push, make no
   commit. List every cheap follow-up as dropped, renames and rewrapping
   included as well as wording and test tightening, because none of them
   is worth a push past the limit. The one exception is a visible problem
   the session meant to fix: list it as to file, so that it is not
   dropped on the session's judgement alone. List the follow-ups the
   counsel decided to fix as to file too, because the counsel judged them
   worth doing.

   Otherwise commit the fixes, the cheap ones and those the counsel decided
   to fix, in one commit, staged by path, and do not push yet. Its first
   line is `Fix this round's cheap follow-ups`, and its message holds this
   round's lists, as point 6 describes them, with each of the counsel's
   decisions, its count and its reason, so that a session resumed before
   the review is posted can still put them on the record and does not put
   the same follow-ups to the counsel again.

   An owner's answer that no commit has yet put in the spec (see
   **Questions**) counts as a cheap fix in both cases above: this commit
   is made for it even when nothing else needs fixing, and when the limit
   rule makes no commit, the answer is listed under `To file:` rather than
   dropped, so that the follow-up issue carries it into a spec.
5. The round's review is always posted at the reviewed head. Choose what
   follows it:
   - **A verdict requests changes:** push nothing here. Step 8 pushes
     point 4's commit with the blocking fixes.
   - **Both approve and point 4 committed nothing:** nothing follows.
   - **Both approve and every line the commit changed is inert** (defined
     below): push, then post at the new head a short review whose
     verdicts are carried over from the approved head, in the form point
     6 gives.
   - **Both approve and any changed line is not inert:** push, and the new
     head goes through a normal round.

   The fixes the counsel decided on are part of point 4's commit, so their
   lines are judged by the same rule as the cheap ones.

   Read the changed lines with
   `git diff --unified=0 <reviewed head> HEAD`, and the files added,
   deleted or renamed, mode changes and binary files with
   `git diff --summary --numstat <reviewed head> HEAD`. The first command
   shows each line without its surroundings, so read every changed line
   that looks like a comment in the file at the new head, with the lines
   around it, and count a line that cannot be placed for certain as not
   inert. A changed line is inert when it is one of these:
   - a line in a Markdown file under the spec directory (its specs and
     plans), or in `README.md` at the repository's root, where the spec
     directory is read from the base branch, as the merge facts are, so
     that a pull request cannot widen it;
   - a whole-line comment in a code file, which is a line that, after its
     indentation, begins with `//` in JavaScript, TypeScript or Swift, or
     with `#` in Python, shell or YAML.

   These are never inert:
   - block comments (`/*`, `*` and `*/` lines), because a `/*` line above
     unchanged code and a `*/` line below it would switch that code off;
   - a comment that shares a line with code, and text inside a string, a
     heredoc, a template literal or a YAML block scalar;
   - a comment directly after a line that ends in a backslash, because
     the shell joins the two lines and the comment swallows the rest of
     the command;
   - a comment that instructs a tool, such as `#!`, `@ts-`, `eslint-`,
     `/// <reference`, `# type:`, `# noqa`, `swiftlint:` or a line that
     declares the file's encoding;
   - every line of a file that Claude Code loads as instructions (skills,
     agents, commands, plugins and mods), comments included, because a
     model reads those as instructions, so rewording them can change what
     a session does;
   - a Markdown line that a gate, a test, a build or another tool in the
     project reads, includes or runs, such as a fenced code block that a
     doctest runs, and any Markdown line the session cannot be sure no
     tool reads that way;
   - a file that is added, deleted or renamed, a change of file mode, and a
     binary file, because the whole file is new, gone, moved or not text,
     whatever its lines say.
6. Post the review at the reviewed head, then do what point 5 chose. Call
   `mcp__builder__post_review` with the head and the verdicts point 3
   settled. The body has: each distinct surviving finding once, naming the
   reviewers that raised it; the focused reviewers that ran, what they
   found and what was fixed in which commit; this head's findings outside
   the spec, under `Outside the spec:`; and a section headed **Follow-ups**
   with four lists:
   `Fixed:`, each item with its commit; `Undecided:`, each with one or two
   sentences on what it is and what a person would see if it is never
   fixed, which holds items only in a round where a verdict requests
   changes; `Dropped:`, each with one sentence on why, including the
   refuted, speculative and repeat findings of this head and of earlier
   heads since the last review, which those heads' fix commits hold in
   their `Dropped:` lists; and `To file:`, each with one sentence on
   what a person would see. An empty list says `None.`. Every list is
   written as the round's lists say.

   An item the counsel decided says so, with the count and the counsel's
   one-line reason, such as "The counsel decided to file it, 5 of 7:
   <reason>." An item the counsel did not decide is listed under
   `Dropped:` with the words "the counsel did not decide", its tally, and
   any members without a vote. The dropped and to-file items of every
   earlier review, and the fixed items the counsel decided, are repeated,
   each naming the review it came from, so the last review before the
   merge holds every follow-up and every decision the counsel made on
   one. An earlier review's `Undecided:` items are not repeated as they
   were: each appears in this review's `Undecided:` list again, or in the
   list its decision put it in. One review per round,
   in complete sentences. It is the pull request's history; nothing else
   is.
   - A review carried over to a new head opens with "Both verdicts are
     carried over from <full sha>, which both verdict reviewers read.",
     lists each commit and file since that head, and repeats the
     **Follow-ups** section of the review before it. If the tool refuses
     it because the head moved again, or the turn ends before it is
     posted, the new head goes through a normal round, and the round's
     record is safe in the review at the reviewed head.
   - If a push fails, do what "Commits the pull request lacks" says: the
     review would otherwise list fixes that never reached the pull
     request.
7. After a push, go on as **When a turn ends** says. Otherwise start the
   list again from **Merged** in the same turn.

### Updating the linked checkout

The **Merged** step does this first, before anything else. Skills, agents
and the builder mod load through symlinks under `~/.claude` into a
repository's main checkout, not from this worktree, so a session started a
moment after the merge runs whatever that checkout holds. The session
otherwise never works in a main checkout; here it only fast-forwards one.
Read the base and the merge commit with
`gh pr view <n> --json baseRefName,mergeCommit`.

1. **Find the linked checkouts.** Look in `~/.claude/skills`,
   `~/.claude/agents` and `~/.claude/commands`, skipping any of them that
   does not exist. When one of those folders is itself a symlink, as when
   `~/.claude/skills` links to a checkout's `skills` folder, resolve it
   with `realpath` and treat its target as one more link. Test for that
   with `test -L` on the folder's path written without a trailing slash,
   since a trailing slash follows the link. Then resolve every symlink
   directly inside each folder with `realpath`, listing them with
   `find <folder>/ -mindepth 1 -maxdepth 1 -type l`, where the trailing
   slash makes `find` look inside a folder that is itself a link. Use each
   target when it is a folder, or the folder holding it when it is a file
   (the links under `agents` point at files). Run
   `git -C <folder> rev-parse --path-format=absolute --git-common-dir --show-toplevel`,
   which prints the shared git folder and then the tree the link actually
   lies in. The main checkout is the parent of the shared git folder. A
   target that exists but is not inside a git repository points into no
   checkout and is skipped. A link whose target does not exist is broken;
   when that link is one of the three folders, nothing inside it can be
   listed. Keep the tree each link lies in for step 2, and look at each
   checkout once, however many links lead into it.
   - When none of the three folders is a symlink and none holds one, the
     outcome is **no links found**, and steps 2 to 7 do not run. It is not
     a failure. A broken link is still a link, so a broken link alone does
     not make the outcome no links found.
2. **Match the merged repository.** In each checkout, run
   `gh repo view --json nameWithOwner --jq .nameWithOwner`. A checkout
   that prints the pull request's owner and name is one to update. When
   more than one does (two clones of the same repository), each goes
   through steps 3 to 7 on its own and gets its own outcome in the report.
   - When none matches, the outcome is **not linked**, which means that
     links exist and none of them leads into the merged repository. A
     broken link or a lookup that failed makes it a failure instead, since
     the broken link or the failed checkout might have been the match.
   - When one matched, a broken link or a lookup that failed elsewhere is
     named in one sentence and does not stop the update.
   - A link of the merged repository whose tree is not the main checkout
     lies in a worktree, which sessions load instead of
     the main checkout. A worktree is someone's branch, so it is never
     moved. It is not a failure either: the report names it, and says that
     sessions loading through it still run the worktree's code. The main
     checkout is still updated when a link leads into it. When every link
     of the merged repository lies in a worktree, no session loads the main
     checkout, so it is not moved and the outcome is **only worktrees
     linked**.
3. **Check the base, and whether anything needs to move.** Read the
   merged repository's address and default branch with
   `gh repo view <owner>/<name> --json url,defaultBranchRef`, naming the
   repository so that `gh` does not pick one from a checkout's remotes.
   When the base is not the default branch, the outcome is **nothing to
   update**: the main checkout stays on the default branch, which the
   merge did not touch, and someone who has another branch out there must
   not have it moved. If the checkout is on the base and
   `git -C <checkout> merge-base --is-ancestor <merge commit> HEAD`
   already succeeds, nothing needs to move, and the outcome is **updated**
   whatever steps 4 and 5 then do. They still run, so that the checkout's
   remote-tracking branch for the base is current even when an earlier
   update fetched by address, and steps 6 and 7 do not.
4. **Choose where to fetch from.** List the checkout's remotes with
   `git -C <checkout> remote`, and read each one's address with
   `git -C <checkout> remote get-url <remote>`, which applies any
   `insteadOf` rewrite in git's configuration, so the address is the one
   git really fetches from. A remote names the merged repository when its
   address, with any trailing slashes and then a trailing `.git` removed,
   ends in `/<owner>/<name>` or `:<owner>/<name>`, compared without regard
   to case. That covers an https address
   (`https://github.com/owner/name.git`), an ssh address in the short form
   (`git@github.com:owner/name.git`, including one through a host alias
   such as `git@github-work:owner/name`) and an `ssh://` address, so a
   machine that reaches GitHub only over ssh fetches the way it already
   does. The slash or colon before the owner is part of the match, so that
   a fork whose owner's name merely ends in the same letters does not
   match.
   - When one remote names it, that remote is the source.
   - When several do, the source is the remote the base tracks, read with
     `git -C <checkout> config branch.<base>.remote`, if it is one of them;
     otherwise the one named `origin`, if it is one of them; otherwise the
     first of them when their names are sorted byte by byte, as
     `LC_ALL=C sort` sorts them.
   - When none does, as when the repository was renamed and the remote
     still names its old name, the source is the address that step 3 read
     from `gh`.
5. **Fetch the merge commit, and check it arrived whole.** With a remote
   as the source, fetch the merge commit and the base in one command,
   without writing `FETCH_HEAD`, passing the remote's name and the second
   refspec each as one quoted argument:
   `git -C <checkout> fetch --no-write-fetch-head "<remote>" <merge commit> "+refs/heads/<base>:refs/remotes/<remote>/<base>"`.
   The second refspec brings the remote's base into the checkout's
   remote-tracking branch for it. It is there so that after the update
   `git status` in the checkout does not say the checkout is ahead of its
   remote, which reads like work nobody pushed, so do not drop it as
   noise. When the base has moved on past the merge commit, the checkout
   shows behind its remote afterwards, which is true. With the address as
   the source, fetch only the commit,
   `git -C <checkout> fetch --no-write-fetch-head <url> <merge commit>`,
   which leaves the remote-tracking branch alone. Fetching from one
   source means an unreachable extra remote cannot hold the step up, and
   leaving `FETCH_HEAD` alone means a `git pull` someone runs in the
   checkout at that moment cannot read and merge this commit.
   - When step 3 found nothing to move, the outcome is **updated**, and
     this step only refreshes the remote-tracking branch. With a remote as
     the source, run the fetch and stop here; if it exited with an error,
     the report adds one sentence quoting git's message and saying that
     the checkout may show ahead of its remote until its next fetch. With
     the address as the source, skip the fetch and stop here, since the
     address has no remote-tracking branch to bring up to date.
   - Otherwise, whether the merge commit and everything it points to
     arrived decides whether the update goes on, not how the fetch
     exited. Check it in this order:
     1. `git -C <checkout> cat-file -e <merge commit>^{commit}` must
        succeed. A fetch can exit with an error after the commit
        arrived, for example when another fetch in the same checkout
        holds the lock on the remote-tracking branch. The checks then go
        on, and the report adds one sentence quoting the fetch's message
        and saying that the remote-tracking branch may not have moved, so
        the checkout may show ahead of its remote until its next fetch.
     2. Read the two snapshots to compare, the merge commit's top folder
        and the checkout's, with
        `git -C <checkout> log -1 --format=%T <merge commit>` and
        `git -C <checkout> log -1 --format=%T HEAD`. They are read from
        the commits rather than written as `<merge commit>^{tree}`,
        because a partial clone may not hold the folder itself, and
        comparing snapshots rather than histories also catches a file
        the merge takes back to a version an older commit had. Below,
        the first hash is called `<merge tree>` and the second
        `<head tree>`.
     3. In a partial clone, which leaves files or folders on the server
        until they are needed, the object check below would download each
        missing one in a fetch of its own, one round trip per file. So,
        only to save that time, list what is missing without downloading
        it,
        `git -C <checkout> rev-list --objects --quiet --missing=print <merge tree> --not <head tree>`,
        which prints each missing object's hash after a `?`; `--quiet`
        keeps the objects that are present out of the output, so do not
        drop it. When it
        exits successfully and prints nothing, nothing is missing, so
        the object check in sub-step 4 has passed and need not run;
        this is always the case in a full clone. When it lists any,
        fetch them all in one request from the same source, passing the
        hashes without their `?` on standard input to
        `git -C <checkout> -c "remote.<source>.partialclonefilter=blob:none" -c fetch.negotiationAlgorithm=noop fetch --no-write-fetch-head --no-tags --stdin "<source>"`,
        where `<source>` is the remote's name, or the address when the
        source is the address; git reads the setting under either.
        Then list again, and repeat the listing and the fetch until the
        listing prints nothing, three rounds at most.
        - The fetch passes no `--filter`, because an explicit filter
          makes git record the source as a partial-clone source in the
          checkout's settings. The `partialclonefilter` set with `-c`
          applies to this one fetch and writes nothing to the checkout's
          settings.
        - The filter is `blob:none` so that a missing
          folder arrives with the folders inside it but without their
          files, and the next listing names only the files the merge
          needs. Without it, a clone that left its folders on the server
          downloads the whole snapshot for a small merge (531 objects for
          a merge of 3 files in review, against 34 with the filter, over
          2 rounds). A clone that left only files on the server finishes
          in one round.
     4. The object check,
        `git -C <checkout> rev-list --objects --quiet --missing=error <merge tree> --not <head tree>`,
        runs in every case except the one sub-step 3 names, an empty and
        successful listing:
        - when the listing printed hashes, it runs after the batched
          fetch;
        - when the listing itself failed, it runs without a batched
          fetch;
        - when the batched fetch exits with an error, its message does
          not decide anything; the object check runs and decides.

        It must succeed. It fails when something the merge brings is still
        missing and cannot be downloaded, before anything is written. It
        must come before the fast-forward, because a fast-forward that
        meets a missing file rewrites and deletes files before it fails,
        leaving the checkout half updated.

   Fetch before the next step, so nothing slow sits between its checks
   and the fast-forward.
6. **Check it is safe, and fast-forward, in one shell command.** It must
   find `git -C <checkout> branch --show-current` printing the base and
   `git -C <checkout> status --porcelain --untracked-files=no` printing
   nothing, then run
   `git -C <checkout> merge --ff-only --no-overwrite-ignore <merge commit>`,
   and say which check stopped it if one did.
   - A checkout on another branch, with a detached `HEAD`, or with changes
     to tracked files is never moved, because someone may have it out.
   - Untracked and ignored files do not stop it: the fast-forward leaves
     them alone, and refuses when it would overwrite one
     (`--no-overwrite-ignore` makes it refuse for an ignored file too,
     which git otherwise replaces). So the fast-forward destroys nothing,
     which is why this is looser than `/cleanup`'s rule, written for
     deleting a worktree.
   - Name the merge commit rather than running a bare `pull --ff-only`,
     which moves the branch to whatever it tracks, and that can be a fork
     or another branch. Never create a merge commit, rebase, reset or
     force a checkout.
   - When the fast-forward fails because `index.lock` exists, another
     session's update is probably running in the same checkout: run this
     whole step once more, checks included, and treat a second failure as
     a failure. That is the only retry.
7. **Confirm.** `git -C <checkout> branch --show-current` still prints the
   base, and
   `git -C <checkout> merge-base --is-ancestor <merge commit> HEAD`
   succeeds. The branch check catches someone checking out a branch in the
   instant around the fast-forward. The fast-forward may have moved that
   branch or not, depending on the moment, so the report offers no commit
   to put it back to: it names the branch and says that
   `git -C <checkout> reflog -2 <branch>` shows whether a fast-forward
   moved it and, if so, from where. Nothing is reset.

**When it fails.** These are the failures:

- a broken link or a failed lookup when no checkout matched (step 2);
- a merge commit that the fetch did not bring, or that arrived without
  everything it points to (step 5);
- a check that stops it, or a fast-forward that refuses, after the one
  retry for a lock (step 6);
- a confirmation that fails (step 7).

**No links found** is not a failure, and neither is a fetch that exits
with an error after the merge commit arrived. On any failure, leave the
checkout alone. Never force it. Do not retry, except for the one retry
after a lock that step 6 describes. Then carry on with the issue, the
follow-up issue and `/cleanup`.

**The report** says one of these, and adds the worktree links that step 2
names and the sentences that step 5 adds. Every message it quotes from
git or gh is first checked for credentials, as before a push.

- **Updated,** after step 7, or from step 3 when the checkout already held
  the merge: the checkout's path, the merge commit, the checkout's `HEAD`
  after the update, and where the fetch came from. Name the remote, never
  its address, since an address can hold a token. Naming it keeps a
  mistake in matching remotes from falling back to the https address
  unnoticed on a machine where that address works. When no remote named
  the repository, say so, say that the fetch used the repository's https
  address or that nothing was fetched because the checkout already held
  the merge, and say that the checkout may show ahead of its remote until
  its next fetch.
- **Not linked,** from step 2: links exist and none of them leads into the
  merged repository. Say which repository merged, and which repositories
  the links point into.
- **No links found,** from step 1: the three folders it looked in. Then,
  in a sentence of its own, that if the skills or the mod load some other
  way (a plugin folder named in settings or with `--plugin-dir`, or a
  copy), this step updated nothing, so new sessions may run old code.
- **Only worktrees linked,** from step 2: the worktrees, and that no
  link leads into the main checkout, so it was not moved.
- **Nothing to update,** from step 3: the branch the merge went into, and
  that the main checkout stays on the default branch, which it did not
  touch.
- **Left alone,** from any failure: the checkout's path, or the broken
  link when there is no checkout; what stopped it, quoting git's or gh's
  own message; and that new sessions will run the old code until someone
  updates it. A failure is never reported as not linked.

## Questions

Before asking, try to answer it: read the code, the spec, the issue and its
comments, or send an agent to. A question that the code or the documents
answer is not a question.

A question about how the owner works is one whose answer is a habit or a
choice of the person, such as whether they ever clear a parent session, run
two copies of a tool at once or work offline, rather than a fact the code,
the spec or the issue settles. When nothing the owner has written down
settles it (their global `~/.claude/CLAUDE.md`, the project's `CLAUDE.md`,
the specs with their "Decided by the person" sections, and the issue), ask
the person directly. Never put it to the counsel, whose members can read
only what the owner wrote, and never guess the answer or build for the case
to be safe. Record the answer in the change's spec under "Decided by the
person", in the next commit the session makes rather than in a commit of
its own, because a commit is a push that counts toward the limit; in a
review round with nothing else to commit, the second half's point 4 says
where it goes. Then offer the owner one line for their personal global
`~/.claude/CLAUDE.md`, written in generic words that name no project, and
write it there only if they say yes.

Otherwise, put it to the counsel. Call `mcp__builder__counsel` with the
question, two to four options, the background (the issue in a few lines,
what was tried, what is at stake), the paths it touches and the session's
own lean. Once this issue's pull request is open and watched, every counsel
call also passes `pull_request` with that pull request's number, except a
follow-ups question, below; before the pull request is opened, no call
passes it.
Launch all seven counsel members, the six builder reviewers and
`builder:owners-advocate`, in one message, each with "Counsel brief:
<folder>.", wait for all seven, and call `mcp__builder__counsel_tally` with
their votes. The counsel decides when at least 4 of the 7 chose the same
option. Follow what the tally answers: go with a decision and tell the
person in the words it gives, which read "The counsel chose: <option> <n> of
<m> members voted for it.", ask all seven again when it says to, or ask the
person with the vote attached as the tool's answer gives it. If the counsel
tool says the counsel cannot sit, ask the person directly and say so. The
mod lists a decision in the next review on a pull request only when the
counsel call named that pull request with `pull_request` and it is still
open when the round is tallied; any other decision is recorded in the spec,
as the tally's answer says. When the pull request merges or closes before a
review lists a decision owed to it, the turn the mod starts for that, or
the watch tool's answer, lists the decision and says to record it in the
spec under "Decided by the counsel"; do so, leaving out a line the spec
already has. The builder pane lists members that gave no vote under "Without
a vote:", the label the question put to the person uses. When the
counsel tool refuses a call because the number is not the watched, open
pull request, its answer says what is watched, so call again with that
number or with none. If
the person overturns a decision by telling the session, their answer is
final.

**Follow-ups questions.** The second half of a review round puts a round's
undecided follow-ups to the counsel as one question, or as several when
more than twenty are left. The tool refuses more than twenty follow-ups in
one call, so that is one call for up to twenty and one more call for each
further twenty, all in the same round, with all seven members launched for
each call. Call `mcp__builder__counsel` with the question, the background,
the paths and the session's lean as usual, and with `follow_ups` in place of
`options`: a list of the follow-ups, each in one or two sentences saying
what it is and what a person would see if it is never fixed. A follow-up
outside the spec is passed as `{ text, outside_spec: true }`, and every
other one as its text. The mod gives every follow-up three options, fix it
in this pull request (1), file it as an issue (2), or drop it (3), except
that a follow-up outside the spec is offered only file and drop; a vote to
fix one is not counted, and the tally asks that member again. This call
never passes `pull_request`, and the
tool refuses it if it does, because its decisions are recorded in the
round's review, in the **Follow-ups** section, and nowhere else: not in the
spec, and not in a paragraph the mod adds to a review. Launch all seven
members as for any question, and call `mcp__builder__counsel_tally` with each
member's numbered votes, giving for each member its vote and reason on
every follow-up, keyed by the follow-up's number. Each follow-up is decided
on its own, by an option with at least 4 of the 7 votes. When the tally
asks for members again, launch exactly them again and tally once more; a
member that still has no vote does not send the question to the person,
and the follow-ups without 4 votes for one option are dropped as
undecided, as the tally's answer says. A follow-ups question never reruns
with a new option. Write each follow-up into the review as the tally's
answer and point 6 of the second half say.

If the counsel tool says the counsel cannot sit, ask the person once, with
every follow-up in the one question, and record their answer for each in
the review's **Follow-ups** section. The mod keeps counsel questions only
in its memory, so after a restart a tally can be refused because the
question is unknown; then put the follow-ups to the counsel again, with a
new call and all seven members.

These questions skip the counsel and always go straight to the person. A
question about checks or limits is about the pull request's own safeguards,
and the counsel is made of the agents that review that pull request. A
question about how the owner works needs an answer that the counsel cannot
know, because its members read only what the owner has written down.

- whether to merge a head with no checks when checks were expected;
- what to do when a limit on pushes or rounds is hit;
- a check that failed for a reason outside the code;
- a question about how the owner works, including a review finding that
  depends on it.

Ask with `AskUserQuestion`; the mod adds `needs-decision` to the pull
request while the question is open and takes it off when it is answered.
Every question has:

- one sentence saying what was tried and where;
- one sentence asking the question, complete enough to answer cold;
- one example of an answer;
- two to four options, the recommended one first.

## Resuming

`/implement --resume #N` is a new session after a restart, with neither
Remote Control nor the pane, so it begins as step 1 does: turn Remote
Control on, then start the builder mod with `mcp__builder__open_pane`,
handling a refusal or a missing tool as step 1 says. Then report the
`review` stage, before the watch: the bar counts a merge only for a watch
that began after the title's first report, so a resumed session that
watched first would never see its bar reach `merged`. Then find the pull
request's branch and its worktree (make one from the branch if there is
none), call `mcp__builder__watch`, and read the spec and plan paths from the
spec directory on the branch (never from the pull request body). When the
worktree holds commits the pull request lacks, do what "Commits the pull
request lacks" says. Then enter the list above from the top, reporting
`merge` when it runs the merge command. A verdict review at the head means
its first half finished there, and its body names the focused reviewers that
ran; without one, assume they have not run. A review whose verdicts are
carried over to the head from the approved head before it counts both
halves as run at the head. A usage-limit hold and the stuck prompt's
interval do not survive a restart, so a resumed session starts with no
hold and with the interval back at its first 45 minutes, and its stuck
prompt counts from the watch.

## Rules

- **No stage is skipped, whatever the size.** A three-sentence spec and a
  two-plan tournament are fine; skipping is not.
- **The session never makes a product decision on its own.** It puts it
  to the counsel, and asks the person when the counsel does not decide or
  when the question is one that goes straight to the person.
- **Worktrees only, and stage by path.** Never `git add -A`.
- **Check for credentials before every push,** not only the first: the
  diff of what is about to be pushed holds nothing shaped like a token, a
  key or a private key block. A credential that reaches the remote stays in
  its history even after a later commit removes it.
- **Report what was measured.** A skipped suite or a gate that did not run
  is said, never rounded up to green.
- **Everything posted goes under the gh login and reads as plain prose.**
  Agents report to the session; the session alone writes to the pull
  request, through the mod's review tool.
- **The session merges only from the step "Both verdicts approve at this
  head", and only on the cases that step says merge.** That step, not this
  rule, is where the conditions are written; this rule only says there is
  no other way, and that the merge goes through the project's merge
  command, read from the base branch.
