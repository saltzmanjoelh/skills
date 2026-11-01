# Plan: builder wakes the session once per batch of agents

Written 2026-10-31 for `docs/specs/builder-wakes-once-per-batch.md`. Three
planners wrote plans blind to each other, from a simplest, a most robust and
a most extensible prior, and a judge scored them against the spec, the owner's
preferences and the edge cases their state creates.

## Chosen approach

The most extensible plan won, narrowly over the simplest one. It keeps the
fewest pieces of state, it shows the pane count as reports rather than as all
deliveries, as the spec's eighth point says, and it filters launches and
status-file writes correctly. It needed two fixes that only the most robust
plan saw, which are the first two grafts below.

- **A pure module.** A new file, `mods/builder/hooks/batch.ts`, holds every
  batch decision as a pure function over one state value. Each function
  returns the new state and what to do with the prompt: pass it on
  unchanged, pass it on unchanged and raise the marker, or pass it on with
  one context line added. `register.tsx` only adapts the engine's hooks to
  these functions, so each decision and its state change are one `update`
  write.
- **One atom.** The state lives in a new atom, `batches`, holding a version
  number, the batches and the counter marker. A value the code cannot read,
  including one with another version, counts as empty, so every delivery
  then keeps today's handling. No report text is kept anywhere, because each
  report stays in the conversation.
- **Identification in one place.** `deliveryOf(origin, text)` reads an agent
  id only under origin `peer`, from the leading `<agent-message from>`, and
  under origin `task-notification`, from the leading `<task-notification>`
  element's `<task-id>` and `<status>`. Every other origin gives nothing.
- **Launches.** `agent.spawn` records a launch only when it runs in the
  background and has no `parentAgentId`, `isTeammate`, `workflow` or
  `resume`. A spawn with `resume` forgets that agent as a member instead.
  The step comes from a module variable, `ownStep`, which `turn.step` sets
  for every step of the session's own loop.
- **The quiet answer.** `turn.step` at index 0 with no `agentId` reads the
  atom. When the marker is zero, it calls `next` without reading anything
  else. Otherwise it reads `$.session.messages()`, answers `Noted.` with a
  stop chunk and no usage when the last message is not a user message, and
  in the same write takes one off the marker, or sets it to zero when it
  does not answer. Any throw lets the model answer.
- **The deadline.** It follows the existing stuck-timer pattern of a module
  timer and a generation counter. `session.start` arms it again from the
  stored deadline after a hot reload. The batch is claimed inside `update`,
  so only one timer submits its prompt.
- **The pane** gains `heldReports`, and a dim row under the agents heading
  says how many reports builder is holding back until their batch finishes.

## Grafts

- **A `Noted.` turn is not a reply at `turn.complete`.** Taken from the most
  robust plan. The `turn.step` hook records the answered `turnId` in a module
  variable. When `turn.complete` carries that id, builder still clears
  `busy` and `turnRunning`, writes the memo and calls `ensureArmed`. It skips
  the context measure and the compaction, the clearing of a usage-limit
  hold, `markQuiet` and `armTurnEndLooks`, and it leaves a held handover for
  the next real turn's end. Otherwise a quiet turn could compact the
  conversation before the model has read the batch's reports, lift a usage
  hold that no model call tested, and schedule two looks at GitHub. A module
  variable is enough, because a hot reload inside that short window costs at
  most one extra look.
- **The deadline calls `$.prompt.submit` directly, inside a try.** Taken
  from the most robust plan. `submitClaimed` sets the shared `isDelivering`
  flag without checking it first and clears it when it ends, so a deadline
  that fires while builder is handing over a pull request's state would
  clear the flag in the middle of that handover. A refused or throwing
  submit is not retried, because the batch has already ended and its
  reports are in the conversation.
- **`ownStep` is cleared at the session's own `turn.complete`.** Taken from
  the most robust plan, so that an agent launched while the session is idle
  does not join the last step's batch.
- **A short probe of a delivery that arrives during a `Noted.` turn.** Taken
  from the most robust plan's risk, without its guard. The probe answers a
  turn with `Noted.` and delivers a report into it. If the report is lost,
  the guard comes back to the spec as a question before it is built. The
  real-run check names this case too.
- **More tests from the most robust plan:** a `<task-id>` under any other
  origin is ignored, a `Noted.` turn leaves a usage-limit hold alone, and a
  `Noted.` turn starts no turn-end looks.
- **Honest risk notes from the simplest plan,** for the pull request: the
  marker counts turns rather than deliveries, and two queued wakes can swap
  order without losing anything, because the turn that reaches the model
  reads both reports.

## Rejected alternatives

- **Zeroing the marker at every prompt builder does not hold,** from the
  most robust plan. The spec's fourth point names one way to zero it, a
  first step that does not answer, and its edge case expects several idle
  deliveries close together to be answered one by one. This rule would send
  those queued turns to the model whenever a release, a person's prompt or
  a lone report arrived among them, which is exactly the burst this change
  exists to make cheap. The spec's check that a lone report after a batch
  delivery reaches the model passes without it.
- **Zeroing the marker at the release,** from the most extensible plan. It
  contradicts the spec in the same way, only less often, and the case it
  guards, a held delivery whose turn never comes, has not been observed. If
  the real run shows a count left behind, it goes back to the spec.
- **A sixty-second expiry on the marker,** from the most robust plan. It
  makes the state depend on time, and the spec does not ask for it.
- **A guard that owes a prompt for a delivery into a `Noted.` turn,** from
  the most robust plan. It needs a record in the atom, a second submit at
  the turn's end and its own tests, for a case nobody has observed and that
  the probe above settles more cheaply.
- **Stamping the state with the session id,** from the most robust plan,
  was rejected here at first, because after a `/clear` the first step
  already zeroes the marker. Review showed that a reset marker is not
  enough: the stored state survives a `/clear` or a resume, so an open
  batch would still add its line to the new conversation's prompts and
  submit its deadline line there, naming agents that conversation never
  launched. The state is therefore stamped with the session id, as the
  context record is, and a value stamped with another id reads as empty.
- **An `ownStep` atom,** from the most robust plan. It writes on every step
  of the session's loop to keep the batching of one step across a hot
  reload, and losing that batching is safe.
- **A per-process set to stop two copies of builder counting a delivery
  twice,** from the simplest plan. A set at module scope belongs to one copy,
  so the other copy would not see it, and the repository already treats two
  copies in one process as unsupported.
- **Pure functions in `state.ts` instead of a new module,** from the
  simplest plan. `state.ts` already holds the usage hold's functions, one of
  them named `holdIn`, and a separate module keeps the batch decisions and
  their tests apart from it.

## Step sequence

1. Probe a delivery that arrives during a `Noted.` turn, with a throwaway
   mod in the scratchpad, and record the result in the pull request.
2. Add the types `BatchMember`, `Batch` and `BatchState` to
   `mods/builder/types/index.d.ts`, and `batches: BatchState | null` to
   `PluginState['builder']`.
3. Write `mods/builder/tests/batch.test.ts` for the pure functions, see it
   fail, then write `mods/builder/hooks/batch.ts`.
4. Write `mods/builder/tests/batches.test.ts` for the hooks, copying the
   model and conversation stubs from `mods/foreman/tests/turn-end.test.ts`,
   and see it fail.
5. In `register.tsx`, add the atom and the module variables, record launches
   in `agent.spawn`, add the batch stage to `prompt.submit`, the quiet answer
   and `ownStep` to `turn.step`, the quiet-turn handling and the clearing of
   `ownStep` to `turn.complete`, the deadline timer to `ensureArmed` and
   `session.start`, the `batches` key to the keys `state.set` leaves out of
   the status write, and `heldReports` to `view()`.
6. Add the pane row and its test in `pane.tsx` and `tests/pane.test.ts`.
7. Add a short section to `mods/builder/README.md`.
8. Run the four gates for both mods.

## Test plan

The pure tests in `batch.test.ts` cover the readers, `deliveryOf` under each
origin and with malformed or foreign leading elements, launches and resumes,
every delivery outcome, the deadline claim, the marker's step rules and the
pruning of remembered batches. The hook tests in `batches.test.ts` map onto
the spec's Verification section line by line:

- Agents launched in one step make one batch, and agents launched in
  different steps, by a subagent or in the foreground do not.
- An idle held report passes on unchanged with the marker raised, and the
  next first step whose last message is the assistant's yields `Noted.` and
  the stop chunk without calling the model, leaving the marker at zero.
- The report that ends the batch carries exactly the completion line.
- A `completed` notification before the report is held and ends nothing,
  one after the release is held through the remembered batch, and one ten
  minutes after the release passes.
- A `failed` or a `killed` notification ends its member and, as the last
  one, releases the batch.
- A delivery with a `turnId` leaves the marker alone.
- A person's prompt carries the line naming the running members, and the
  deadline does not move.
- The deadline submits builder's prompt naming the running members, and a
  later member's report then wakes the model alone.
- A deadline seeded in the atom fires after `session.start`.
- A first step whose last message is a user message, a step that is not the
  first, a subagent's step and a step with no marker each call `next`, and
  the first of these sets the marker to zero.
- A lone agent's report after a batch delivery and its `Noted.` step
  reaches the model.
- A person's prompt containing `<agent-message`, a delivery from an agent in
  no batch and a `<task-id>` under another origin keep today's handling.
- A refused state write passes the prompt on unchanged, and a throwing
  `session.messages` lets the model answer.
- A `Noted.` turn leaves a usage-limit hold alone and starts no turn-end
  looks.
- Two batches open at once release separately, and a resumed member is
  forgotten.

The pane test checks the row appears only when the count is above zero. The
four gates run for builder and then foreman, because foreman reads builder's
types. The real run, a counsel of seven started in a desktop app session
with this change loaded, is the owner's to make, and it also checks the
notification after each report and a delivery into a running turn.
