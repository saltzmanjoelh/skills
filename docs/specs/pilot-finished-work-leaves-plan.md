# Plan: finished work leaves the pilot line and pane

Spec: `pilot-finished-work-leaves.md`. Written 2026-10-14.

## Chosen approach

The simplest plan won, with four ideas taken from the other two. Nothing
stored changes and no new state atom is added.

1. **A dropped agent's word.** A pure `shownStatus(card)` in `state.ts`, beside
   `isRunning` and its set of running statuses, returns `no longer listed` when
   `card.isListed === false` and the stored status is pending, running or
   waiting, and the stored status otherwise. `agentRowOf` in `pane.tsx` prints
   it. The rest already follows from `isRunning`: the text row is dimmed, the
   row sorts among the finished, its time is frozen, and `art.ts` draws the
   finished mark, whose class for an unknown word is the muted one. `art.ts`
   does not change.
2. **A notification row removes its finished task.** A new
   `on('ui.render', { component: 'UserMessage' })` hook in `register.tsx`
   checks, without touching `$`, that the row's origin is a task notification,
   that its task's id is a non-empty string and that its status is completed,
   failed or killed. It then schedules the removal with `$.clock.after(0, …)`
   and returns `next(e)` unchanged. The removal reads the list and writes only
   when the id is in it, filtering it out through `update`. The timer is needed
   because the engine refuses a state write while a render hook draws, and
   because a read made while drawing would subscribe the row to every later
   change of the list.
3. **Every subagent's end refreshes the list.** One helper,
   `replaceBackground($, raw)`, runs `backgroundOf`, writes the list and keeps
   the line live when it is not empty. The Stop handler uses it as today, so a
   missing field still empties the list. A new `classic.SubagentStop` handler
   uses it only when `background_tasks` is a list, with a comment saying why a
   missing field means nothing there.
4. **Who asked decides the reply.** `openPane($, asker)` takes a required
   `'tool' | 'command'`. Only the `/pilot` command passes `'command'`; the tool
   route, the pane toggle, the progress tool's opening and the band line press
   pass `'tool'`. When the pane waits, the tool's reply mentions typing
   `/pilot` or widening the terminal, and the command's mentions only widening
   it.

## Grafts

- From the most-robust plan: `shownStatus` in one named place rather than an
  exported set tested inline, because "running" is defined beside `isRunning`.
- From the most-robust plan: the required `asker` parameter, so a future
  caller that shows the reply must choose its wording.
- From the most-robust and most-extensible plans: one `replaceBackground`
  helper shared by both turn ends, so their filtering cannot drift apart.
- From the most-robust plan: tests that a row still draws when the store read
  or write throws, and a check that the drawn mark for `no longer listed` is
  the muted one.

## Rejected alternatives

- **Writing from the render hook without a timer** (most-extensible plan). The
  read would run inside the draw and subscribe every finished notification row
  to the list, and the write may be refused, which the hook's catch would hide.
- **A module-level set of ids being dropped** (most-robust plan). Two draws of
  the same row are already safe: the second finds no match and writes nothing,
  and `update`'s version check covers a turn end landing at the same moment.
- **A separate `paneAnswer`, `endedTaskId`, `withoutTask` and a constant for
  the word** (most-extensible plan). They generalise beyond what the spec
  asks.
- **An optional `asker` defaulting to the tool's** (simplest plan). It lets a
  new caller get the wrong wording silently.

## Steps

1. Tests for the dropped agent's word (`state.test.ts` table for
   `shownStatus`; `pane.test.ts` expected row and drawn row; `art.test.ts`
   mark), seen failing; then `shownStatus` and `agentRowOf`.
2. Tests for the replies (`register.test.ts`), seen failing; then
   `openPane`'s parameter and its five callers.
3. Tests for SubagentStop (`register.test.ts`), seen failing; then
   `replaceBackground` and the handler.
4. Tests for the notification row (`register.test.ts`), seen failing; then the
   hook and the removal.
5. Comments in `types/index.d.ts` on the background list, and the README lines
   on `/pilot`'s reply, background work and dropped agents.
6. The four gates.

## Test plan

- `state.test.ts`: `shownStatus` over pending, running, waiting, idle,
  completed, failed and killed, each with `isListed` true, false and absent.
- `pane.test.ts`: the dropped running agent reads
  `no longer listed Explore · about dropped · - · 5s`; a dropped completed
  agent keeps `completed`; the drawn row contains `no longer listed`, has the
  muted mark and does not change between two times.
- `art.test.ts`: the mark class for `no longer listed` is the muted one.
- `register.test.ts`, the replies: placed, both say the pane is open; waiting
  on width, both quote the reason, only the tool's mentions `/pilot`, and the
  command's mentions widening the terminal.
- `register.test.ts`, SubagentStop: an empty list empties the line; a monitor,
  a shell and a subagent show `2 background tasks`; a missing field and a
  field that is not a list leave the line.
- `register.test.ts`, notification rows: completed, failed and killed rows for
  the listed id empty the line and the row still draws; another id, no id, an
  empty id, status running and a composer origin leave it and write nothing; a
  second draw writes nothing; a later write to the list does not redraw the
  row; the row still draws when the store read or write throws; once the list
  is empty and nothing runs, the live ticker stops redrawing and reading the
  agent list.
