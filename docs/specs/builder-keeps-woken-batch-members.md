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
  whose `<task-id>` names the agent's own background shell task, an id
  that only the agent's own tool call returned.
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
- **Not every notification passes through the prompt submission hook.**
  After a burst of idle deliveries, a notification that leaves the engine's
  queue together with a peer's report, or alone a few seconds after a
  report, reaches the conversation without passing through
  `prompt.submit`. A run with a rule that only a notification ends a woken
  member left five of seven members running and never released its batch.
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
- **An agent can report while its own work still runs.** Three runs on the
  same engine made 2, 4 and 3 model turns after the launch instead of one.
  Agents started a Monitor beside their background sleep, reported while the
  Monitor still ran, and were counted as ended; after the release the engine
  woke them again, and each second report made a model turn of its own.
- **Builder can see whether a member's own work still runs.** A probe that
  logged `tool.call` and `classic.SubagentStop` found that `tool.call` fires
  for every subagent tool call with the agent's id, and its result carries
  `backgroundTaskId` for a Bash call moved to the background and `taskId`
  for a Monitor. SubagentStop fires at every turn end of a subagent, not only
  at reports, with `agent_id`, 0.04 to 0.06 seconds after the agent's
  handback and always before its report passes `prompt.submit`. Its
  `background_tasks` list covers the whole session and has no owner field,
  so ownership comes from the task ids that `tool.call` recorded. In all ten
  reports of the probe, the member's own task was listed when it reported
  with live work, and none of its tasks was listed when it reported with
  nothing left running.
- **A woken turn can end with plain text and no handback.** SubagentStop then
  fires with none of the member's own tasks listed, and the finished
  notification that follows usually does not pass `prompt.submit`.

## Behavior

1. **An engine wake keeps the member.** When `agent.spawn` carries a resume
   whose prompt begins with a `<task-notification>` element, builder treats
   it as the engine waking a parked agent. In a batch that is not yet
   released, the agent stays a member and counts as running again; its later
   report and notifications are then held or end the batch as any member's
   are. In a batch already released, the agent is forgotten, as a resume
   forgets it today, so that its final report reaches the model. A report
   that the agent sent before it parked but that the engine delivers after
   the wake ends nothing when builder saw the agent's turn end with its own
   work running, as the next item describes. For a member whose turn end
   builder never saw, that late report ends the member early, because builder cannot tell it
   from the agent's final one; the batch can then be released before that
   agent finishes, and its final report is answered with "Noted.", as any
   delivery from a member of a released batch is, so the model reads it at
   its next turn. A wake makes the batch incomplete again, so when a turn
   end had ended its last member and saved the deadline it replaced, as
   item 3 describes, the wake gives back that saved deadline together with
   the wait saved beside it. A chain of wakes and turn ends therefore never
   shrinks a wait that refused lines grew, while the wait of a claim made
   inside the settle minute is still dropped, because it was never saved.
   `docs/specs/builder-batch-wake-follow-ups.md` gives the reasons.
2. **A member ends only when none of its own background work is running.**
   When a member's tool call returns a `backgroundTaskId` or a `taskId`,
   builder stores that id with the member in the batch state. At each
   SubagentStop for a member, builder records whether any of the member's
   own task ids is listed in the event's `background_tasks`, which lists only
   work still in flight. A report ends the member only when its last
   SubagentStop listed none of its own tasks. Builder also records with the
   member that the engine has woken it, as item 1 describes. Only a member
   that the engine has woken ends at a SubagentStop that lists none of its
   own tasks, even without a report, because a woken agent often ends with
   plain text and the engine accepts only one handback report from each
   agent, and only such a member ends at a `completed` notification whose
   `<summary>` element says the agent finished (`Agent "…" finished`), again
   only when its last SubagentStop listed none of its own tasks. A member
   that the engine never woke ends, as before this change, only at its
   report or at a notification that it failed or was killed, so a batch
   whose agents never park is released by its last report, as before. A
   notification that the agent failed or was killed ends a member always.
   A member for which builder saw no SubagentStop, for example after a hot
   reload or a dropped event, ends at its report, or, when it was woken, at
   its finished notification, so the batch is never stranded. A listed task that builder did not record
   from the member's own tool calls does not count against it. Builder reads
   only the engine-written `<summary>` element of a notification, never the
   result or note, which can carry the agent's own text, and every other
   `completed` notification, including the one whose summary says the agent
   is waiting on its own background work, stays held and ends nothing. The
   task ids, the last reading and the record of a wake are dropped when the
   batch is released, so nothing carries over to a later batch.
3. **The release after a turn end reaches the model once.** When the last
   member ends at a SubagentStop rather than at a delivery, which only a
   member that the engine has woken can do, the batch is not
   released at that moment, because the member's report normally follows
   within seconds and the model should read it in the release turn. Builder
   sets the batch's deadline to one minute from then instead. The next
   delivery from a member of the batch that passes the prompt submission
   hook, normally that report, releases the batch with the completion line.
   When no delivery passes the hook within the minute, as when the woken
   turn ended with plain text and its finished notification skipped the
   hook, the deadline's timer submits the completion line as its own prompt,
   through the same path and with the same back-off as the deadline line,
   and once the engine takes it the batch is released and remembered, so
   that a later delivery from it is answered with "Noted.". Builder records
   with each claim whether the line it claimed is the completion line. While
   a claimed completion line is not yet taken, a delivery from the batch is
   held and adds no second line. A person's prompt during the minute carries
   no line naming members still running, because none is.
4. **Every other resume forgets the member,** as the existing spec says: the
   resume is one the session asked for, so the session already has the
   batch's reports in front of it. When every other member has ended, the
   batch is released with no line, as today.
5. **A refused deadline line backs off.** When the engine refuses the line
   that builder submits at a batch's deadline, or the submit throws, the
   batch stays claimed and is tried again after a wait that starts at one
   minute and doubles after each refusal, up to a ceiling of one hour: 1, 2,
   4, 8, 16 and 32 minutes, then every 60 minutes for as long as the batch
   stays open. The wait is stored in the batch's state, so it survives a hot
   reload, and it survives an engine wake that gives back a deadline saved
   at a turn end, because the wait is saved and given back beside that
   deadline, as item 1 says. A batch stored by the previous code, without a
   wait, starts at one minute. While the batch waits, a person's prompt still carries the
   line naming the members still running, and a member's later report or
   notification still ends the batch in the usual way: the delivery that
   comes once every member has ended, even when the last one ended at a
   SubagentStop, releases the batch with the completion line, and the engine
   taking the deadline line after that changes nothing. When the engine takes
   the deadline line first, the batch is dropped, so that each report still
   to come wakes the model on its own, as that line said, even when every
   member has ended at a SubagentStop since the claim.
6. **The release turn reaches the model.** When a delivery that arrives
   while the session is idle releases a batch with the completion line,
   builder clears its count of turns to answer without the model, so the
   turn that carries the line goes to the model, and it marks the state as
   releasing until that turn's first step has run. While the state is
   marked as releasing, a held delivery from any batch, released or still
   open, does not raise the count again, so the release turn always reaches
   the model. Without that rule, the releasing member's own notification, or
   a held delivery from a second batch still open, could arrive before the
   release turn's first step, raise the count and answer that turn with
   "Noted."; `docs/specs/builder-batch-wake-follow-ups.md` gives the reasons
   for covering every batch. A held delivery that arrives after that first
   step raises the count again as usual. If a delivery from another open
   batch, or one from the same batch that was held earlier, gets a turn of
   its own before the release turn, that turn may reach the model once,
   which costs one model turn and loses nothing.
7. **The test rename.** The hook test that claimed a person's prompt after a
   held member's notification goes to the model is renamed to claim only
   that a report whose turn finds the last member's notification last is
   answered without the model, and its second half, which could not fail,
   is deleted. The person's-prompt case stays covered by the hook test of a
   first step whose last message is a user message and by the unit test of
   the frame check.

## Edge cases

- **A session message that begins with a `<task-notification>` element**
  would be taken for the engine's wake and keep the member. The member then
  ends as the batch's other members do, so the worst case is a batch that
  waits until its deadline.
- **An agent woken by the engine after its batch was released** is
  forgotten in that remembered batch, as today, so its final report wakes
  the model on its own.
- **Every member parks before any is woken.** A member whose turn end
  listed its own work is not ended by its report, so the batch waits for
  the wakes. For members whose turn ends builder never saw, each report
  before a park ends its member, the batch is released on those reports,
  and each final report after a wake reaches the model on its own.
- **An agent woken several times** stays a member through every wake.
- **A member whose own watcher never ends** holds its batch until the
  deadline, which stays the backstop.
- **A delivery from another member in the minute after the last turn end**
  of a batch whose last member the engine woke releases the batch, so the
  release turn can start before the last member's report arrives. That report is then answered with "Noted." and
  the model reads it at its next turn.
- **A batch that keeps its line refused for hours** costs one hook-chain
  call and one state write an hour once the wait reaches its ceiling.

## Non-goals

- **(a) A run inside the desktop app itself.** Only the person or a session
  in the app can launch it. The headless runs on the app's own engine stand
  in for it, and the pull request says that the desktop run has not been
  made.
- **(b) Telling a session message that begins with a `<task-notification>`
  element apart from the engine's wake.** The wake is still recognised by
  its shape alone, although builder now records a member's task ids and
  could match the notification's task id against them. Such a message keeps
  the member until it ends as any member ends or the batch's deadline
  passes.
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
  version** no longer matches, so such a notification ends nothing, and the
  member ends at its turn end or its report instead.
- **A later engine that stops listing a subagent's own work in
  `background_tasks`, or stops returning task ids at `tool.call`,** makes a
  member end at its report, or a woken member at its first turn end, even
  while its work runs, as before this change. That costs extra model turns and loses nothing.
- **A SubagentStop that never reaches builder** leaves the member's last
  reading as it was. With no reading at all, the member ends at its report,
  as before this change; with a reading that listed its work, it ends at a
  later turn end, or the batch waits for its deadline.

## Verification

- `claude plugin test` covers: a resume whose prompt begins with a
  `<task-notification>` element keeps the member and counts it as running
  again after the report it sent before parking, so its final report is
  still held and the batch is released once, with the completion line; such
  a resume after the batch was released forgets the member there, so its
  final report passes; a resume whose prompt is the session's own text
  forgets the member, as today; a report sent before the park that arrives
  after the wake ends a member for which no turn end was seen; a refused
  deadline line is tried again after 1, 2, 4, 8, 16, 32 and then 60
  minutes, and again at 60 minutes after that; a stored batch without a wait
  starts at one minute; a deadline line the engine takes after refusals ends
  the batch; a `completed` notification whose summary says the agent
  finished ends a member that the engine woke; one whose summary says the agent is waiting on
  its own background work ends nothing, nor does the word finished outside
  the summary; a release that comes after more idle deliveries than turns
  clears the count, so the release turn reaches the model; and neither the
  releasing member's own notification nor a held delivery from a second
  batch still open, arriving before the release turn's first step, stops
  that turn from reaching the model.
- For this change, `batch.test.ts` covers: a member that reports while its
  own Monitor is still listed is not ended, the batch stays open, and its
  later report after a clean turn end releases the batch once; a woken
  member whose turn ends with plain text and nothing of its own listed ends
  there, and the next delivery releases the batch with the completion line;
  a member that the engine never woke does not end at a clean turn end, and
  in a batch whose agents never park a finished notification after every
  turn end releases nothing and the last report carries the completion
  line; after a deadline line names a woken member, its clean turn end and
  report release the batch with the completion line and the engine taking
  that line afterwards changes nothing, while the engine taking it before
  the report drops the batch so that the report passes; the records of a
  wake and of a claimed completion line read back, are refused in any other
  shape and are dropped at release;
  a member with no SubagentStop seen ends at its report, as before; a listed
  task the member did not start does not hold it; a failed notification
  ends a member whose work is listed; the task ids are dropped at release;
  the deadline claims a batch whose last member ended at a turn end with the
  completion line one minute later, releases it once the engine takes the
  line, and holds a delivery that arrives while the line is claimed without
  a second line; and stored members with and without the new fields read
  back. `batches.test.ts` drives `tool.call`, `classic.SubagentStop` and
  `prompt.submit` in the engine's order: a member that reports while its
  Monitor runs is held, and the batch is released once, with the completion
  line, at its clean final report; and a woken member that ends with plain
  text, whose finished notification never passes the hook, has the
  completion line submitted one minute later, once; in a batch whose agents
  never park, with both turn ends before one member's finished notification,
  that notification is held without the completion line and the last report
  carries it; and the last report of a batch whose deadline line was refused
  carries the completion line after its member's clean turn end. Each new test fails when
  its piece of the change is removed.
- The four gates pass for both mods.
- Before the pull request merges, the headless probe on the desktop app's
  engine runs twice with the fixed builder, and the pull request records
  both results. In the first run, seven agents launched in one message each
  move a sleep into the background, some also start a Monitor, and exactly
  one model turn follows the launch, carrying the completion line. In the second, the session resumes
  one member with SendMessage partway through the batch, and that member is
  forgotten while the rest are still released as one batch.

## Decided by the counsel

- How should builder tell the engine's own wake of a parked batch member apart from a resume that the session asks for, so that only the session's resume forgets the agent as a member of its batch? The counsel chose: Treat a resume whose prompt begins with a <task-notification> element as the engine's wake: it keeps the agent as a member, and every other resume forgets it. 5 of 7 members voted for it.
- When the engine refuses builder's deadline line, how often should builder try again? The counsel chose: Double the wait after each refusal, starting at one minute, up to a ceiling of one hour, and keep trying at that ceiling for as long as the batch stays open. 6 of 7 members voted for it.
- How should the hook test whose second half cannot fail be fixed? The counsel chose: Rename the test so its name claims only what its first half proves, and leave the person's-prompt case to the tests that already cover it. 5 of 7 members voted for it.
- What evidence from the real engine must the pull request carry before it merges, beyond the hook tests? The counsel chose: Same headless run, plus a second scenario in which the session resumes one member with SendMessage mid-batch, recording that this member is forgotten and the rest still release as one batch. 6 of 7 members voted for it.
- Which of these does the change deliberately leave out, as non-goals? The counsel chose: All four: (a), (b), (c) and (d) are non-goals. 7 of 7 members voted for it.
- A batch member that the engine woke may end without a second report. Which delivery should end such a member? The counsel chose: End a member only at a `completed` notification whose summary says the agent finished; every other `completed` notification stays held and ends nothing. 5 of 7 members voted for it. Replaced by the two decisions below.
- The engine rerun at head 6cb9c038 failed: the batch was never released, because builder never sees many of the notifications that say an agent finished. How should the pull request fix this? The counsel chose: Go back to the rule under which both earlier runs passed, so that a report ends a woken member again, beside the finished notification. 7 of 7 members voted for it.
- Members that report while their own background work still runs are counted as ended, and the engine wakes them again after the release. How should a member end? The counsel chose: At each SubagentStop for a member, record whether any background task that member started (task ids from tool.call) is still running in background_tasks; a report or finished notification ends the member only when its last SubagentStop showed none of its own tasks running, and a member whose turn ended with none running ends there even without a report. Store the member's task ids in the batch state. 7 of 7 members voted for it.
- How should builder release a batch whose last member ends at a turn end, now that a batch whose agents never park can be released before its last report? The counsel chose: Only a member that the engine has woken can end at a turn end. A member that was never woken ends, as on the base branch, only at its report or at a failed or killed notification, and a report still ends it only when its last turn end showed none of its own tasks running. A batch whose agents never park then behaves exactly as on the base branch. Change spec Behavior 2 and 3 to say so. 7 of 7 members voted for it.
