# Plan: pilot shows its progress from the moment /implement starts

Spec: `docs/specs/pilot-progress.md` (SAL-215). Written 2026-10-10.

## Chosen approach

The most-robust plan won the tournament, with ideas grafted from the other
two. The hooks in `register.tsx` record only facts: that pilot was started,
the reported stage, the package call, when the counsel launched its members,
and the model each agent was spawned on. Everything the person sees (the bar,
the merged and closed marks, the planned rows, the agent count) is worked out
from those facts when the band or the pane is drawn, so nothing derived is
stored and no hook can race the poller or the ticker to write it. Every write
that depends on the value before it goes through `update` with a pure
reducer, because the engine's `update` tries again when another write got in
first and may run a reducer more than once. A decision taken from a write,
such as whether the pane opens on its own, is taken from the reducer run
whose value was kept.

The code is split by job into three small modules beside the existing ones:

- `hooks/text.ts` (new) holds `printable` and `clockTime`, moved out of
  `pane.tsx`; every caller, the tests included, imports them from there. The new
  modules need them, and importing them from `pane.tsx` would make the
  modules import each other.
- `hooks/progress.ts` (new) holds the rules and nothing that draws: the nine
  stages, reading a stored progress value, applying a report, the bar's
  numbers, the planned rows and the short model names.
- `hooks/art.ts` (new) holds the drawing: XML escaping, the terminal bar
  cells, and one SVG builder each for the bar, an agent row and a planned
  row, plus `hasSvg(ui)`, the one place that decides whether a surface draws
  images.

`pane.tsx` composes these into the band and the panes, and `register.tsx`
wires the hooks and tools to state.

## Grafts, and why

- **Starting only on `open_pane` and `/pilot`** (from the simplest plan). The
  robust plan also let a progress report start pilot; spec item 1 and the
  first verification item tie it to the two calls only.
- **Drawing kept apart from the rules** (from the extensible plan). The robust
  plan put SVG building in the rules module; splitting it keeps the rules
  pure and testable without markup, and puts the surface choice in one
  function.
- **Planned rows listed once per type** (from the extensible plan). The
  counsel's members are the same six reviewer types as a review round's, so
  an overlap would otherwise list a type twice.
- **A named constant for the list read**, `LIST_EVERY_TICKS = 5` (from the
  extensible plan).
- **The narrow bar drops the title, then the stage, then the percentage, and
  only then cuts with `…`** (from the simplest plan), as the spec's edge
  case says.
- **The output pane's messages are read on the list read, not every second**
  (from the judge). A redraw every second would otherwise read up to 4096
  messages each second while the pane is open; the cleaned lines of the last
  40 messages are cached in a module variable, inside a numbered read that
  every draw shares, refreshed on opening the pane and on every list read
  while the agent runs.
- **`printable` and `clockTime` move to `text.ts`** (from the judge), so no
  new import cycle appears.

## Rejected alternatives

- **The simplest plan's `stalePr` rule** for not counting an old pull
  request's merge toward a new title. It wrongly ignores a re-watch of the
  same pull request under a new title. The chosen rule counts the watched
  pull request's merge or close only when its watch began at or after the
  title's first report (`run.since >= progress.since`).
- **The extensible plan's section list and planned-source list.** One feature
  does not need a plugin shape; plain functions called in order are clearer.
- **A separate test file with its own engine helpers** (extensible plan).
  `register.test.ts` already has `engine`, `fakePanes`, `engineAgents` and
  `liveBand`; mounted tests stay there. Pure rules get their own file.
- **Stopping the ticker only on a tick that read the list** (extensible plan).
  It keeps redrawing up to five seconds after the last agent finished; the
  stop check stays on every tick, from stored state.
- **Pulsing by SMIL alone.** `Svg` runs SMIL only with `isInteractive`, which
  draws it in a sandboxed frame. The running mark's opacity also alternates
  with the second (`Math.floor(now / 1000) % 2`), so it pulses as a plain
  image redrawn every second.
- **Refusing an empty title** (robust plan). The spec does not ask for it; an
  empty title is drawn as no title.

## State

| Key | Default | How an older or malformed value is read |
|---|---|---|
| `started: boolean` | `false` | `=== true` |
| `progress: Progress \| null` | `null` | `progressIn(raw)`; any bad field, or a stage outside the list, reads as `null` |
| `packaged: { head: string; at: number } \| null` | `null` | needs a string head and a finite time, else no planned review rows |
| `finishedFolded: boolean` | `true` | `!== false` |
| `outputAgent: string \| null` | `null` | `typeof === 'string'` |
| `AgentCard.model?: string` | absent | shown as `—` |
| `CounselQuestion.launchedAt?: number` | absent | the question plans nothing |

`Progress = { title: string; stage: StageId; furthest: StageId; note: string;
since: number; autoOpened: boolean }`. Planned rows, the bar and the counts
are never stored.

## Step sequence

Each step writes its tests first and sees them fail.

1. **Move `printable` and `clockTime` to `hooks/text.ts`**, and import them
   from there everywhere. No behaviour changes.
2. **`hooks/progress.ts` and `tests/progress.test.ts`.**
   - `STAGES` as an ordered list of `{ id, label }`; `StageId` derived from it.
   - `progressIn(raw)`.
   - `reportOf(input)` answers `{ refusal }` for a stage outside the list
     (naming all nine), or the report with its title cleaned with
     `printable(…, 60)` and its note with `printable(…, 40)`.
   - `afterReport(prev, report, now)` answers the progress after a report. A
     different cleaned title starts fresh with `since: now` and
     `autoOpened: false`, which is what opens the pane on its own;
     `furthest` only moves forward. `reportAnswer(progress)` is the tool's
     answer.
   - `barOf(progress, pr, watchSince)` answers `{ title, label, done, total: 9,
     percent } | null`: `done` is the index of `furthest`; a merged pull
     request whose watch began at or after `progress.since` gives 9 of 9 and
     `merged`; a closed one keeps the count and gives `closed`; a merged or
     closed pull request with no stage reported still gives a bar.
   - `plannedOf({ pr, packaged, agents, counsel })`: focused reviewers after a package call at the watched
     head while the pull request is open, then verdict reviewers once all four
     started since and none runs; counsel members of each question with no
     tally for `q.round` and a `launchedAt`, from `askedAgain` when it has
     entries, else every member; a type started at or after the cause's time
     leaves; the result lists each type once, in a fixed order.
   - `modelLabel(id)`: `claude-opus-5-5` to `Opus 5.5`, `haiku` to `Haiku`,
     anything else through `printable(…, 24)`, nothing to `—`.
3. **`hooks/art.ts` and `tests/art.test.ts`.**
   - `xmlText(text, max)`: `printable`, cut by code points, drop lone
     surrogates and U+FFFE and U+FFFF, then escape `& < > " '`. Only numbers
     are placed in attributes.
   - `barCells(done, total, cells)` for the terminal.
   - `barSvg(bar, widthPx)`, `agentSvg(row, now, widthPx)`,
     `plannedSvg(type, widthPx)`, each one `<svg>` string, light and dark
     colours by `prefers-color-scheme`.
   - `fitBar(bar, columns)` for the terminal row: drops the title, then the
     stage, then the percentage, then cuts with `…`.
   - `hasSvg(ui)`.
4. **The band** (`pane.tsx`, `register.tsx`, tests in `pane.test.ts` and
   `register.test.ts`).
   - Extract `fitLine` from `abovePromptLine`, with its output unchanged.
   - `secondRow(v, width)`: with a pull request watched, `abovePromptLine`;
     started with none watched, `pilot: <stage label or started> · <running
     part or idle>`, fitted the same way; not started, `abovePromptLine` as
     today.
   - `bandTree(ui, v, line, width, presses)`, given the second row worked
     out once by the draw: a column of the bar row (an `Svg` on a
     surface with `Svg`, else a `Text` row from `fitBar`), the `pilot-agents`
     button labelled with the number of agent rows plus planned rows, and the
     `pilot-line` button.
   - Atoms `started` and `progress`; `markStarted` at the top of the
     `open_pane` route and of `command.run`; the `progress` tool in
     `SESSION_TOOLS`, registered with `stage` as an enum, answering
     `pilot: spec (2 of 9)`; on a new title, mark `autoOpened` in the same
     reducer, then open the pane unless `$.ui.panes()` lists it, all errors
     caught and nothing reported.
   - `AbovePrompt`: yields to the survey; yields when not started and the
     second row is null; reads `bodyColumns` only when finite.
   - `togglePane` for the agent-count button: closes when `$.ui.panes()` lists
     the pane, else opens; the line button still only opens.
5. **The pane** (`pane.tsx`, `register.tsx`).
   - Atoms `packaged` (set by `servePackage` after both files are written)
     and `finishedFolded`; `launchedAt` set by `serveCounsel` and by
     `serveTally` when it asks again or reruns; `model` stored by
     `agent.spawn` when it is a string.
   - `paneTree`: the work header (an `Svg` or `Text` rows), the pull request
     lines as today, then running agents, planned rows, the `pilot-fold`
     button `Finished · <n>` and, when unfolded, the finished agents; each
     agent row followed by an `output-<id>` button. Agent rows drop the
     `pilot:` prefix and use `clockTime`.
6. **The output pane** (`register.tsx`, `pane.tsx`).
   - `AGENT_PANE = 'pilot-agent'`; `outputAgent` atom; `showOutput(id)` sets
     it, reads the messages into the cache, and opens the pane.
   - `agentPaneTree(ui, card, read, now)`: the card's facts, what it was
     asked, then `messageLines(list)` (the last 40, assistant text and
     `Tool: <short input>`, all cleaned), or `could not be read: <reason>` for
     a refused read, a throw or a value that is not a list.
7. **The clock** (`register.tsx`). `LIVE_REDRAW_MS = 1_000`,
   `LIST_EVERY_TICKS = 5`, a tick counter, and an `isRefreshing` flag so a
   slow `$.agent.list()` does not stack reads. The list read also refreshes
   the output pane's cache while its agent runs. The ticker still reads the
   list before it stops, as it did when every tick read it: when a tick first
   finds nothing running it starts a read of the list, and the ticker stops
   only at a tick after that read has finished, so an agent the mod did not
   see start is still found.
8. **`skills/implement/SKILL.md`**: the report points of spec item 22, in
   step 1, steps 2 to 7, the first review round, the merge and Resuming.
9. **`mods/pilot/README.md`**: the tool, the two-row band, the pane's groups,
   the output pane, and the one-second clock with the five-second list read.

## Test plan

Mapped to the spec's Verification list.

1. **Band before and after starting.** `register.test.ts`: no `pilot:` before
   `open_pane`; then `pilot: started · idle`; after a `spec` report
   `pilot: spec · idle`. A second case seeds `started: true` and a progress
   value as an older session would leave them, and the band shows.
2. **Bar rules.** `progress.test.ts`: `spec` gives 2 of 9 and 22%; a lower
   stage keeps the count and changes the label; `deploy` is refused naming the
   nine; a new title resets. `register.test.ts`: the tool's answer, and a
   refused stage leaves the band unchanged.
3. **Merged and closed.** `progress.test.ts` for `barOf`; `register.test.ts`
   sets the fake pull request to merged or closed, polls, and finds both rows,
   the bar at 9 of 9 `merged` or its count with `closed`. A new title reported
   after the merge shows its own count.
4. **The second row equals SAL-160's line** for watched views at several
   widths, including ones narrow enough to drop names (`pane.test.ts`).
5. **Drawings.** `register.test.ts` mounts `AbovePrompt` and `Pane` on
   `desktop` with `bodyColumns`: the band has no `Text`, one `Svg` and two
   buttons; the pane's header and agent rows are `Svg`, and no agent's
   description is in a `Text`. On `terminal`, no `Svg`, and the bar shows `█`
   and `░`. `art.test.ts`: the title `a<&>"b'c` appears escaped and never raw.
6. **Presses.** `pilot-agents` opens, and closes when `ui.panes` lists the
   pane; `pilot-line` opens; `pilot-fold` shows the finished rows;
   `output-<id>` opens `pilot-agent`, which shows the messages a
   `session.messages` hook answers, and the reason for a deny and for a throw.
7. **Planned rows.** `progress.test.ts` on built views, and `register.test.ts`
   through the real `package` and `counsel` tools: four planned after a
   package call, one leaves when its type starts, the verdict pair after the
   four finish, none after the head moves; six after a counsel call, two
   after an ask-again of two, none after a decided tally; a type planned twice
   is listed once.
8. **Clock.** With one agent running, a one-second advance moves its time by
   a second and asks for a redraw; ten seconds read the list twice; once the
   list says the agent completed, the redraws stop. Existing tests that assume
   five-second redraws are updated to the new cadence.
9. **Automatic opening.** Two reports of one title open the pane once; a new
   title opens it again; a pane `ui.panes` lists is not opened again.
10. **Subagent refusal.** A progress call with an `agentId` is denied and
    records nothing.

Older stored values (a malformed progress, a question without `launchedAt`, a
card without `model`) each draw without throwing.

## Risks

- The SVG width is estimated from `bodyColumns` at about eight pixels a
  column; on the desktop the image may be a little wider or narrower than the
  band.
- Moving the redraw from five seconds to one changes the timing several
  existing tests assume.
- Counting planned rows in the agent-count button is a reading of "the number
  of agents the pane lists".
- No gate reads `skills/` or the README, so their changes are checked by the
  reviewers only.
