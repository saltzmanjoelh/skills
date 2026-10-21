# Lessons from the foreman build

Written 2026-10-21. It changes four skills: `skills/spec/SKILL.md`,
`skills/plan-tournament/SKILL.md`, `skills/implement/SKILL.md` and the
foreman mod's wake skill, `mods/foreman/skills/wake/SKILL.md`. It changes no
code, and it sits beside the rules that keep review rounds inside the spec
(`review-rounds-stay-in-scope.md`) rather than replacing any of them.

## Goal

Building the foreman and builder mods cost far more than the work needed. The
change that keeps review rounds inside the spec fixed the reviewer side of
that. This change fixes the rest: what a parent session does while its sub
sessions build, and what `/implement` does at the spec, plan and review
stages, so that a question only the owner can answer is asked before anything
is built for it, a spec says where its work stops, a plan avoids state that
creates edge cases, and the parent stays quiet and cheap.

## Users and trigger

Every `/implement` session, the parent session that the foreman mod wakes,
and the owner who pays for both. The trigger was the build of the foreman
mod's actions, replayed under "Replay" below.

## Behavior

### Rule one: a question about how the owner works goes to the owner

A question depends on how the owner works when its answer is a habit or a
choice of the person, such as whether they ever clear a parent session, run
two copies of a tool at once or work offline, rather than a fact the code,
the spec or the issue can settle. When nothing the owner has written down
settles such a question (their global `~/.claude/CLAUDE.md`, the project's
`CLAUDE.md`, the specs and the issue), the session asks the owner directly.
It does not guess, it does not build for the case to be safe, and it does
not put the question to the counsel, whose members can only read what the
owner wrote down.

- **In the spec interview** (`skills/spec`), such a question skips the
  counsel and goes to the person through AskUserQuestion. It still counts
  toward the 5 to 10 questions.
- **In review** (`skills/implement`), a finding that depends on how the owner
  works is not fixed and not sent to the counsel. The session asks the
  owner first, in the same form as its other questions, before the claim
  checker's verdict would have it fixed or set aside. The owner's answer
  decides the finding: if the owner says the case happens, the finding goes
  on as any other finding; if not, it is dropped with the owner's answer as
  its reason. It joins the short list of questions that always go straight
  to the person.
- **Recording the answer.** The answer goes in the spec of the change, under
  the existing heading "Decided by the person", which the owner's advocate
  already reads. The session also offers the owner one line, written in
  generic words that name no project, to add to their personal global
  `~/.claude/CLAUDE.md`, and writes it there only when the owner says yes,
  so that later sessions in every project can read it.

### Rule two: every spec says what it does not cover

The spec skill's Non-goals section is required, never empty, and the skill
says what it is for: it lists the edge cases and follow-ups the change
deliberately leaves out, so that reviewers have a written reason to stop.
The interview always covers what is out of scope; it is no longer one of
the topics it may skip.

### Rule three: the plan judge counts the edge cases a plan's state creates

The plan tournament's judge counts, for each plan, the edge cases its state
creates: what happens on a restart, a resumed or cleared session, a hot
reload, and two copies running at once. It prefers state that is rebuilt
from durable files on every read over state saved under a session id or held
only in memory, and it weighs each plan by how many such cases it creates,
not only by its size. The planners' brief says the same, so that every
planner reports its state and those cases.

### Rule four: the parent's side

The wake skill gains four rules for the parent session:

- **Keep follow-ups out of feature issues.** The parent never folds an edge
  case or follow-up issue into a feature issue it is about to start. It
  starts the feature issue as it is, and the follow-up stays its own issue.
- **Step in when the sub session raises a streak or a limit.** When a sub
  session tells the parent that one area's fixes reached a streak of 3, or
  that it hit its limit on pushes or rounds, the parent tells the owner in
  one line at once, naming the issue and the area or the limit, and asks
  whether to stop, narrow or change the approach. It does not propose an
  issue for later instead.
- **Never raise a limit to make room.** The parent never agrees to raise a
  limit on pushes or rounds, and never proposes it. When the owner asks for
  that, it first asks why the limit keeps being reached, because a limit
  that keeps being reached is a sign to change the approach.
- **Report only at milestones.** The parent speaks to the person only at a
  milestone (a pull request opened, a verdict, a merge), for a question to
  the owner, or with a one-line message the skill already asks for. It says
  nothing about reviewer-by-reviewer progress, and answers any other note or
  message with nothing.

So that the parent hears about a streak or a limit, `/implement` adds one
sentence: when the session was started by another session that it can
message, it also sends that session one short line whenever it puts a
streak of 3 to the counsel or asks the person about a limit, naming the
issue and the area or the limit. It does this whatever the counsel decides.

## Edge cases

- A question that seems to depend on the owner but that the code or a
  document answers is not a question; the existing rule to try to answer it
  first still applies.
- An owner who declines the offered line for their global `CLAUDE.md` still
  has the answer recorded in the spec.
- A sub session with no parent, or one that cannot message its parent,
  skips the extra line; its question to the person is unchanged.
- An owner who still wants a limit raised after being asked why has the last
  word; the parent asks once, and does not refuse the owner.

## Non-goals

- No code changes, and no change to the builder or foreman mods' engines.
  The parent does not count streaks itself or read pull requests to detect
  them; the counsel decided against that.
- No change to the rules that keep review rounds inside the spec, the
  counsel's makeup or the limits' default values.
- No migration of existing specs to add or fill a Non-goals section.
- The `/start-foreman` command and the wake skill's front matter belong to
  another change and are left alone.

## Failure modes

- A session misjudges whether a question depends on how the owner works.
  The cost is one question too many to the owner, or one finding handled as
  before; neither builds code for an unasked case without a record.
- The extra line to the parent fails to send. The sub session's own question
  to the person still stands, so nothing waits on the line.

## Verification

No gate reads `skills/`, `docs/` or the wake skill's text, so reviewers check
the text against this spec and the rules in `CLAUDE.md`. They check that:

1. `skills/spec/SKILL.md` sends a question about how the owner works to the
   person, not the counsel, records the answer under "Decided by the person",
   offers the global `CLAUDE.md` line, and requires a Non-goals section
   that says it is a reason for reviewers to stop.
2. `skills/plan-tournament/SKILL.md` has the judge count each plan's state
   edge cases and prefer state rebuilt from durable files.
3. `skills/implement/SKILL.md` sends a finding that depends on how the owner
   works to the owner, lists it among the questions that go straight to the
   person, and sends the parent a line on a streak of 3 or a limit.
4. `mods/foreman/skills/wake/SKILL.md` carries the four parent rules and
   leaves its front matter unchanged.
5. Every changed line is generic and in plain complete sentences, and the
   staged diff passes the search for issue keys and pull request numbers.

## Replay

The build of the foreman mod's actions, measured from its pull request's
commits and reviews, and the point at which each rule would have cut it.

- **The plan.** The plan's first step kept foreman's ledger of tickets in
  the store under the parent's session id. Of the fourteen review rounds
  that followed, the second, third, fifth and the seventh to the fourteenth
  were spent on that ledger: an outbox so a hot reload loses nothing, a
  stored copy that must not replace a newer one, and then a process that
  goes on as another session. Under rule three the judge would have counted
  restarts, reloads, clears and two copies against that plan before any code
  was written, and preferred rebuilding the ledger from the sub sessions'
  status files, which would have had nothing to hand over.
- **The owner question.** At the seventh round a reviewer raised a parent
  process going on as another session, and the session built for it. By the
  eleventh round it was following a `/clear`. The owner, asked only after the
  fourteenth round, settled it in one sentence: they never clear a parent
  session, and the code was removed in one more push. Under rule one the
  seventh round's finding goes to the owner, the answer comes back before
  any code, and the seven rounds and pushes from the eighth to the fourteenth,
  plus the removal, are not spent.
- **The folded follow-up.** The parent folded a follow-up about what a
  forked session should do with its ticket into the feature issue, so the
  spec turned an edge case into requirements, and the eighth round was still
  fixing how forks are logged. Under rule four it stays its own issue, and
  under rule two the spec's Non-goals would have named clearing and resuming
  the parent from the start, which the spec only said after the code was
  removed.
- **The parent watching.** The seventh, eighth and ninth rounds all fixed the
  same area, so the streak rule that now exists would have stopped at the
  ninth round, and under rule four the parent would have taken it to the
  owner then, five rounds before the owner was asked. The parent instead
  only proposed an issue for later, and while the mods were being built the
  limit on pushes per round was raised from 8 to 12, then put back once they
  merged. Under rule four the parent asks why the limit keeps being reached
  instead of agreeing to raise it.
- **The status relays.** The issue reports that the parent answered every
  turn-end note from every sub session with a one-line update, dozens in
  all, each one re-reading its whole conversation. For this pull request,
  rule four leaves four messages: the pull request opened, the two verdict
  reviews, and the merge.

## Decided by the counsel

- When the session asks the owner a question that depends on how the owner works (for example, whether they ever clear a parent session), where should the owner's answer be written down so that later reviewers and the owner's advocate can read it? The counsel chose: In this change's spec, and the session also offers the owner a one-line addition to their own CLAUDE.md, written only on their yes. 7 of 7 members voted for it.
- How should the parent session notice that a sub session's review rounds keep finding narrower problems in the same area, so that it steps in and asks the owner? The counsel chose: The parent acts only when the sub session itself raises it: a question about a push or round limit, or a streak of 3 put to the counsel; then the parent sends it to the owner with the question of why the limit keeps being reached, and never agrees to raise the limit itself. 6 of 7 members voted for it.
