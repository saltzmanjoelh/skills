# Plan: the pilot line always says what the session is doing

Spec: `pilot-shows-what-runs.md` (SAL-160). Written 2026-10-09 from a plan
tournament of three planners (simplest, most robust, most extensible) and a
judge.

## Chosen approach

The most robust plan won, trimmed to the mod's plain style, because it was the
only one that keeps the line from sticking on an agent the engine has dropped,
clears foreground-call records after a reload, and keeps the line live for
every kind of running work. Everything stays in the existing files:

- **State atoms** hold what the line and the pane draw from, and survive a hot
  reload: `agents` (now merged with the engine's list), and the new
  `background` and `calls`.
- **Module variables** hold timers and the decisions that must see the newest
  value (look numbers, the stalled head), because every state read in one
  dispatch reads one moment (engine types, line 3361).
- **Pure rules** go in `hooks/state.ts`; text and drawing go in
  `hooks/pane.tsx`. No new module.
- Render hooks only read state. The engine is read by `refreshAgents`, at fixed
  points, never while drawing.

## Engine facts relied on

From `mods/pilot/.claude-plugin/types/claude-code/index.d.ts` unless named:

- `$.agent.list()` (3150-3159) lists each agent until the engine drops its task,
  never a workflow's; `AgentStatus` (539) is pending, running, waiting, idle,
  completed, failed or killed.
- `classic.Stop` (1220-1243) carries `background_tasks?` (12058) for the
  session's own turn end; `agent_id` is present only inside a subagent (838).
- `AbovePrompt` props include `hasSurvey` and `bodyColumns`, the band's width in
  cells (10213-10219).
- `Button` takes `key`, `plain`, `dimColor`, `onPress` (1060-1151).
- `session.start` fires again on a reload (4295-4300); a reload cancels pending
  timers (3390-3397); state survives (3348-3355); `update` retries on a version
  miss (14572-14579); a state write is refused while a render hook draws (3377).
- A plugin's registrations of one event nest in order and a repeat throws
  (6719-6725), so the foreground wrapper goes inside the one existing
  `tool.call` hook.
- A failed tool call answers `{ isError: true }` when the tool threw, was
  interrupted or answered an error (12631-12720). A Bash command moved to the
  background answers without `isError` and with `backgroundTaskId`
  (claude-code-tools 4368-4396), and has not finished.

## Changes by file

### `types/index.d.ts`

- `AgentStatus` becomes the engine's seven words. A card an older build saved
  as `done` or `aborted` still reads as not running, because every reader goes
  through `isRunning`.
- `AgentCard` gains optional `isListed` (absent counts as listed), `endedAt`
  and `lastSeenAt`; `asked` becomes optional for an agent first seen in the list.
- New `BackgroundTask { id, type, status, description, command? }` and
  `ForegroundCall { id, tool, label, startedAt }`, keyed by `tool_use_id`.
- `Wake['source']` gains `'after-command'`.
- `PluginState.pilot` gains `background` and `calls`.

### `hooks/state.ts` (pure)

- `isRunning(card)`: listed, and status pending, running or waiting.
- `mergeAgents(cards, listed, now, readStartedAt)`: listed agents update or
  create their card with the engine's type, description and status, marked
  listed; a card that leaves running gets `endedAt` if it has none; unlisted
  cards are marked not listed and otherwise kept. A card spawned or ended after
  the read began is left alone, so an older read never undoes a newer record.
  The existing cap of 100 cards stays.
- `backgroundOf(raw)`: `[]` when not an array; drops subagent tasks (counted as
  agents) and anything that is not an object; keeps only the typed fields.
- `labelOf(e)`: a Bash description when not blank, else its command, else the
  tool name. `UNNAMED_TOOLS` holds AskUserQuestion and Agent, with the reason.
- `isPushOrMerge(command, mergeCommand)`: one regular expression anchoring
  `git` (optionally `-C <dir>`) then `push`, or `gh pr merge`, at the start of
  the command or after `;`, `&`, `|` or `(`; or the project's merge command's
  fixed words before its first `<`, when they are at least two words. The text
  is only matched.
- `pollFor(..., stalledHead)`: a new head equal to `stalledHead` gets the
  ordinary interval, keeping `isNewHead`.
- `waitingOn` uses `isRunning`. `statusOf` returns completed, failed or killed.

### `hooks/pane.tsx`

- `View.pr` may be null; `View` gains `background` and `calls`.
- `printable(text, max = 80)`: strips escape sequences whole, C0 and C1
  controls and bidirectional overrides, turns newlines and tabs into spaces,
  collapses spaces, cuts with `…`. Every model-supplied string goes through it
  when drawn.
- `clockTime(ms)`: `45s`, `1m 7s`, `1h 2m`, for the foreground part.
- `runningPart(v, names)`: `running: <label> (<clockTime>)` for the
  earliest-started call over 10 seconds; `1 agent: <type>` or
  `<n> agents: <types>` (oldest first, `pilot:` dropped); `1 background command`
  or `<n> background commands` when every task is a shell command, else tasks.
- `nextStep(v, isRunningShown)`: `1 agent running` in the singular; the agents
  phrase is dropped when the running part is on the line.
- `abovePromptLine(v, width)`: today's line with a pull request and nothing
  running; the running part inserted before the next step when something runs;
  `pilot: no pull request yet · <running part>` with none watched; null when
  none is watched and nothing runs. Fitting drops names from the end, then cuts
  the line with `…`. A width that is not a number means no limit.
- `agentLines(v)` (running first, newest first in each group, every agent,
  durations from `durationMs`, else `endedAt` or `lastSeenAt`, else now) and
  `backgroundLines(v)`.
- One `paneTree` for both cases: with no pull request it draws the
  nothing-watched sentence, then agents, background and the counsel.
  `idleTree` goes.

### `hooks/register.tsx`

- Atoms `background`, `calls`. Module variables `liveTicker`, `callCount`,
  `commandLooks`, `lookSeq`, `newestStoredLook`, `toldSeq`, `stalledHead`,
  `mergePattern`. Each call's 10-second redraw timer is a local of the call,
  not a module variable.
  Constants `LIVE_REDRAW_MS = 5_000`, `AFTER_LOOK_MS = [10_000, 40_000]`,
  `NAMED_AFTER_MS = 10_000`.
- `refreshAgents($)`: reads the list in a try, keeping the stored list on a
  failure or a value that is not an array, and merges. Called, unawaited and
  with errors caught, from `agent.spawn`, `turn.start`, both `turn.complete`
  branches, `lookAt`, `session.start` and the live ticker.
- `ensureLive($)`: a 5-second ticker that refreshes the agents, stops when
  nothing runs, and otherwise asks for a redraw. Started at each session call,
  each spawn, a Stop with tasks, `session.start`, and a refresh that finds a
  running agent. The 30-second ticker for the next look stays.
- The `tool.call` hook's body moves into `route($, e, next)`, unchanged. A
  session call (no `agentId`) whose tool is not in `UNNAMED_TOOLS` runs through
  `foreground($, e, () => route(...))`: record the call, arm the 10-second
  redraw, start the live ticker, run it, and in a `finally` cancel the timer and
  remove the record. After a Bash call that succeeded (no deny, no `isError`,
  no `backgroundTaskId`) and matches `isPushOrMerge`, `armCommandLooks`.
- `armCommandLooks` cancels its pending pair and arms looks at 10 and 40
  seconds; `armTurnEndLooks` arms its pair without cancelling anything, so a
  later turn end never cancels an earlier 40-second look. Both observe only.
  `armTurnEndLook` and `turnEndTimer` go.
- `lookAt` numbers each look before its read. A look older than the newest
  stored never stores its result, records a wake or schedules the next poll,
  and a look that only observes then stops. A look that acts on its read (a
  known look, a delivering look, and the CI event's look, which says so with
  `{ actsOnRead: true }`) still acts on it. `toldSeq` holds the number of the
  read last recorded as told, and `tell` and `deliver` refuse a read older
  than that. The watch tool's `tell` takes a fresh number. `lookAt` returns
  `{ r, s, seq, delivered }`.

  This rule changed during review. The plan first dropped an overtaken look
  before it did anything, but a look that must act was then silently lost:
  the review just posted was never recorded as told, and a change held during
  the turn was never handed over. Letting every overtaken look act on its
  older read fixed that, and opened the opposite fault: an older look could
  undo a newer told record, or hand over a change that told the session the
  pull request went backwards. The told sequence keeps both rules: a look
  that must act still acts, and an older read never replaces a newer told
  one.
- `deliver` returns whether it submitted a prompt; when it holds the change or
  the prompt is refused it sets `stalledHead`. `nextPoll` passes it to
  `pollFor`. `isHandedOver` goes; the held path of the session's turn end arms
  the turn-end looks unless `delivered`.
- `classic.Stop` for the session's own turn end replaces `background` with
  `backgroundOf(e.background_tasks)`, starts the ticker when there are tasks,
  and passes on.
- A subagent's `turn.complete` updates or creates its card (status, duration,
  summary, `endedAt`), then refreshes.
- `session.start` also clears `calls`, marks every unanswered question answered
  and queues the label removal, reads the merge command once from the
  checkout's `CLAUDE.md`, refreshes the agents and starts the ticker.
- `view` always returns a View. The band draws
  `<Button key="pilot-line" plain dimColor label={line} onPress={...} />`, whose
  press opens the pane and catches its own failure; a null line or a survey
  passes on. The pane always draws `paneTree`.

### `README.md`

Rewrite "What the line above the prompt says" and the pane paragraph: the
running part, the line with nothing watched, the press, the 10-second named
call, the 5-second redraw, the looks after turn ends and after the session's
push or merge, and the bounded new-head poll.

## Grafts

- From the simplest plan: `deliver` returns a boolean; one pane tree; no
  sequence numbers on agent reads, no extra caps or deep shape checks.
- From the extensible plan: one status vocabulary; escape sequences stripped
  whole; `git -C <dir> push`; a register test that mounts the band with
  `bodyColumns`; a finished agent proven to leave through the engine read and
  the ticker, with no `turn.complete`.
- From the robust plan's tests: the 10-second redraw proven with the ticker out
  of phase; a second push replacing the pending looks; a reload test that holds
  a real AskUserQuestion open.

## Rejected alternatives

- **A second `tool.call` registration** (simplest plan): a repeat registration
  of one event throws.
- **Cards the engine dropped stay running** (simplest and extensible plans):
  a missed `turn.complete` or a workflow agent would pin the line for the rest
  of the session.
- **A module-load guard at the top of every hook** (extensible plan):
  `session.start` already fires again on a reload.
- **A new `activity.ts` module and a table of look kinds** (extensible plan):
  structure for iterations the spec leaves out.
- **Sequence numbers on agent reads, five delivery outcomes, a command parser
  that splits on operators** (robust plan): the per-card guard, a boolean and
  one regular expression do the same work.
- **Starting the live ticker at a call's 10-second mark** (simplest and
  extensible plans): an agent resumed by SendMessage during a turn of short
  calls would not show until the turn ended.

## Step sequence, each test seen failing first

1. Types.
2. `state.ts` tests, then code: `isRunning`, `mergeAgents` (resumed, unseen,
   dropped, guarded by the read's start), `backgroundOf`, `labelOf`,
   `isPushOrMerge`, `pollFor` with a stalled head, `statusOf`.
3. `pane.tsx` tests, then code: plural, running part, width fitting, null line,
   `printable`, `clockTime`, `agentLines` order, `backgroundLines`.
4. Register: agents from the engine, the live ticker and the band with nothing
   watched.
5. Register: background from the Stop hook.
6. Register: foreground calls.
7. Register: questions and calls at `session.start`.
8. Register: the Button and the pane.
9. Register: look numbering, `deliver`'s answer, turn-end looks.
10. Register: looks after a push or merge.
11. Register: the bounded poll.
12. README, then the four gates.

## Test plan, by the spec's Verification bullets

`R` is `tests/register.test.ts`, `P` is `tests/pane.test.ts`, `S` is
`tests/state.test.ts`. New helpers in R: a mutable `agent.list` answer, a Bash
answer the test controls (success, error, backgrounded, held, thrown), a reader
of `/pilot wakes`, and a recorder of redraw times.

- **Resumed agent.** R: the list names a running agent the mod never saw
  spawn; after a turn starts the line is
  `pilot: no pull request yet · 1 agent: <type>`; `waiting` counts too.
- **Finished agent leaves.** R: the list turns it completed and 5 seconds pass,
  with no `turn.complete` and no redraw by hand; the line passes on. A dropped
  running agent stops counting.
- **Background.** R: a Stop with a shell task and a subagent task gives
  `1 background command`; monitor plus shell gives `2 background tasks`; a Stop
  with none, or without the field, clears it; a Stop with `agent_id` is ignored.
- **Questions after a reload.** R: an AskUserQuestion held open shows
  `waiting on your answer` and labels the pull request; `session.start` again
  settles it and takes the label off.
- **Shown and hidden with nothing watched.** R.
- **Plural and width.** P: `1 agent`, never `1 agents`; five agents at width 50
  fit and end with `…`. R: the band mounted with `bodyColumns` fits.
- **Press.** R: pressing `pilot-line` opens the pane.
- **Control characters.** P: escapes, newlines, a bell and a bidirectional
  override are removed; a long text is cut.
- **Foreground call.** R: named at exactly 10 seconds with the ticker out of
  phase and no keystroke; not before; gone after it returns or throws; two
  overlapping calls each recorded. S and R: the label order. R: a subagent's
  call, an AskUserQuestion and an Agent call are never named.
- **Pane.** P: running first, finished below, background rows. R: before a
  watch the pane lists agents and background above the counsel.
- **Merge mid-turn.** R: a successful `gh pr merge` gives looks at 10 and 40
  seconds and the line says merged; a second push replaces the pending looks;
  a failed or backgrounded one gives none. S: the `isPushOrMerge` cases.
- **Turn-end looks.** R: turn ends at 0 and at 16 give `turn-end` wakes at
  10, 26 and 40.
- **Older look.** R: a held read of the open state lands after a newer read of
  the merged state; the line still says merged.
- **Bounded poll.** R and S: held and refused fall to the ordinary interval; a
  new head brings 90 seconds back.
- **Matching read with no prompt.** R: the turn-end look still runs.
- **Wake-source tests.** R: the two tests that counted `gh pr view 7` reads
  count `turn-end` wakes instead.
