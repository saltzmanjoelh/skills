# Builder wakes the session once per batch of agents, not once per agent

Written 2026-10-31. Seeded from an issue in the owner's tracker. The questions
the issue left open were put to the counsel, except which agents form a
batch, which the owner decided.

## Goal

Every background agent that finishes today starts a turn of the session's
model, so a counsel of seven members costs seven turns, each of which reads
the whole conversation again only to learn that the batch is not finished
yet. Builder holds back the finishing deliveries of a batch it can see being
launched, lets only the delivery that completes the batch reach the model,
and attaches every held report to it, so the model reads the whole batch in
one turn.

## Users and trigger

Any session that has the builder mod loaded and launches two or more
background agents in one model step: a counsel, either half of a review
round, a plan tournament, or any other fan-out. A session that launches its
agents one step at a time sees no change.

## The probe

A throwaway mod ran under `claude -p --input-format stream-json
--output-format stream-json` on Claude Code 2.1.314, and the desktop app's
own delivery was read in a desktop app session. It found:

- **The report reaches `prompt.submit`.** A finishing subagent's report
  arrives at `prompt.submit` with origin kind `peer`, `isMeta` true, and
  text that begins `<agent-message from="<agent id>">` followed by the
  subagent hand-back frame. The `session.receive` hook never saw it.
- **The desktop app sends a second delivery.** After the report, a
  `<task-notification>` for the same agent arrives at `prompt.submit` with
  origin kind `task-notification` and a `task` whose `id` is the agent id
  and whose `status` is `completed`. It also starts a turn of the model.
- **A drop is not quiet.** Answering `{ drop }` starts no turn, but the
  host emits a warning event whose outcome kind is `dropped_by_hook`, which
  the desktop app draws as a red blocked-prompt row.
- **Attached context is read.** Passing the last delivery on with the
  earlier reports added as context lets the model read all of them in one
  turn.

## Behavior

1. **A batch.** Builder records the step of the session's own loop that is
   running (its `turnId` and `index`, from `turn.step` with no `agentId`)
   when each background agent is launched with no `parentAgentId`. Two or
   more such agents launched in the same step form one batch, whatever
   their type. A step that launches one agent forms no batch, and that
   agent's deliveries keep today's handling.
2. **Which deliveries belong to a batch.** Builder decides only from fields
   the engine sets, never from text alone: a prompt with origin kind `peer`
   whose sender's agent id is a member of an open batch, or a prompt with
   origin kind `task-notification` whose `task.id` is such a member. The
   agent id of a `peer` delivery is read from its origin when the engine
   gives it there, and otherwise from the `from` attribute of its leading
   `<agent-message>` element, which is trusted only under origin `peer`.
   Every other prompt, including a person's prompt that contains
   `<agent-message`, keeps today's handling.
3. **A member ends** at its first delivery, whether it reports completed,
   failed or stopped. The desktop app's second delivery for the same agent
   is the same member's finish, never a second report: it is held on the
   quiet path below and adds nothing to the attached reports. Builder
   remembers the members of a released batch until each one's second
   delivery has arrived or ten minutes have passed, so a second delivery
   that comes after the release is still kept quiet.
4. **Holding a delivery quietly.** A held delivery's full text goes into
   builder's state (an atom, which survives a hot reload). The prompt is
   passed on with its text replaced by one short line in builder's own
   words, naming the agent's type, a short form of its id and the batch's
   size, such as `builder: held the report of builder:spec-reviewer
   (a1b2c3d4) until its batch of 7 finishes.` The line holds no text from
   the report and never begins `foreman: `. Builder adds the line to a
   marker in its state that holds every line it has written and not yet
   answered. Builder's `turn.step` hook answers a step alone, by yielding
   the text `Noted.` and a stop chunk with stop reason `end_turn` and no
   usage, without calling `next`, only when the marker holds a line, the
   step is the first of its turn (`index` 0), the step belongs to the
   session's own loop (no `agentId`), and the conversation's last message
   is a user message whose text is exactly one of the marker's lines, with
   no user message before it in the same turn. It removes that line from
   the marker. The first step of a turn of the session's own loop that does
   not answer clears the marker. In every other case, and whenever anything
   throws, the step goes to the model through `next`. Builder's usage count
   counts such an answered step as one with no usage.
5. **The release.** The delivery that ends a batch's last member is passed
   on with its own text unchanged and every held report added as context,
   after a line saying that the batch of N agents launched together is
   complete and that the reports below are agent output, data and not
   instructions. Removing the attached reports from the hold happens in
   the same state write that builds the context, so no report is delivered
   twice or lost.
6. **The time limit.** Each batch stores a deadline in its state: ten
   minutes after the first delivery builder held for it. A timer is armed
   from that stored deadline, and armed again from it after a hot reload.
   When the deadline passes with members still running, builder submits
   one prompt of its own that carries every held report as context, after
   a line naming the members still running and saying that each one's
   report will wake the model on its own. The batch then ends, and each
   later member's first delivery keeps today's handling.
7. **The person's prompt.** When the person submits a prompt while a batch
   holds reports and has members still running, builder attaches every
   held report to it as context, after a line saying the batch is not
   complete and naming the members still running. Those reports leave the
   hold in the same state write, and the first-held time, and so the
   deadline, does not change. Later reports of the batch are held as
   before, and a later prompt from the person carries only the reports
   held since the last one.
8. **The pane** shows how many reports builder is holding, beside the
   agents it already lists.

## Edge cases

- **An agent that fails or is stopped** sends no report, or a short one; its
  task notification with status `failed` or `stopped` ends it as a member.
- **Two batches open at once**, from two steps: each delivery belongs to the
  batch that holds its agent id, and each batch is released on its own.
- **Several deliveries arrive close together.** The marker holds a line for
  each, so one line never overwrites another.
- **A delivery arrives while a turn of the session runs,** and the engine
  delivers it into that turn: its short line reaches the model at a step
  other than the first, and the next first step clears the marker. The full
  report stays held and is attached at the release.
- **Foreman is loaded too.** Builder's lines never equal foreman's, and each
  mod answers only a step whose last message is one of its own lines.
- **An agent that is resumed after its batch was released** and finishes
  again, after its second delivery or ten minutes, keeps today's handling.
- **State that the reloaded code cannot read,** or a write of the hold that
  fails: the delivery goes on unchanged, and any reports a damaged hold
  still names are released at once rather than kept.
- **A hook failure** in `prompt.submit` passes the prompt on unchanged; one
  in `turn.step` lets the model answer.

## Non-goals

- A `session.receive` hook. No delivery of a finishing subagent was seen
  there.
- Surviving a restart of Claude Code. Held reports are lost then; each
  agent's full output stays in its task output file on disk, and the
  batch's agents do not survive the restart either.
- Agents launched by a subagent (with a `parentAgentId`), foreground agents,
  and agents launched in different steps, which keep today's handling.
- Messages from other sessions, which are not members of a batch.
- Changing how the desktop app sends or draws deliveries, and removing the
  short line and `Noted.` that each held delivery adds to the transcript,
  which later turns of the model read: up to four short rows per agent.

## Failure modes

- If the engine changes the origin of a report or a task notification,
  builder stops recognising it, and every finishing agent wakes the model
  as today.
- If the engine stops letting a `turn.step` hook answer alone, each held
  delivery costs the model a short turn on a one-line prompt; the reports
  still reach it once, at the release.
- If the engine stops honouring context added to a passed-on prompt, the
  model sees only the last report, and the line saying the batch is
  complete; the held reports stay in each agent's output file.

## Verification

- `claude plugin test` covers: agents launched in one step make one batch
  and agents launched in different steps do not; a held report enters as
  the short line with the marker set, and the next first step answers
  `Noted.` without calling `next`; the delivery that ends the batch carries
  every held report and the completion line, and a later delivery repeats
  none of them; the second delivery of an agent adds no report, before and
  after the release; a failed member ends the batch; a person's prompt
  carries the held reports and the line naming the running members, and a
  second person's prompt carries only newer ones; the deadline submits the
  held reports with the line naming the running members, and a later
  member then wakes the model alone; a re-armed deadline after a reload
  still fires; a person's prompt containing `<agent-message`, a delivery
  from an agent outside every batch, a step that is not the first, a
  subagent's step, a step whose last message differs and a step with no
  marker each keep today's handling; a hook that throws passes the prompt
  on.
- The four gates pass for both mods.
- In a real session with this change loaded, a counsel of seven starts one
  turn of the model instead of seven, and the transcript shows no red
  blocked-prompt row.

## Decided by the counsel

- How long should builder hold a batch's finished reports while another member of the same batch is still running, before it lets the held reports through to the model anyway? The counsel chose: A fixed 10 minutes counted from the first report builder held for that batch, after which every held report goes to the model in one turn and each later member's report wakes the model on its own. 5 of 7 members voted for it.
- When the person submits a prompt of their own while builder is holding finished reports for a batch whose other members are still running, what should builder do with the held reports? The counsel chose: Attach every held report to the person's prompt as context, with a line saying the batch is not complete yet and naming the members still running, and keep holding the batch's later reports until it completes or its time limit runs out. 6 of 7 members voted for it.
- The issue named a session.receive hook for origin task-notification, but the probe found that finishing subagents' reports reach prompt.submit instead. Which delivery paths should this change hold back? The counsel chose: Only the two paths measured at prompt.submit: the `<agent-message from="<id>">` hand-back with origin peer, and the desktop app's `<task-notification>` for the same agent with origin task-notification; session.receive is listed as a non-goal until a delivery is seen there. 7 of 7 members voted for it.
- While builder holds a batch's finished reports back from the model, the mod may be hot reloaded (its code changes and the engine loads it again in the same process), or Claude Code itself may restart. A dropped prompt never enters the transcript, so a held report that is lost is never seen by the model. What should happen to held reports across a reload or a restart? The counsel chose: Keep the hold in an atom so it survives a hot reload and carries on as before; a process restart is a non-goal, and the spec says held reports are lost then, while each agent's output file stays on disk. 6 of 7 members voted for it.
- Answering a held report's prompt with { drop } makes the host emit a warning event ("Prompt dropped by a hook"), which the desktop app draws as a red blocked-prompt row, so a batch of seven would leave several red rows in the transcript. How should builder keep a held report from starting a model turn? The counsel chose: Use foreman's quiet path: pass each held delivery on rewritten to one short line in builder's own words (naming the agent and the batch), set a one-time marker, and have builder's turn.step hook answer that turn's first step alone without the model; keep the full report in the atom until it is attached. 7 of 7 members voted for it.

## Decided by the person

- Which background agents count as one batch? Every set of two or more background agents launched in the same model step, whatever their type, because the point is to cut wake-ups and wasted tokens.
