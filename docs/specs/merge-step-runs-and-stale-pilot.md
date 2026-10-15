# A skipped run hides no real run, and a session knows when its pilot is stale

Issues: SAL-282, covering SAL-171 and SAL-187. Written 2026-10-14.

## Goal

Two separate safeguards, shipped in one pull request.

1. `/implement`'s step **Both verdicts approve at this head** never merges
   past a real workflow run because a later run that did no work stands in
   for it (SAL-171).
2. A session that is running a pilot mod different from the one a restart
   would load is told so, on the line above the prompt and in the pane
   (SAL-187).

## Users and trigger

**The merge step.** Every `/implement` session reaching its merge, in any
repository with workflows. The case behind SAL-171, found in round 6 of the
reviews of archived pull request 9: a workflow listens for `labeled`, skips
its jobs on that action with an `if:`, and cancels pending runs through a
concurrency group. Setting `ready-to-merge` starts a label run, which
cancels the real run before any of its jobs start. A label event reports
`event: pull_request` like a push, so the label run has the same
`workflow_id` and `event` and a higher `run_number`. Under today's rule it
replaces the cancelled run, every one of its jobs ends skipped, and the
pull request merges past a check that never ran. A real run that failed is
hidden the same way.

**The stale mod.** Every session on a machine that loads the pilot mod
through a link into a git checkout, as `~/.claude/skills/pilot` points at
`~/Projects/skills/mods/pilot`. On 2026-10-07 a session started eight
seconds before the main checkout was fast-forwarded onto the merge that
added the counsel, and it ran without the counsel, not knowing why
(SAL-186 has the account). SAL-186 made the checkout update right after a
merge; this covers a session that is already running, or that started in
the gap.

## Behavior

### The merge step (`skills/implement/SKILL.md`)

1. **The run read keeps `id`.** The workflow-runs read keeps `id` beside
   `workflow_id`, `event`, `run_number`, `status`, `conclusion` and
   `run_attempt`, because the jobs read below needs it.
2. **A run is replaced only by a run that did real work.** An older run
   stops counting only when a run of the same `workflow_id`, started by the
   same `event`, has a higher `run_number` and did real work. A completed
   run did real work when its conclusion is not `skipped` and at least one
   of its jobs ended other than `skipped`, read with
   `gh api --paginate "repos/<repo>/actions/runs/<id>/jobs" --jq '.jobs[].conclusion'`.
   This holds whatever the older run ended as, cancelled, failed or
   passed. A run that did no real work replaces nothing, and it still
   counts itself by its own conclusion, so a run that skipped every job
   counts as passed.
3. **An unfinished newer run replaces the older one for now.** A newer run
   of the same workflow and event that has not completed replaces the older
   one until it completes. It counts as unfinished, so the step waits for
   it rather than sending the older cancelled run to **A check or a
   workflow run failed at the head**. Once it completes, the rule in point
   2 decides again.
4. **The jobs read happens only where it matters:** for a completed run
   whose replacing of an older run is in question. A head with one run per
   workflow and event reads no jobs.
5. **The step's definitions become a labelled list.** Right after the two
   read commands, the step lists its four definitions, each under its own
   label: when a run is replaced (points 2 and 3), when a check passed,
   when a run is unfinished, and when a run failed. Their meaning is
   unchanged apart from points 2 and 3.
6. **The yes bullet names its check.** The bullet "They already said yes
   to this head and these runs" says "merge after **Read again before
   merging on a yes**" instead of "merge after the check below".

### The stale-mod warning (`mods/pilot`)

7. **Finding the checkout.** The mod resolves `$.plugin.root` to its real
   path with `$.fs.stat(root, { resolve: true })` and runs git there. It
   uses no hard-coded path.
8. **Two recorded commits.**
   - **The session commit** is the checkout's `HEAD` read at the session's
     first `session.start`. It is kept in the mod's state, which survives a
     hot reload, and is never rewritten in that session. It stands for the
     files the engine reads only when a session starts: `agents/`,
     `.claude-plugin/plugin.json` and `hooks/hooks.json`, the list of hook
     modules.
   - **The hooks commit** is the checkout's `HEAD` read by the newest load
     of the hooks module, at the start of its `session.start`, so at the
     first load and at every hot reload. It stands for the rest of `hooks/`.
9. **When it compares.** At each load of the hooks, at the end of every
   turn of the session, and on each poll of a watched pull request. A
   session with nothing watched therefore finds out by its next turn end.
   The comparison reads `HEAD` first and does nothing more when `HEAD` has
   not changed since the last comparison. When it has, it runs
   `git diff --quiet <recorded commit> <commit read> -- <paths>` once for
   each recorded commit that differs from the commit read. It names the
   commit read rather than the word `HEAD`, because git resolves `HEAD`
   only when it starts, and a checkout that moved away and back between
   the two reads of `HEAD` would otherwise have its result kept under the
   wrong commit.
10. **When it warns.** The mod warns when the session-start files differ
    between the session commit and `HEAD`, or when the other files under
    `hooks/` differ between the hooks commit and `HEAD`. Direction does not
    matter: a fast-forward, another branch checked out, and a reset to an
    older commit all warn when those files differ. A move that changes
    none of them, such as one touching only `skills/`, `docs/`, the README
    or `mods/pilot/tests`, says nothing.
11. **What it says.** The line above the prompt and the pane both say
    `pilot changed on disk since this session loaded it; restart this
    session to load it`. The line keeps the warning when it must shorten
    to fit the width. The wording never claims the mod is older, because
    the move may have gone the other way.
12. **When it clears.** When `HEAD` comes back to files equal to those
    loaded, the next comparison clears it. A hot reload clears a warning
    that was only about `hooks/` files other than `hooks.json`, because
    the reload records a new hooks commit. A warning about the session-start
    files clears only by a restart.

## Edge cases

- **A reload that lands during a fast-forward.** The hooks commit is read
  at the start of loading. If git is still writing files, the loaded files
  can be newer than the recorded commit, which only warns too much; the
  later file writes start another reload, which records again.
- **A session running the older pilot when this change reaches its
  checkout.** That pilot kept no record of the commits it was loaded from,
  so the hot reload that loads this change records the session commit as
  unknown and differing, and the session shows the restart warning at once
  and keeps it until it restarts.
- **Two comparisons at once.** A turn-end comparison and a poll comparison
  can overlap. A result is kept only if `HEAD` is still what that
  comparison read when it finished. The check and the write are separate
  steps, so in a rare overlap a slower result can still land over a newer
  one; it then names an older `HEAD`, and the next turn end or poll sees the
  difference and compares again, so a stale result lasts only until then.
  The exception is a hot reload landing in the same overlap, together with
  a comparison at the new head that finishes before the slower write: the
  stored head then already names the new commit, so the stale session
  result lasts until `HEAD` next moves. It needs a whole reload and a whole
  comparison to finish inside one awaited state update, so it is accepted.
- **A label run that runs a small job.** If a workflow skips its tests on
  `labeled` but still runs some other job, such as a labeller, the label
  run did real work by point 2 and replaces the cancelled test run. Point 2
  cannot tell which jobs matter, and this is accepted: the adversarial
  reviewer, the one dissent on that question, named it.
- **A run whose jobs list is empty** (it failed at startup) did no real
  work by point 2 and replaces nothing. It counts as failed by its own
  conclusion.
- **A run's jobs read fails.** The run counts as having done no real work,
  so it replaces nothing, which can only block a merge.
- **Uncommitted edits in the checkout.** The comparison is between commits,
  so edits nobody committed are not seen. The owner's rule keeps the main
  checkout clean, so this is accepted.

## Non-goals

- Reloading the mod in place. The engine offers no call that reloads a
  plugin (`$.plugin` has only `name` and `root`), and touching the mod's
  own files to set off the engine's watcher would write into the shared
  checkout. The issue asked for this choice to be recorded: restart, not
  reload.
- Warning about skills under `~/.claude/skills` other than the pilot mod.
- The pilot mod's own reading of checks for its pane (`newestRuns` in
  `mods/pilot/hooks/github.ts`), which keeps the newest check of each
  name. The merge is decided by the session from the step, not by the mod.
- Checks posted by an app other than GitHub Actions. They have no workflow
  run, so only the rollup sees them, and the case behind SAL-171 is
  specific to Actions.

## Failure modes

- **Git fails, the commit is missing, or the mod's folder is not inside a
  git checkout.** No warning, and nothing breaks: only `git diff` exiting
  with 1 means the files differ, and every other result counts as no
  difference. The comparison runs through the mod's git helper, with its
  timeout, and the end of a turn never waits on it.
- **The jobs read is refused or times out.** As in Edge cases, the run
  replaces nothing.

## Open question

Whether `gh pr view --json statusCheckRollup` keeps a failed check after a
later skipped check of the same name arrives in another check suite
(SAL-171, item 2) is not settled. It no longer decides a merge for checks
from GitHub Actions: under point 2 the failed run is not replaced by a run
that did no real work, so the workflow-runs read keeps it and the step
stops at **A check failed, or a run failed** whatever the rollup shows.
This rests on point 2. If the replacement rule is loosened later, the
question decides merges again and must be settled first, with a
throwaway repository whose workflow on `labeled` skips its job with an
`if:`.

## Verification

- **The merge step.** No gate reads `skills/`, so the reviewers check
  points 1 to 6 against the step's text, including a worked example in the
  step for the label run that skips every job, over an older cancelled run
  and over an older failed run.
- **The stale-mod warning.** Tests in `mods/pilot/tests`, each of which
  fails if its part of the change is removed:
  - the warning appears at a turn end, with nothing watched, after `HEAD`
    moves and `agents/` changed;
  - no warning when `HEAD` moves and only files outside the watched paths
    changed;
  - a hot reload after a change only to `hooks/register.tsx` clears the
    warning;
  - a hot reload after a change to `agents/` or `hooks/hooks.json` keeps
    it;
  - a move back to the loaded files clears it;
  - `git diff` exiting with 128, and a folder that is not a checkout, give
    no warning;
  - `HEAD` unchanged since the last comparison runs no `git diff`;
  - the line above the prompt and the pane show the wording in point 11.
- **The gates** in `CLAUDE.md`. The first, which writes the engine's types,
  fails on Claude Code 2.1.299 (SAL-285), so the report says how the type
  check ran, or that it did not.

## Decided by the counsel

- When the main skills checkout moves past the commit the running pilot mod was loaded from, and the move changed files the session uses, should the mod record one commit per session and always ask for a restart, or record the agents' commit and the hooks' commit separately so that a hot reload of the hooks can clear a warning about the hooks alone? The counsel chose Record two commits: the one the agents and plugin.json were read at (session start) and the one the hooks module last loaded at (each load and hot reload). Warn 'restart this session' when agents/ or .claude-plugin/plugin.json changed since session start, or when hooks/ changed since the hooks last loaded. A hot reload of the hooks therefore clears a warning that was only about the hooks., 4 of 6.
- When should the pilot mod compare the commits it loaded from with the main checkout's current HEAD, given that it polls GitHub only while a pull request is watched? The counsel chose At each load of the hooks, at the end of every turn of the session, and on each poll of the watched pull request, so a session with nothing watched still finds out at its next turn end., 6 of 6.
- In /implement's step 'Both verdicts approve at this head', when exactly should a newer workflow run stop replacing an older run of the same workflow and event, so that a run started by a label that skips every job cannot make a cancelled or failed real run disappear? The counsel chose A newer run replaces an older run of the same workflow_id and event only when the newer run did real work: its conclusion is not skipped, and at least one of its jobs (read with gh api repos/<repo>/actions/runs/<id>/jobs) ended other than skipped. This holds whatever the older run ended as, so a skipped run can hide neither a cancelled run nor a failed one., 5 of 6.
- SAL-171 item 2 asks to settle, with a test repository, whether gh pr view's statusCheckRollup keeps a failed check after a later skipped check of the same name arrives in another check suite. Now that a skipped run no longer replaces an older run, should this pull request still run that experiment? The counsel chose Do not run it. Record in the spec why the answer no longer decides a merge: a failed run stays counted in the workflow-runs read whenever the newer run did no real work, so the step is already blocked by that run whether or not the rollup drops the failed check. Name the experiment as an open question in the spec., 6 of 6.
- When the main checkout's HEAD differs from a commit the pilot mod recorded, but did not simply move forward (someone checked out another branch there, or reset it to an older commit), should the mod warn? The counsel chose Warn whenever the files the session uses (agents/, .claude-plugin/plugin.json, hooks/) differ between the recorded commit and HEAD, in whatever direction, with wording that does not claim 'older': for example 'pilot changed on disk since this session loaded it; restart this session to load it'., 6 of 6.

`hooks/hooks.json` is counted with the session-start files rather than with
the rest of `hooks/`, following the adversarial reviewer's caution on the
first question: it lists the hook modules, and nothing establishes that a
change to it is picked up by a hot reload.
