# Pilot shows its progress from the moment /implement starts

Issue: SAL-215. Written 2026-10-10.

## Goal

From the moment `/implement` starts the pilot mod, the person can see above
the prompt that pilot is running, which stage the work is in and how far
through the nine stages it is, and can open a pane that lists every agent the
session launched, the agents it is about to launch, and what each one did.
On the desktop the band and the pane are drawn as images, so the desktop app
does not wrap their rows apart. In the terminal they are drawn as text.

## Users and trigger

A person watching an `/implement` session, at the desk or from another
device. Seen on 2026-10-09 in the SAL-160 session: its first turn called
`mcp__pilot__open_pane` and the mod answered "The pane is open.", the mod ran
through the spec and the plan comparison and the counsel worked, and the
person saw nothing from pilot in the desktop app. The line above the prompt
was hidden because no pull request was watched yet and, between agents,
nothing ran. On 2026-10-09 the person overturned SAL-160's counsel decision
to hide the line when nothing runs. The savvy-progress mod
(`JohnnyVizz/claude-kit`, `plugins/savvy-progress`) is the reference design;
its ideas are copied, not its code.

## Behavior

### Starting, and the stage report

1. **Pilot counts as started** from the first `mcp__pilot__open_pane` call or
   `/pilot` command of the session, and stays started for the rest of the
   session. The mark is kept in the mod's state, so a hot reload keeps it.
2. **A new session tool, `mcp__pilot__progress`,** takes `title` (the issue
   in a few words, such as `SAL-215 pilot progress`), `stage` and an optional
   `note`. A subagent may not call it, as with the other session tools.
3. **The stages are fixed, nine, in this order:** `grounding`, `issue`,
   `spec`, `plan`, `build`, `verify`, `pr`, `review`, `merge`, shown as
   grounding, checking the issue, spec, plan tournament, build, verify, pull
   request open, review rounds and merge. A stage outside the list is
   refused with an answer that names the list, and nothing is recorded.
4. **The bar keeps the furthest stage reached.** Its count of done steps is
   the number of stages before the furthest one reported, out of nine, so
   entering `spec` reads 2 of 9 (22%). A report of an earlier stage, as when
   the session goes back to fixing code during review, changes the label to
   that stage but never lowers the count.
5. **The note is a label only.** A sub-step such as `build 2 of 5` or
   `round 2` shows beside the stage and never moves the bar. Title and note
   are cleaned with the same rule as other text a model supplies (control
   characters removed, cut to a fixed length).
6. **A different title starts new work.** It resets the stage, the count and
   the note, and the pane's automatic opening (item 21) applies again.
7. **The mod, not the session, marks the merge.** When the watched pull
   request's state is merged, the bar reads 9 of 9 (100%) and the label
   `merged`, whatever stage was last reported. When it is closed without
   merging, the bar stays where it was and the label reads `closed`.
8. **The tool's answer** names the stage and the count, such as
   `pilot: spec (2 of 9)`.

### The band above the prompt

9. **Once pilot is started, the band is always shown,** except that it gives
   way to Claude Code's survey (`hasSurvey`). It has two rows.
10. **The first row is the progress bar,** shown once a stage has been
    reported or the watched pull request has merged or closed. It carries
    the title, the stage label with the note, the done count out of nine, the
    percentage, and beside it the agent-count button, whose press opens the
    pane, or closes it when it is open. The button's label leads with how
    many agents run now, then how many are planned when any are, then how
    many have finished when any have: `1 agent running`,
    `7 agents running · 52 finished`, `0 agents running · 2 planned ·
    1 finished`. An agent counts as running by the same test the rest of the
    mod uses, and one the engine no longer lists counts as finished. The
    label first showed only the number of agents the pane lists, finished
    ones included, and a session deep in its review rounds showed `59 agents`
    while seven reviewers ran, which read as if all of them were still at
    work.
11. **The second row is SAL-160's line,** unchanged once a pull request is
    watched: `pilot: #<n> <state> · checks <ci> · …`, with its fitting rule
    (agent names dropped from the end first, then the line cut with `…`).
    Before a pull request is watched it reads `pilot: <stage> · <what runs>`,
    or `pilot: <stage> · idle` when nothing runs, with the stage written
    `started` when none has been reported. Pressing it opens the pane, as
    today.
12. **After the pull request merges or closes,** both rows stay, the bar as
    item 7 says and the line saying merged or closed, until the session ends
    or a different title starts new work. "Until the pull request merges or
    closes" in the issue means the band tracks progress until then, not that
    it hides then.
13. **Before pilot is started** nothing changes from today: the line shows
    with nothing watched only while something runs, and there is no bar.

### The pane

14. **The pane's top shows the work:** the title, the stage and note, and
    the same bar as the band. With a pull request watched, its state follows
    as today (repository and number, state and head, labels and
    mergeability, checks, verdicts at the head, round and pushes), then the
    agents, the open questions, the counsel, the next step and the last
    look.
15. **Agents are listed in three groups:** running ones first, then planned
    ones, then finished ones folded under one heading `Finished · <n>`, a
    button that unfolds and folds them. The fold starts folded and is kept in
    the mod's state.
16. **Each agent row shows** its type with the `pilot:` prefix dropped, its
    description, its model, its status, and how long it has run or ran
    (`45s`, `1m 7s`, `1h 2m`), and, once finished, its summary line. A
    running row carries a mark that pulses on the desktop. There is no
    progress bar per agent; the person decided this on 2026-10-10 after the
    counsel split 3 to 3. The model is the one the engine answered when the
    agent was spawned, shown short (such as `Opus 5.5`), or `—` for an
    agent the mod did not see spawn.
17. **Planned rows are worked out by the mod,** never reported by the
    session, from state it already keeps:
    - after a package call at the watched head, the four focused reviewers
      (security, maintainability, performance, data) that have not started
      since that call are planned;
    - once all four have finished since that call, the two verdict
      reviewers (spec, adversarial) that have not started since are
      planned;
    - while a counsel question waits for votes (it has no tally for its
      current round), the members its last answer told the session to
      launch that have not started since are planned.

    A type planned by both a review round and a counsel question is listed
    once.

    A planned row is worked out each time the pane is drawn, never stored,
    so it goes when its cause goes: the head moving, the pull request
    merging or closing, the counsel question being tallied, or an agent of
    that type starting. A planned row shows its type and `planned`.
18. **Each agent row has an `output` button** that opens a second pane,
    `pilot-agent`, for that agent: its type, description, model, status and
    time, what it was asked, and its messages as the engine holds them
    (`$.session.messages({ agentId })`), newest last, at most the last 40:
    assistant text, and each tool use as its tool name and a short summary of
    its input. Every piece is cleaned as item 5 says. When the engine refuses
    the read, the pane says so with the engine's reason. The pane follows the
    agent while it runs (item 20) and shows its final summary once it ends.
19. **Desktop and terminal drawings differ.** On the surfaces that draw
    images (the desktop, the mobile app and the editor), the bar,
    the pane's work header and each agent row are each one SVG image, and
    only buttons (the agent count, the fold, `output`) are separate elements,
    each on its own row below the image it belongs to. Every piece of text
    placed in an SVG is escaped for XML (`&`, `<`, `>`, `"`, `'`). On the
    terminal the same content is drawn as text rows, the bar as
    `█` and `░` cells. The lines that are only text (the pull request
    state, the counsel, the next step) are `Text` rows on every surface.

### Keeping it live

20. **A clock while anything runs.** While an agent, background work or a
    foreground call of the session's own runs, the band and the panes are
    redrawn every second, so running times move by the second. The engine's
    agent list is still read every five seconds, not every second. When
    nothing runs the ticker stops, as today.
21. **The pane opens on its own** at the first stage report of a new title,
    once per title, unless it is already open. The answer of
    `mcp__pilot__open_pane` is unchanged.

### The /implement skill

22. **`skills/implement/SKILL.md` says when to report.** The session calls
    `mcp__pilot__progress` on entering each stage: `grounding` right after
    opening the pane in step 1, `issue` before the Explore check, `spec`,
    `plan`, `build` and `verify` at the start of steps 3 to 6, `pr` once the
    pull request is opened and watched, `review` when the first review round
    starts, and `merge` when it runs the merge command. A resumed session
    reports `review` before it calls `mcp__pilot__watch`, because item 7
    counts a merge only for a watch that began after the title's first
    report. A note is optional, for sub-steps such as `round 2`.

## Edge cases

- **A hot reload.** The started mark, the stage and the furthest stage are
  kept in state, so the band comes back as it was.
- **`--resume`.** A new session starts with no progress; it reports `review`
  before watching the pull request, so the bar can still reach `merged`.
- **/pilot typed in a session that is not running `/implement`.** Pilot is
  started, so the band shows its second row (`pilot: started · idle`) and no
  bar until a stage is reported.
- **A narrow terminal.** The bar row drops the title before the stage and
  the percentage; the line keeps SAL-160's fitting rule.
- **A title or description holding markup or escape sequences.** Cleaned
  for the terminal and escaped for SVG, so it is shown as text.
- **The engine drops a finished agent from its list.** Its row stays as the
  mod last recorded it, as today.
- **A counsel round asked again of two members.** Only those two are
  planned.
- **The issue turns out to be done at the issue stage.** The session stops
  without a pull request; the bar stays at the issue stage until the
  session ends.

## Non-goals

- A progress bar per agent, or a step tool for agents. The reviewer fence is
  not widened.
- Planned builders or other agents the mod cannot work out on its own.
- Cost and token counts, which savvy-progress shows.
- Changing how and when the mod looks at the pull request.

## Failure modes

- `$.session.messages` refuses or fails: the output pane says the messages
  could not be read and why, and still shows the agent's card.
- The engine reports a pane as waiting (too narrow a terminal): the
  automatic opening says nothing; the person can widen the terminal or press
  the agent-count button.
- A stage report outside the list: refused, nothing recorded, and the answer
  names the nine stages.

## Verification

Tests in `mods/pilot/tests`, each failing if its rule is removed:

- before `open_pane` and with nothing running there is no band; after it the
  line reads `pilot: started · idle`, and after a `spec` report
  `pilot: spec · idle`;
- a reported stage sets the bar to the stages before it out of nine, an
  earlier stage changes the label but not the count, a stage outside the
  list is refused, and a new title resets the bar;
- a merged pull request reads 9 of 9 and `merged`; a closed one keeps the
  count and reads `closed`; both rows stay after either;
- with a pull request watched, the second row equals SAL-160's line for the
  same view;
- on the desktop surface the band, the pane's work header and its agent rows
  are drawn with `Svg` and buttons only, and no agent's description appears
  in a `Text` row (the pull request, counsel and next-step lines stay `Text`,
  as item 19 says); on the terminal there is no `Svg`; text with `<`, `&` and
  quotes is escaped in the SVG source;
- the agent-count button and the line open the pane; the fold folds finished
  agents; the `output` button opens the output pane with the agent's
  messages, and a refused read shows the reason;
- planned rows appear after a package call and a counsel call, leave when an
  agent of the type starts, give way to the verdict reviewers once the four
  finish, and go when the head moves or the question is tallied;
- the redraw runs every second while an agent runs and stops when nothing
  does, and the engine list is read every fifth tick;
- the pane opens on its own once per title;
- a subagent calling the progress tool is refused.

The four gates in the repository's `CLAUDE.md` pass. The `SKILL.md` change is
read by the reviewers only, since no gate reads `skills/`.

## Decided by the counsel

- What should the steps of the pilot progress bar above the prompt be, so that it shows done out of planned and a percentage that reaches 100% when the pull request merges? The counsel chose The nine /implement stages are the steps: grounding, checking the issue, spec, plan tournament, build, verify, pull request open, review rounds, merge. The bar fills one ninth per stage finished, and the session reports only which stage it is in. Within a stage the session may add its own sub-steps (such as build 2 of 5), which the label shows but which do not move the bar., 5 of 6.
- Which agents should the pilot pane list as planned, before they start? The counsel chose The mod works them out on its own from what it already knows. In a review round, the focused reviewers not yet launched at the watched head are planned (all four from the round's start, at the package call), then the two verdict reviewers once the four have finished. During a counsel question, the six members are planned from the counsel call until each one starts. Nothing else is ever planned., 6 of 6.
- Once a pull request is watched, where should its state (number and state, checks, what runs, what the mod waits on and when it next looks) appear relative to the new progress bar above the prompt? The counsel chose Two rows: the progress bar on the first row (title, stage, done of nine, percentage, agent-count button), and under it today's text line with the pull request's state and what the mod waits on and when it next looks, as SAL-160 left it; before a pull request is watched, the second row shows what runs, or 'idle'., 6 of 6.
- What should the pilot band above the prompt (the progress bar and the line under it) do once the watched pull request has merged or closed? The counsel chose Keep both rows: the bar at 100% with 'merged' (or 'closed', with the bar left where it was) and the line saying the pull request merged or closed, until the session ends, or until a stage report with a different title starts new work, which resets the bar., 6 of 6.

## Decided by the person

- Each agent's row shows no progress bar: its model, a live clock and its
  status, with an `output` button to read what the agent did. Decided on
  2026-10-10 after the counsel split 3 to 3 between this and a
  context-fill bar.
