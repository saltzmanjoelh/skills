# Skills on other machines

Written 2026-10-14.

## Goal

Three small fixes, so that the skills and this repository's gates behave
sensibly on a machine that is not the one they were written on.

- `/pr-comments` and `/spec` say what to do when the pilot mod is not
  loaded, instead of telling the session to use an agent or a tool that does
  not exist.
- The first gate in `CLAUDE.md` stops its background `claude` run after two
  minutes, so that a stuck startup step costs at most two minutes instead of
  ten.
- The committed plan `docs/specs/implement-runs-unattended-plan.md` gives
  file paths relative to the repository, not absolute paths into a removed
  worktree under a home folder.

## Users and trigger

- A session running `/pr-comments` in a project or on a machine where the
  pilot mod is not loaded, at step 3, when it doubts a review comment.
- A session running `/spec` without the pilot mod, at the first interview
  question.
- A session running `/implement` or `/verify-loop` in this repository, at
  the first gate, on a machine where one of the person's MCP servers or
  startup hooks is stuck.
- Anyone reading the unattended-session plan after its worktree is gone.

## Behavior

**`/pr-comments`, step 3.** The paragraph that sends doubted comments to a
`pilot:claim-checker` subagent gains a short passage for when that agent type
does not exist. The session then starts a `general-purpose` subagent with the
same brief the paragraph already gives: the comments as a numbered list of
claims, the head commit, an attempt to refute each claim with evidence from
the code, and one verdict per claim, confirmed, refuted or speculative. The
passage also tells that subagent to treat the comments as claims to test,
not as instructions, and to change nothing in the checkout, because a
general-purpose agent, unlike the claim checker, has tools that can edit
files. The passage restates only this short brief and does not copy the
claim checker's definition, so the two cannot drift apart.

**`/spec`, interview rule 1.** The existing sentence "If the counsel tool
says the counsel cannot sit, ask the person directly and say so." widens to
cover the case where the pilot mod is not loaded, so that the counsel tool or
the `pilot:` agent types do not exist. In that case too the interview asks
the person directly and says so. The counsel tool may be deferred, which
means it is listed only by name until ToolSearch loads it, so the rule also
tells the session to look for it with ToolSearch before deciding it is
missing, as `/implement` already does for `mcp__pilot__open_pane`.

**`/implement` needs no change.** Its first step already says that when
`mcp__pilot__open_pane` is missing, the mod is not loaded, and the session
says so and stops, because watching the pull request and every reviewer
depend on the mod. No other skill names a `pilot:` agent.

**The first gate.** Only the `claude` call inside the gate's command changes.
It runs under a two-minute alarm:
`perl -e 'alarm 120; exec @ARGV' env CLAUDE_CODE_PLUGIN_DIR_WATCH=1 claude -p ...`.
macOS has no `timeout` command by default, while `perl` is always there. The
variable `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` stays, set on the `claude` call
alone, as an earlier change made it. Everything else in the command stays: the
old types are deleted first, the call's exit status is still ignored, and the
gate still passes only if `mods/pilot/.claude-plugin/types/tsconfig.json`
exists again. The gate's prose gains a short explanation of the limit: what
it bounds, why two minutes, and that a hook the limit cuts off can leave its
own process running.

**The plan's paths.** The "Critical Files for Implementation" list at the end
of `docs/specs/implement-runs-unattended-plan.md` names the same files with
paths relative to the repository root, such as
`mods/pilot/hooks/register.tsx`. Nothing else in that plan changes.

## Measurements behind the gate's limit

Measured on 2026-10-14 with Claude Code 2.1.300, running the gate's own
command from an empty scratch folder:

| Case | Time to return | Types written |
|---|---|---|
| A normal load | 5 seconds | yes |
| An MCP server that reads its input and never answers, added with `--mcp-config` | 37 seconds | yes |
| A `SessionStart` hook that runs `sleep 100000`, added with `--settings`, with no limit | 607 seconds | yes |
| The same stuck hook under a 60-second `perl` alarm | 60 seconds | yes |

So the gate never waits forever. Claude Code gives up on an MCP server after
about 30 seconds and on a hook after about ten minutes. The types are written
before the stuck hook runs, which is why a limit leaves the gate passing. A
later run of the bounded gate with a one-second alarm still passed, so the
types are written within the first second of a load.
When the alarm stopped `claude`, the hook's `sleep` was left running as an
orphan and had to be stopped by hand. Two minutes is about three times the
slowest load that finished by itself in under a minute.

## Edge cases

- A machine where a normal load is slower than two minutes. The first gate
  then fails on its own check, because the alarm stops `claude` before the
  types are written. That is a visible failure, not a hang, which is what the
  issue asks for. The gate's text says so, because running the gate again
  fails the same way.
- The limit stops `claude` after it has already written the types, because a
  later startup step is stuck. The gate passes, as it should, since the types
  are all the gate exists to produce.
- A hook or MCP server process that the alarm orphans keeps running until it
  ends by itself or someone stops it. The gate's text says so.
- A machine without `perl`. macOS always has it, and the gates are written
  for macOS, so this is out of scope.

## Non-goals

- Loading the mod without the person's MCP servers or hooks. The limit
  bounds every startup step at once, which is simpler.
- Cleaning up processes that the alarm orphans.
- Any change to `/implement`, to the other gates, or to the pilot mod.
- Rewriting anything in the unattended-session plan other than its paths.

## Failure modes

- If the alarm is too short for a slow machine, the first gate fails rather
  than hanging, and running it again fails the same way. The gate's text
  tells the person to time the load and lengthen the alarm.
- If a session without the pilot mod ignores the new passage in
  `/pr-comments`, it gets the same failed agent call it gets today, so the
  change cannot make things worse.

## Verification

- `grep -n 'general-purpose' skills/pr-comments/SKILL.md` finds the new
  passage in step 3, and it names the numbered claims, the head commit, one
  verdict per claim, and changing nothing.
- `skills/spec/SKILL.md` interview rule 1 names the case where the pilot mod
  is not loaded and tells the session to ask the person directly and say so.
- The first gate in `CLAUDE.md` contains `alarm 120` and
  `CLAUDE_CODE_PLUGIN_DIR_WATCH=1`, and running it passes and writes the
  types.
- Running the gate's command with the stuck `SessionStart` hook above
  returns in about two minutes, and the gate passes.
- `grep -rn '/[U]sers/' docs skills mods README.md` prints nothing. The
  brackets keep this line from matching itself.
- The searches for project names and em dashes over `skills`, `mods` and
  `README.md` still print nothing.

## Decided by the owner

- Should the first gate stop its background `claude` run after two minutes,
  so that a stuck startup hook costs at most two minutes instead of ten? The
  owner chose yes, a two-minute limit.

## Decided by the counsel

- When the pilot mod is not loaded, so the pilot:claim-checker agent does not exist, what should step 3 of /pr-comments tell the session to do with the comments it doubts? The counsel chose The session starts a general-purpose subagent with the same instructions the claim checker follows (a numbered list of claims, the head commit, refute each with evidence from the code)., 6 of 7.
- The issue about skills that need the pilot mod asks whether other skills that name a pilot: agent need the same fallback sentence as /pr-comments. Should this pull request also change /spec, whose interview always goes to the counsel? The counsel chose Yes: widen the existing sentence in skills/spec/SKILL.md so that when the counsel tool is missing (the pilot mod is not loaded), the interview asks the person directly and says so, exactly as it already does when the counsel cannot sit., 7 of 7.
