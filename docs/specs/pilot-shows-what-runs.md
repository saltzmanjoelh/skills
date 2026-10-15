# The pilot line always says what the session is doing

Issue: SAL-160. Written 2026-10-09.

## Goal

At any moment, the line above the prompt says what the session is doing:
which agents are running, what background work is in flight, which slow
command is running, and where the pull request stands. Nothing on it stays
wrong for long. Clicking it opens the pilot pane, which lists every agent and
background task and what each is working on.

## Users and trigger

A person watching an `/implement` session, at the desk or from another device.
Seen on 2026-10-08 while a session drove #11, the line read
`pilot: #11 open · checks none · 0 agents running · waiting on owner` while a
builder agent resumed with SendMessage was working, a background shell command
was running, and no question was open. Seen on 2026-10-09, in screenshots from
the person:

- sessions in the spec and plan stages with "3 running tasks" and messages
  from subagents, and no pilot line at all, because nothing was watched yet;
- the desktop banner saying #20 had merged while the line still read
  `pilot: #20 open · checks none · nothing to hand over · next look in 7m`,
  because the session merged inside a turn that went on;
- Claude Code's own "Running a command 1m 7s" beside a line that said
  `nothing to hand over`, with nothing saying that the command was the gates.

From the owner, 2026-10-08: an overview of every agent and its status is one of the
main things this mod is for.

## Behavior

### Where the line's parts come from

1. **Agents come from the engine.** The agents the line counts and the pane
   lists come from `$.agent.list()`. An agent counts as running while its
   status is `pending`, `running` or `waiting`, so an agent resumed with
   SendMessage, and one the mod did not see start, counts. The mod's own
   records add only what the list lacks: when the mod first saw the agent,
   how long it ran, and its summary line once it finished. The engine list
   is read when an agent starts or finishes, at each turn's start and end, at
   each look, and on the redraw ticker; the result is stored, and the line and
   the pane draw only from stored state, never from a read while drawing.
2. **Background work is recorded at each turn end.** The engine reports the
   session's in-flight background work on the Stop hook
   (`classic.Stop`'s `background_tasks`: shell commands, subagents, monitors,
   workflows). The mod stores that list at each of the session's own turn
   ends, replacing the last one, so work that finished is gone at the next
   turn end at the latest. A background subagent appears once, as an agent,
   not again as a background task.
3. **The session's own slow foreground call is named while it runs.** Each
   tool call of the session's own (no `agentId`) is recorded when it starts,
   one record per call keyed by the call, with its start time and a label: the
   Bash call's description when it has one, else its command, else the tool
   name. The record is removed when the call returns, throws or is refused,
   in a `finally`. Once a call has run 10 seconds (one named constant), the
   line names it as `running: <label> (<elapsed>)`; with several running, it
   names the one that started first. A redraw is asked for at the 10-second
   mark, so the name appears without a keystroke, and the elapsed time is
   worked out when the line is drawn. AskUserQuestion and the Agent tool are
   not recorded: the line already says `waiting on your answer` for the
   first and names the agent for the second, and each running thing is named
   once.
4. **A question counts only while it is open.** `waiting on your answer`
   shows only while an AskUserQuestion call of the session's own is in
   progress. At session start, and when the mod's hooks are loaded again
   after a hot reload, every question record still marked unanswered is
   marked answered, and the `needs-decision` label the mod put on for it is
   still taken off.

### What the line says

5. **The line is shown whenever there is something to say.** With a pull
   request watched it is always shown, as today. With none watched it is
   shown while anything runs (an agent, background work, or a slow foreground
   call) and hidden when nothing does, reading for example
   `pilot: no pull request yet · 3 agents: Explore, spec-reviewer, data-reviewer`.
   It still gives way to Claude Code's survey (`hasSurvey`).
6. **It names what is running.** The running part reads `1 agent: <type>` or
   `<n> agents: <type>, <type>, …`, with the `pilot:` prefix dropped from
   type names, and background work beside it as `1 background command` or
   `<n> background tasks` (a command when every task is a shell command,
   otherwise a task). The whole line is shortened to the width the band
   gives it, cutting the list of names first and ending it with `…`.
7. **Plural agreement.** `1 agent`, never `1 agents`. This replaces the
   plural that the SAL-159 spec (`pilot-next-look.md`) pinned.
8. **With a pull request watched**, the line reads
   `pilot: #<n> <state> · checks <ci> · <running part> · <what is next>` when
   anything runs, and as today otherwise. The `<k> agents running` phrase of
   the next step gives way to the running part, so the agents are not named
   twice.
9. **Clicking the line opens the pilot pane.** The line is a Button in the
   band whose press opens the pane, as `/pilot` and `mcp__pilot__open_pane`
   do.
10. **Text a model supplies is cleaned before it is printed.** Descriptions,
    commands and summary lines have control characters removed and are cut
    to a fixed length, on the line and in the pane.

### The pane

11. **The pane lists every agent.** One row per agent from the stored engine
    list, running ones first, newest first within each group, each with its
    type, its description, its status, how long it has run or ran, and its
    summary line once it finished (its end line, `LENS-END`, `CLAIMS-END` or
    `VERDICT:`, when it has one). Finished rows stay below the running ones
    for the life of the session; an agent the engine has dropped from its list
    stays as the mod last recorded it.
12. **Background tasks get rows of their own** under the agents, with their
    command or description and status.
13. **The pane is listed with nothing watched too.** Before a pull request is
    watched, the pane shows the agents and background tasks above the
    counsel, so clicking the line always shows what it named.
14. **The pane and the line stay live.** They redraw when an agent starts or
    finishes, when the background list changes, and every 5 seconds while
    anything runs (an agent, background work or a foreground call), whether or
    not a pull request is watched, so durations move and finished work leaves
    without the person typing or reopening the pane. The redraw also refreshes
    the stored engine agent list (item 1).

### Looking at the pull request

15. **The mod looks after the session's own push or merge.** When a Bash call
    of the session's own (no `agentId`) returns successfully and its command
    runs `git push` (also with any number of `-c <key=value>` and `-C <dir>`
    options between `git` and `push`), `gh pr merge`, or the merge command
    the project's `CLAUDE.md` names, the mod looks at the pull request about
    10 seconds and again about 40 seconds later, even while the turn goes
    on. A new push or merge replaces those two looks rather than adding to
    them. The command text is only matched against fixed patterns by one
    named function; it is never passed to `gh` and never read for a pull
    request number.
16. **The mod looks twice after each turn ends**, about 10 and about 40
    seconds after each of the session's own turns ends. Each kind of look
    (after a command, after a turn end) has its own timer, so one never
    cancels the other.
17. **An older look never overwrites a newer one.** Looks are numbered as they
    start. A look whose result arrives after a later-started look's result
    has been stored never stores its result or changes the display. A look
    that hands a change over or records a state as told still does so from
    its own read, unless a newer read has already been recorded as told, in
    which case it does nothing.
18. **The 90-second poll is bounded.** After a handover of a head was refused
    (the prompt dropped) or held (the session's turn was running), the poll
    for that head falls back to the ordinary interval. A new head brings the
    90-second interval back. A held change is still delivered when the turn
    ends, and the looks after turn ends, pushes and merges still run.
19. **A handover is counted only when a prompt was submitted.** `deliver`
    reports whether it submitted a prompt, and the turn-end handover counts as
    handed over only when it did. A turn-end read that merely matches what the
    session was already told is not a handover, so the looks after the turn
    end still run.

## Edge cases

- **A hot reload while an agent runs.** The mod's records are in state and
  survive; the engine list is read again at the next hook, so a running agent
  is never lost from the line.
- **A hot reload while AskUserQuestion is open.** The question is marked
  answered at load; if the call is still open, the line no longer says
  `waiting on your answer` for it. That is the safer error: the alternative is
  a line pinned to "waiting on owner" for the rest of the session.
- **Many agents.** The line names as many as fit and ends with `…`; the pane
  lists them all.
- **The engine drops a finished agent from its list.** The pane keeps it from
  the mod's record; the line has already stopped counting it.
- **A push through a script or an alias.** The command match misses it; the
  looks 10 and 40 seconds after the turn ends still find it if GitHub shows it
  by then.
- **A failed `git push` or merge.** No look follows it.
- **A push or merge named inside a quoted string.** The pattern knows nothing
  of quotes, so `echo "a; git push"` counts as a push. It costs one extra
  read of the pull request.
- **A push with other options before `push`.** The pattern misses a `-c`
  value quoted with spaces in it, such as `git -c "a=b c" push`, and other
  options such as `--git-dir=<dir>` before `push`. Each miss costs one look,
  which the looks after the turn ends recover.

## Non-goals

- Showing the latest line of output of an agent still running. The engine does
  not offer it; the pane shows the summary line once the agent finishes.
- Rows for scheduled wakeups and cron tasks.
- Changing Claude Code's own rows ("3 running tasks", "Running a command").

## Failure modes

- `$.agent.list()` fails: the line and pane keep the last stored list until a
  read succeeds.
- The Stop hook carries no `background_tasks` (an older engine): no background
  part is shown.
- gh fails on a look: as today, the next scheduled look tries again.

## Verification

Tests in `mods/pilot/tests`, each failing if its fix is removed:

- a resumed agent the mod never saw spawn is counted and named;
- an agent that finishes leaves the line at the next read;
- background work from the Stop hook is named and cleared at the next turn end
  without it;
- a question left unanswered before a reload is marked answered and its label
  taken off;
- the line is shown with nothing watched while an agent runs, and hidden when
  nothing does;
- `1 agent`, not `1 agents`; names shortened to the width;
- pressing the line opens the pane;
- control characters are removed from a description;
- a foreground call is named once it has run 10 seconds, with no keystroke,
  not before, and is gone after it returns or throws; two overlapping calls
  are each recorded, and one returning leaves the other named;
- the label is the description, else the command, else the tool name;
- a subagent's call is never named;
- the pane lists running agents first, finished ones below, and background
  tasks;
- a `gh pr merge` in the middle of a turn is followed by looks at 10 and 40
  seconds, and the line then says merged; a failed one is not;
- a turn end is followed by looks at 10 and 40 seconds, and a short turn does
  not cancel the 40-second look;
- an older look's result does not overwrite a newer one;
- a refused or held handover drops the poll to the ordinary interval, and a
  new head brings 90 seconds back;
- a turn-end read that matches what was told, with no prompt submitted, still
  arms the looks after the turn end;
- the two turn-end tests assert on the recorded `turn-end` wake instead of
  counting `gh pr view 7` reads.

The four gates in the repository's `CLAUDE.md` pass.

## Decided by the counsel

- Should the pilot line above the prompt appear when no pull request is watched yet (during the spec, the plan tournament and the build), and if so, when? The counsel chose Show it whenever something is running (agents, background work, or a long foreground command), as for example 'pilot: no pull request yet · 3 agents: Explore, spec-reviewer, data-reviewer'; hide it when nothing runs., 4 of 6.
- How should the mod learn of the session's own push or merge promptly, so the line never says '#20 open' after the session merged it and a push GitHub shows late is not missed (issue item 12)? The counsel chose Both: the looks after the session's own push and merge commands, and a second look 40 seconds after each turn ends., 4 of 6.
- How should the 90-second new-head poll be bounded when a new head keeps failing to be handed over (issue item 11)? The counsel chose After a handover attempt that was refused (the prompt dropped) or held because the session's turn was running, fall back to the ordinary interval for that head; the next turn end, push or merge look still runs, so a held change is still delivered when the turn ends., 6 of 6.
- What should the pilot line say about the session's own foreground tool call while it runs, such as the gates running for a minute or more? The counsel chose Once a foreground call of the session's own has run 10 seconds, the line names it, e.g. 'running: claude plugin test . (1m 7s)', using the Bash call's description when it has one, else its command, else the tool name, shortened and with control characters removed; it disappears when the call returns., 6 of 6.
