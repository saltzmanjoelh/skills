# Builder keeps an agent the engine wakes as a member of its batch

Written 2026-11-02. Seeded from an issue in the owner's tracker that collected
three follow-ups from the change described in
`docs/specs/builder-wakes-once-per-batch.md`. The questions the issue left
open were put to the counsel.

## Goal

Builder holds the reports of agents launched together in one model step and
wakes the session's model once, when the whole batch has ended. A run of seven
agents in the desktop app still made three model turns instead of one. The
cause is that builder takes the engine's own wake of a parked agent for a
resume that the session asked for, and forgets that agent as a member of its
batch. This change keeps such an agent in its batch, so a batch of agents
that move their work into the background again costs one model turn.

The change also settles two smaller follow-ups from the same issue: a
deadline line that the engine refuses is tried again with a growing wait
rather than every minute without end, and a hook test whose second half
cannot fail is renamed to claim only what it proves.

## Users and trigger

Any session that has the builder mod loaded and launches two or more
background agents in one step, where at least one agent moves its own work
into the background, for example a shell command that sleeps or waits on a
long build. Batches whose agents never park see no change.

## The probe

A probe ran the desktop app's own engine (Claude Code 2.1.309) headless under
`claude -p --input-format stream-json --output-format stream-json`, with
builder loaded from its folder beside a small mod that logged every
`prompt.submit`, every first `turn.step` and every `agent.spawn` with all its
fields. It found:

- **The engine wakes a parked agent through `agent.spawn`.** An agent that
  moves its work into the background parks, and when that work finishes the
  engine starts the agent again. That start fires `agent.spawn` with
  `resume.agentId` set to the agent's own id, `background` true and no
  `parentAgentId`. Its prompt begins with a `<task-notification>` element
  whose `<task-id>` names the agent's own background shell task, an id that
  builder never sees, because the agent's tool calls are not the session's.
- **A parking agent reports before it parks.** When the agent ends its
  turn to wait on its background work, the session receives its report and
  then a notification with status `completed`, and only later the engine's
  wake. After the wake the agent sends its final report.
- **A resume the session asks for looks different.** When the session sends
  a running or finished agent a message with SendMessage, `agent.spawn` also
  carries `resume.agentId`, but its prompt is the session's own message.
- **Builder forgot the member at each wake.** The agent's later report and
  notifications then passed as a lone agent's and woke the model, and a
  batch could be released early with no completion line. In the parent's
  desktop run, seven of ten turns after the launch were answered by builder
  without the model, and three reached it.
- **A woken agent often cannot report twice.** A second run with the first
  version of this fix showed that the engine refuses a second handback
  report from the same agent. One woken member ended with plain text, so
  builder kept counting it as running and its batch stayed open until the
  deadline. The engine's notification for that end has a summary saying
  the agent finished, while the notification for a park has a summary
  saying the agent is waiting on its own background work.
- **A report can reach the session after its agent's wake.** The engine
  can hold an agent's report for 13 to 19 seconds before the session
  receives it, and in two of the runs the agent was woken in that gap, one
  and a half and sixteen seconds before its report from before the park
  arrived.
- **Clustered notifications can make builder answer the release turn.**
  A third run showed the engine delivering two to four notifications within
  a fraction of a second and starting one turn for them all. Builder raises
  its count of turns to answer without the model once for each held
  delivery that arrives while the session is idle, so the count was left
  higher than the turns it answered. The spare counts then answered the
  turn that released the batch with "Noted.", because that turn's last
  message is a report from a member of the batch just released, and the
  model never read the completion line in that turn.
- **The completion line reaches the model on an idle release.** A second run
  released a batch while the session was idle, and the model quoted the
  completion line back.

## Behavior

1. **An engine wake keeps the member.** When `agent.spawn` carries a resume
   whose prompt begins with a `<task-notification>` element, builder treats
   it as the engine waking a parked agent. In a batch that is not yet
   released, the agent stays a member and counts as running again, because
   the report it sent before it parked ended it; its later report and
   notifications are then held or end the batch as any member's are. From
   its first wake on, a report from that member no longer ends it, because
   the engine can deliver the report the agent sent before it parked after
   the wake, and that report would end a member that is still running. A
   woken member ends at its notification that says the agent finished, or at
   one that says it failed or was killed. In a batch already released, the
   agent is forgotten, as a resume forgets it today, so that its final
   report reaches the model.
2. **A notification that says the agent finished ends its member.** The
   engine accepts one handback report from each agent, so an agent that
   reported before it parked often ends its woken run with plain text and
   sends no second report. Its only sign of ending is a notification with
   status `completed` whose summary says the agent finished, worded as
   `<summary>Agent "…" finished</summary>`. Builder ends a member at such a
   notification, reading only the engine-written `<summary>` element and
   never the result or note, which can carry the agent's own text. Every
   other `completed` notification, including the one whose summary says the
   agent is waiting on its own background work, stays held and ends nothing,
   as the existing spec says. The rule applies to every member, because the
   finished notification comes after any report the agent made, so for a
   member that already reported it ends nothing new.
3. **Every other resume forgets the member,** as the existing spec says: the
   resume is one the session asked for, so the session already has the
   batch's reports in front of it. When every other member has ended, the
   batch is released with no line, as today.
4. **A refused deadline line backs off.** When the engine refuses the line
   that builder submits at a batch's deadline, or the submit throws, the
   batch stays claimed and is tried again after a wait that starts at one
   minute and doubles after each refusal, up to a ceiling of one hour: 1, 2,
   4, 8, 16 and 32 minutes, then every 60 minutes for as long as the batch
   stays open. The wait is stored in the batch's state, so it survives a hot
   reload. A batch stored by the previous code, without a wait, starts at
   one minute. While the batch waits, a person's prompt still carries the
   line naming the members still running, and a member's later report or
   notification still ends the batch in the usual way.
5. **The release turn reaches the model.** When a delivery that arrives
   while the session is idle releases a batch with the completion line,
   builder clears its count of turns to answer without the model, so the
   turn that carries the line goes to the model. Until that turn's first
   step has run, a held delivery from a member of a released batch does not
   raise the count again. The engine sends each agent's notification after
   its report, and nothing in the engine stops the releasing member's
   notification from arriving before the release turn's first step, which
   would otherwise raise the count and answer that turn with "Noted.". A
   held delivery that arrives after that first step raises the count again
   as usual. If another batch is open at the same moment, or a delivery from
   the same batch was held earlier and the engine gives it a turn of its own
   before the release turn, that delivery's turn may reach the model once,
   which costs one model turn and loses nothing.
6. **The test rename.** The hook test that claimed a person's prompt after a
   held member's notification goes to the model is renamed to claim only
   that a report whose turn finds the last member's notification last is
   answered without the model, and its second half, which could not fail,
   is deleted. The person's-prompt case stays covered by the hook test of a
   first step whose last message is a user message and by the unit test of
   the frame check.

## Edge cases

- **A session message that begins with a `<task-notification>` element**
  would be taken for the engine's wake and keep the member. The member then
  ends only at a notification that says the agent finished, failed or was
  killed, as any woken member does, so the worst case is a batch that waits
  until its deadline. Checking that the
  notification names the agent's own task is not possible, because that id
  names the agent's shell task, which builder never sees.
- **An agent woken by the engine after its batch was released** is
  forgotten in that remembered batch, as today, so its final report wakes
  the model on its own.
- **Every member parks before any is woken.** Each report before a park
  ends its member, so the batch is released on those reports with the
  completion line, and each final report after a wake then reaches the
  model on its own. Builder cannot know at a report that a wake will
  follow, so this case keeps today's cost.
- **An agent woken several times** stays a member through every wake.
- **A batch that keeps its line refused for hours** costs one hook-chain
  call and one state write an hour once the wait reaches its ceiling.

## Non-goals

- **(a) A run inside the desktop app itself.** Only the person or a session
  in the app can launch it. The headless runs on the app's own engine stand
  in for it, and the pull request says that the desktop run has not been
  made.
- **(b) Telling a session message that begins with a `<task-notification>`
  element apart from the engine's wake.** No check can be built, because the
  notification's task id names a shell task builder never sees. Such a
  message keeps the member until a notification that says the agent
  finished, failed or was killed, or until the batch's deadline.
- **(c) The mod's other retry policies,** such as the stuck-prompt
  reminder's fixed retry on refusal. They stay as they are.
- **(d) A member that the session resumed and the engine later woke** stays
  forgotten, as today, because the session's resume already took it out of
  its batch.

## Failure modes

- **A wake that the engine changes in a later version,** so that its prompt
  no longer begins with a `<task-notification>` element, falls back to
  today's handling: the member is forgotten and its later report wakes the
  model. That costs extra turns and loses nothing.
- **State that the reloaded code cannot read,** or a write that fails, keeps
  the existing spec's handling: the delivery goes on unchanged and reaches
  the model.
- **A finished summary that the engine words differently in a later
  version** no longer matches, so a woken member that ends with plain text
  holds its batch until the deadline, which is how such a batch behaved
  before this change. Nothing is lost.

## Verification

- `claude plugin test` covers: a resume whose prompt begins with a
  `<task-notification>` element keeps the member and counts it as running
  again after the report it sent before parking, so its final report is
  still held and the batch is released once, with the completion line; such
  a resume after the batch was released forgets the member there, so its
  final report passes; a
  resume whose prompt is the session's own text forgets the member, as
  today; a report from before the park that arrives after the wake does not
  end the woken member, which ends at its finished notification; a refused deadline line is tried again after 1, 2, 4, 8, 16, 32
  and then 60 minutes, and again at 60 minutes after that; a stored batch
  without a wait starts at one minute; a deadline line the engine takes
  after refusals ends the batch; a `completed` notification whose summary
  says the agent finished ends its member, so a woken member that ends with
  no second report still lets its batch be released once, with the
  completion line; a `completed` notification whose summary says the agent
  is waiting on its own background work ends nothing; and the word
  finished in the result or note, outside the summary, ends nothing; and a
  release that comes after more idle deliveries than turns clears the count,
  so the release turn reaches the model; and the releasing member's own
  notification, arriving after the release and before the release turn's
  first step, does not stop that turn from reaching the model. Each
  new test fails when its change is removed.
- The four gates pass for both mods.
- Before the pull request merges, the headless probe on the desktop app's
  engine runs twice with the fixed builder, and the pull request records
  both results. In the first run, seven agents launched in one message each
  move a sleep into the background, and exactly one model turn follows the
  launch, carrying the completion line. In the second, the session resumes
  one member with SendMessage partway through the batch, and that member is
  forgotten while the rest are still released as one batch.

## Decided by the counsel

- How should builder tell the engine's own wake of a parked batch member apart from a resume that the session asks for, so that only the session's resume forgets the agent as a member of its batch? The counsel chose: Treat a resume whose prompt begins with a <task-notification> element as the engine's wake: it keeps the agent as a member, and every other resume forgets it. 5 of 7 members voted for it.
- When the engine refuses builder's deadline line, how often should builder try again? The counsel chose: Double the wait after each refusal, starting at one minute, up to a ceiling of one hour, and keep trying at that ceiling for as long as the batch stays open. 6 of 7 members voted for it.
- How should the hook test whose second half cannot fail be fixed? The counsel chose: Rename the test so its name claims only what its first half proves, and leave the person's-prompt case to the tests that already cover it. 5 of 7 members voted for it.
- What evidence from the real engine must the pull request carry before it merges, beyond the hook tests? The counsel chose: Same headless run, plus a second scenario in which the session resumes one member with SendMessage mid-batch, recording that this member is forgotten and the rest still release as one batch. 6 of 7 members voted for it.
- Which of these does the change deliberately leave out, as non-goals? The counsel chose: All four: (a), (b), (c) and (d) are non-goals. 7 of 7 members voted for it.
- A batch member that the engine woke may end without a second report. Which delivery should end such a member? The counsel chose: End a member only at a `completed` notification whose summary says the agent finished; every other `completed` notification stays held and ends nothing. 5 of 7 members voted for it.
