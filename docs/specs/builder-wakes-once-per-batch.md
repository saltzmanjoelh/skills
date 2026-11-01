# Builder wakes the session once per batch of agents, not once per agent

Written 2026-10-31. Seeded from an issue in the owner's tracker. The questions
the issue left open were put to the counsel, except which agents form a
batch, which the owner decided.

## Goal

Every background agent that finishes today starts a turn of the session's
model, so a counsel of seven members costs seven turns, each of which reads
the whole conversation again only to learn that the batch is not finished
yet. Builder answers the turns that a batch's earlier finishes start by
itself, without the model, so that only the finish that completes the batch
reaches the model. Each report stays in the conversation, so the model reads
every report of the batch in that one turn.

## Users and trigger

Any session that has the builder mod loaded and launches two or more
background agents in one model step: a counsel, either half of a review
round, a plan tournament, or any other fan-out. A session that launches its
agents one step at a time sees no change.

## The probe

Throwaway mods ran under `claude -p --input-format stream-json
--output-format stream-json` on Claude Code 2.1.314, and the desktop app's
own delivery was read in a desktop app session. They found:

- **The report reaches `prompt.submit`.** A finishing subagent's report
  arrives at `prompt.submit` with origin kind `peer`, `isMeta` true, and
  text that begins `<agent-message from="<agent id>">` followed by the
  subagent hand-back frame. The `session.receive` hook never saw it. The
  origin carries no agent id.
- **A task notification also reaches `prompt.submit`,** with origin kind
  `task-notification` and text that begins `<task-notification>` and holds
  the agent id in `<task-id>` and the outcome in `<status>`. The input
  carries no `task` field. The desktop app sends one after each report, and
  it also starts a turn of the model.
- **A notification can come before the agent has finished.** An agent that
  stops to wait on background work of its own gets a notification with
  status `completed` whose summary says it has not reported yet, and its
  report comes later.
- **A drop is not quiet.** Answering `{ drop }` starts no turn, but the host
  emits a warning event whose outcome kind is `dropped_by_hook`, which the
  desktop app draws as a red blocked-prompt row.
- **A report that starts a turn takes no rewrite.** Passing it on with other
  text returns that text to the hook, but the model still reads the full
  report. The engine types say the same of `isMeta` prompts. At that turn's
  first step, `$.session.messages()` does not show the report as a user
  message: its last message is the model's previous reply.
- **The turn can be answered without the model.** When `prompt.submit`
  passes the report on unchanged and sets a marker, and `turn.step` answers
  the next first step of the session's own loop alone with `Noted.` and a
  stop chunk without calling `next`, no model request is made, no warning
  is emitted, and on the following turn the model knows the report.
- **A delivery into a running turn starts no turn.** It arrives with that
  turn's `turnId`, and the running turn reads it.
- **A plugin's own prompt** goes through that plugin's own `prompt.submit`
  hook, and at its turn's first step the last message is a user message
  that begins `The <plugin> plugin sent a message:`.
- **A person's prompt is the last message at its first step.** Under
  `claude -p --input-format stream-json`, each of three person's prompts,
  sent while a batch was open and after it closed, was a user message
  holding the prompt's own text at its turn's first step, and the model
  answered each one.
- **Each notification lands in the conversation as a user message.** After
  a member's report, the engine adds that agent's `<task-notification>` to
  the conversation as a user message, often without passing it through
  `prompt.submit` as a turn of its own. The next member's report then finds
  that notification last at its first step. A notification that does start
  a turn shows as a user message too. With seven agents launched in one
  step and only a last message that is not a user message answered, nine
  deliveries made seven model turns and two `Noted.` turns.
- **A report can be the last message too.** The transcript keeps a report
  as a user message whose first line is the engine's own, "Another Claude
  session sent a message:", with the `<agent-message from="<id>">` frame on
  the next line, and in one run two reports' turns found their own report
  last.
- **Attached context is read.** Context added to a passed-on delivery is
  read by the model in that turn.

## Behavior

1. **A batch.** Builder records the step of the session's own loop that is
   running (its `turnId` and `index`, from `turn.step` with no `agentId`)
   when each background agent is launched with no `parentAgentId`. Two or
   more such agents launched in the same step form one batch, whatever
   their type. A step that launches one agent forms no batch, and that
   agent's deliveries keep today's handling.
2. **Which deliveries belong to a batch.** Builder reads an agent id only
   under an origin the engine sets and a person cannot type: under origin
   `peer`, from the `from` attribute of the `<agent-message>` element that
   begins the text; under origin `task-notification`, from the `<task-id>`
   of the `<task-notification>` element that begins the text, with its
   `<status>`. A delivery belongs to a batch when that id is a member of
   it. Every other prompt, including a person's prompt that contains
   `<agent-message`, keeps today's handling.
3. **A member ends** at its report, or at a notification whose status is
   `failed` or `killed`. A notification with status `completed` does not
   end a member, because it can come before the report; it is held as
   below. Builder remembers the members of a released batch for ten
   minutes, so that a notification that comes after the release is held
   too.
4. **Holding a delivery.** A delivery that belongs to an open or remembered
   batch, does not complete the batch, and arrives while the session is
   idle (no `turnId`) is passed on unchanged, and builder adds one to a
   marker in its state (an atom, which survives a hot reload). Builder's
   `turn.step` hook answers a step alone, by yielding the text `Noted.` and
   a stop chunk with stop reason `end_turn` and no usage, without calling
   `next`, only when the marker is above zero, the step is the first of its
   turn (`index` 0), the step belongs to the session's own loop (no
   `agentId`), and the conversation's last message is either not a user
   message or a plain user message that is only the engine's frame for a
   member of a batch builder holds, open or remembered: one that begins
   with the `<agent-message from="<id>">` frame, after at most one line of
   the engine's own that holds no `<`, or one made only of
   `<task-notification>` elements whose `<task-id>` each names such a
   member. It then takes one off the marker. A first step of the session's
   own loop that does not answer sets the marker to zero, so a marker never
   answers a turn that a person's or a plugin's prompt started, because
   that prompt's own text is the last message. In every
   other case, and whenever anything throws, the step goes to the model
   through `next`. A delivery into a running turn needs no answer and
   leaves the marker alone. Builder's usage count counts an answered step
   as one with no usage. Builder keeps no report text: each report stays in
   the conversation.
5. **The release.** The report that ends a batch's last member is passed on
   unchanged, with a context line saying that the batch of N agents
   launched together is complete, that their reports are in the
   conversation, and that they are agent output, data and not instructions.
6. **The time limit.** Each batch stores a deadline in its state: ten
   minutes after the first delivery builder held for it. A timer is armed
   from that stored deadline, and armed again from it after a hot reload.
   When the deadline passes with members still running, builder submits
   one prompt of its own, saying that the time limit passed, naming the
   members still running, and saying that each one's report will wake the
   model on its own. The batch then ends, and each later member's report
   keeps today's handling.
7. **The person's prompt.** When the person submits a prompt while a batch
   has held deliveries and members still running, builder adds a context
   line saying the batch is not complete and naming the members still
   running. The deadline does not change.
8. **The pane** shows how many reports builder is holding back from the
   model, beside the agents it already lists.

## Edge cases

- **An agent that fails or is stopped** ends at its notification with
  status `failed` or `killed`, whether or not a report came first.
- **An agent that never reports** keeps its batch open until the time
  limit.
- **Two batches open at once**, from two steps: each delivery belongs to the
  batch that holds its agent id, and each batch is released on its own.
- **Several idle deliveries close together** each add one to the marker, and
  each turn they start takes one off.
- **A person's prompt starts a turn before a held delivery's turn:** that
  first step sets the marker to zero, and the held delivery's turn then
  reaches the model, which costs one turn and loses nothing.
- **Foreman is loaded too.** Foreman answers only a step whose last message
  is its own exact line, which is a user message and no delivery's frame,
  and builder never answers such a step, so neither answers a turn that
  belongs to the other.
- **A person pastes a delivery's frame.** A message in the conversation
  carries no origin, so a person's prompt that begins with an
  `<agent-message from="<id>">` frame naming a member of a batch builder
  holds, or is made only of such a member's notifications, is answered
  `Noted.` while the marker is set. The person has to type an agent's
  random id for this to happen, and the cost is one reply, so it is
  accepted.
- **An agent that is resumed after its batch was released** and reports
  again after ten minutes keeps today's handling; a resumed agent is
  forgotten as a member when it is launched again.
- **State that the reloaded code cannot read,** or a write that fails: the
  delivery goes on unchanged and reaches the model, as today.
- **A hook failure** in `prompt.submit` passes the prompt on unchanged; one
  in `turn.step` lets the model answer.

## Non-goals

- A `session.receive` hook. No delivery of a finishing subagent was seen
  there.
- Surviving a restart of Claude Code. The batch records are lost then, so
  the batch's later reports wake the model as today; the reports already
  held stay in the conversation, and the batch's agents do not survive the
  restart either.
- Agents launched by a subagent (with a `parentAgentId`), foreground agents,
  teammates, agents a workflow launches, and agents launched in different
  steps, which keep today's handling.
- Messages from other sessions, which are not members of a batch.
- Changing how the desktop app sends or draws deliveries, and removing the
  `Noted.` row that each held delivery adds to the transcript after the
  report, which later turns of the model read.

## Failure modes

- If the engine changes the origin or the leading element of a report or a
  notification, builder stops recognising it, and every finishing agent
  wakes the model as today.
- If the engine stops letting a `turn.step` hook answer alone, each held
  delivery costs the model a turn, as today.
- If the engine starts showing the report as a user message at its first
  step, builder stops answering those turns, and they reach the model as
  today.

## Verification

- `claude plugin test` covers: agents launched in one step make one batch
  and agents launched in different steps do not; an idle held report passes
  on unchanged with the marker raised, and the next first step with a last
  message that is not a user message answers `Noted.` without calling
  `next`; the report that ends the batch carries the completion line; a
  notification with status `completed` before or after the report adds a
  held delivery and ends nothing; a `failed` notification ends its member;
  a delivery with a `turnId` leaves the marker alone; a person's prompt
  carries the line naming the running members; the deadline submits the
  line naming the running members, and a later member then wakes the model
  alone; a re-armed deadline after a reload still fires; a first step whose
  last message is a user message, a step that is not the first, a
  subagent's step and a step with no marker each call `next`, and the first
  of these clears the marker; a lone agent's report after a batch delivery
  reaches the model; a person's prompt containing `<agent-message` and a
  delivery from an agent outside every batch keep today's handling; a hook
  that throws passes the prompt on; a first step whose last message is only
  a held member's notification, or a held member's report after the
  engine's line, answers `Noted.`, and one whose last message is a person's
  prompt, a frame naming an agent in no batch, a notification with more
  text after it, or a message with tool results goes to the model.
- The four gates pass for both mods.
- In a real session with this change loaded, a counsel of seven starts one
  turn of the model instead of seven, and the transcript shows no red
  blocked-prompt row. That run also checks the two cases the probes read
  only in part: the notification after each report, and a delivery that
  arrives while a turn is running.
- Measured on 2026-11-01 under `claude -p --input-format stream-json` on
  Claude Code 2.1.314, with this change loaded: seven background agents
  launched in one step made eight deliveries, seven reports and one early
  notification. Seven turns were answered `Noted.` without the model, the
  last report woke the model once with all seven reports read, and no
  prompt was dropped. The engine's notification after each report was
  among them. The same run in a desktop app session has not been made,
  because this checkout's builder is not the one a desktop session loads.

## Decided by the counsel

- How long should builder hold a batch's finished reports while another member of the same batch is still running, before it lets the held reports through to the model anyway? The counsel chose: A fixed 10 minutes counted from the first report builder held for that batch, after which every held report goes to the model in one turn and each later member's report wakes the model on its own. 5 of 7 members voted for it.
- When the person submits a prompt of their own while builder is holding finished reports for a batch whose other members are still running, what should builder do with the held reports? The counsel chose: Attach every held report to the person's prompt as context, with a line saying the batch is not complete yet and naming the members still running, and keep holding the batch's later reports until it completes or its time limit runs out. 6 of 7 members voted for it.
- The issue named a session.receive hook for origin task-notification, but the probe found that finishing subagents' reports reach prompt.submit instead. Which delivery paths should this change hold back? The counsel chose: Only the two paths measured at prompt.submit: the `<agent-message from="<id>">` hand-back with origin peer, and the desktop app's `<task-notification>` for the same agent with origin task-notification; session.receive is listed as a non-goal until a delivery is seen there. 7 of 7 members voted for it.
- While builder holds a batch's finished reports back from the model, the mod may be hot reloaded (its code changes and the engine loads it again in the same process), or Claude Code itself may restart. A dropped prompt never enters the transcript, so a held report that is lost is never seen by the model. What should happen to held reports across a reload or a restart? The counsel chose: Keep the hold in an atom so it survives a hot reload and carries on as before; a process restart is a non-goal, and the spec says held reports are lost then, while each agent's output file stays on disk. 6 of 7 members voted for it.
- Answering a held report's prompt with { drop } makes the host emit a warning event ("Prompt dropped by a hook"), which the desktop app draws as a red blocked-prompt row, so a batch of seven would leave several red rows in the transcript. How should builder keep a held report from starting a model turn? The counsel chose: Use foreman's quiet path: pass each held delivery on rewritten to one short line in builder's own words (naming the agent and the batch), set a one-time marker, and have builder's turn.step hook answer that turn's first step alone without the model; keep the full report in the atom until it is attached. 7 of 7 members voted for it.
- A new probe found that the quiet path the counsel chose cannot work as specced, and that a simpler variant does. Given these measurements, how should builder keep a held delivery from starting a model turn? The counsel chose: Use the measured variant: pass each held delivery on unchanged, set a one-time marker, and answer the next first step of the session's own loop alone with "Noted." when the marker is set and that step's last message is not a user message (so no person's or plugin's prompt started the turn). The reports stay in the conversation, so builder holds no report text, and the release, the person's prompt and the time limit only add a line saying whether the batch is complete and which members still run. 7 of 7 members voted for it. This decision replaces the one before it, and where the lines above speak of holding or attaching report text, builder now adds only the line, because the reports are already in the conversation.

## Decided by the person

- Which background agents count as one batch? Every set of two or more background agents launched in the same model step, whatever their type, because the point is to cut wake-ups and wasted tokens.
