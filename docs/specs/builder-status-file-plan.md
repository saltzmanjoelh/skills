# Plan: builder writes a status file for the foreman

Written 2026-10-20 for `builder-status-file.md`. Three planners worked blind
to each other, with the priors simplest thing, most robust and most
extensible, and a judge compared them. The most robust plan won, with four
ideas grafted from the most extensible plan and one correction from the
simplest.

## Chosen approach

All the rules about the record live in a new pure module,
`mods/builder/hooks/status.ts`, tested by `tests/status.test.ts`. The wiring
lives in `hooks/register.tsx`. The record's types go in the contract,
`types/index.d.ts`.

1. **Every atom write republishes.** `register.tsx` hooks its own
   `state.set` event: after each write of one of the mod's values lands, the
   hook marks the status as needing work. Every existing call site keeps
   working unchanged, and a future writer of state cannot forget to
   republish. The hook leaves out writes of the status memo, below, so the
   writer never triggers itself. The plan first chose a local wrapper around
   the engine's `update`, but it could not be built: the engine reads which
   values a module writes from the atom named at each call site, and refuses
   a call whose atom is a parameter, as it would be inside a wrapper.
2. **One memo atom, stamped with its session.** `status: StatusMemo | null`
   holds what no other atom holds: the session id it belongs to, the
   ticket (or null when it was looked for and none was found), the
   desktop id and folder read with it, the state last written and when it
   began, when a counsel tally last sent a question to the person, the
   start times of the session's own open `AskUserQuestion` calls, the open
   permission prompts with a count for each loop and tool, the cleanup
   record, and the writer's generation. A memo whose session id is not
   `$.session.id()` reads as empty, which covers a `/clear` whose end was
   cut off. `statusMemoIn` validates it field by field. Two module
   variables mirror the memo's answer: `ticketKnown`, whether the session
   has a ticket, and `ticketFor`, the session id that answer belongs to.
   They let every write of state ask for a write of the file without an
   await. A hot reload resets them, so `startStatus`, which runs at every
   start of the hooks, sets them again from the memo, and the memo stays
   the source of truth.
3. **One coalescing writer.** `statusChanged($, force?)` returns at once in
   a session known to have no ticket. Otherwise it sets a dirty flag and,
   unless a loop is pending, starts one from `$.clock.after(0)`. The loop
   reads everything fresh through `statusFacts($)`, builds the record with
   `recordOf`, compares it with the last record written in every field but
   `writtenAt`, and writes `JSON.stringify(record)` only when it differs or
   the write is forced. It loops while the flag was set again. Each write
   races a long timeout, so a hung write cannot stop writing for good; a
   write that finishes late after a newer one is repaired by the next, as
   the spec's failure modes allow.
4. **The minute tick recomputes.** `$.clock.every(60_000)` calls
   `statusChanged($, true)`, which rebuilds from the atoms, so it also heals
   any missed trigger. `session.start` arms it again after a hot reload
   when the memo holds a ticket for this session.
5. **A writer left over from before a hot reload stops.** `session.start`
   raises the memo's generation and keeps it in a module variable; the loop
   stops when the memo's generation is not its own.
6. **The session's end.** `session.end` marks the session closed
   synchronously and cancels the tick, waits for the write in flight within
   the engine's budget, and then, when the watched pull request's snapshot
   reads merged, runs `rm -f <path>` through `$.process.run`. A write that
   has not settled by then deletes the file again when it settles. When the
   end's reason is `clear` or `resume`, the process goes on under another
   session id, so the end resets the memo and the mirrored variables, and
   the new conversation looks for a ticket in its own first prompt.
7. **The states are an ordered table.** `status.ts` lists the six states in
   the counsel's order, each with a rule that answers its reason or null,
   and a type-level check fails the type check when the table and the
   contract's `BuildState` differ, as `STAGES_MATCH_THE_STATE` does for the
   stages. "The session's own turn runs" is read from the `busy` atom,
   because the module's turn counters reset on a hot reload.

## Grafts

- From the most extensible plan: the ordered rule table and its type check,
  because the order is what the counsel voted on and the check catches a
  state added to the contract but not to the rules.
- From the most extensible plan: one `statusFacts($)` and one place that
  builds, compares and writes, so the loop has a single body.
- From the most extensible plan: `CiState` in `github.ts` tied to the
  contract's checks type, so the two cannot drift apart.
- From the most extensible plan: the session id must match `^[A-Za-z0-9_-]+$`,
  and the configuration folder, from `CLAUDE_CONFIG_DIR` or `HOME`, must be
  an absolute path, so the path cannot leave its folder.

## Rejected alternatives

- **The existing `oneAtATime` queue without coalescing** (simplest plan): a
  hung write lets the queue grow with every atom write, and nothing stops a
  write queued after the delete from bringing the file back.
- **A module variable as the only record of the ticket** (simplest plan): a
  hot reload resets it, and the session would go quiet until something
  seeded it again. The code does mirror the ticket in module variables, but
  only beside the memo, which `startStatus` reseeds them from.
- **Five separate atoms, each compared with the session id** (most
  extensible plan): the same effect as one stamped memo, with five places
  to forget the check.
- **Swallowing errors with no timeout** (most extensible plan): a hung write
  would freeze all writing.
- **A seam named for a later push channel**: the spec lists that channel as
  a non-goal, so no comment promises it.
- **Explicit publish calls at each of the sixteen or so places that write
  state**: the `state.set` hook covers them all and every future one.

## Beyond the spec, said in the pull request

- The session's own open prompts are also cleared when its next turn
  starts, and a subagent's are ignored once its agent card is not running.
  Both follow from "that loop's turn ends": a new turn means the old one
  ended, and an agent that is not running has no prompt open.

## Steps

1. Types: `BuildStage`, `BuildState`, `BuildStatus` with the field names
   foreman's session proposed, `StatusMemo`, and the `statusMemo` key of
   `PluginState`, each with a comment.
2. `hooks/status.ts` and `tests/status.test.ts`: `ticketIn`,
   `firstPromptOf`, `issueOf`, `isCleanupSkill`, `errorLineOf`, the rule
   table and `stateOf`, `recordOf`, `comparedTextOf`, `statusMemoIn`,
   `buildPathOf`, and the reducers over the memo for a permission request,
   a call's return, a loop's end, the cleanup skill, a failed call, the
   counsel's ask, a question's start and end, and a person's prompt.
3. `register.tsx`: the `state.set` hook, the memo atom, `statusFacts`, the
   writer loop and the tick, then the whole existing suite, to show nothing
   changes for a session with no ticket.
4. The ticket lookup in `prompt.submit` (awaited, in its own try and catch),
   and the hooks: `classic.PermissionRequest`, a `finally` around the
   `tool.call` hook, `turn.start` and `turn.complete`, `asking`,
   `serveTally`, `skill.prompt`, `classic.PostToolUseFailure`, the person's
   prompt, `session.start` and `session.end`.
5. Integration tests at the end of `tests/register.test.ts`, reusing
   `engine`, `fakeGitHub`, `fakeFiles` and the tool and counsel helpers.
6. The README section on the status file, and a sentence under "What it
   keeps".
7. The four gates.

## Test plan

Pure tests in `tests/status.test.ts` cover every rule and every reducer,
including a ticket line among others, an empty ticket, a first prompt that
is only a tool result, a title with and without a key, an error with
trailing blank lines, control characters, the 200-character cut, a
token-shaped line, the three order cases, `stateSince` kept and moved, and a
path refused for a relative folder or an id with a slash.

Integration tests in `tests/register.test.ts`, by the spec's Verification
list:

- **Each state with its reason:** idle after a ticketed prompt; working from
  a turn, an agent and a held tool call; waiting-on-builder after a watch,
  and from a usage-limit hold; in-cleanup from the skill; done from a
  merged pull request after a look; needs-you from an open question.
- **The order:** merged with a turn running reads working; a question open
  during cleanup reads needs-you; merged after cleanup started reads
  in-cleanup.
- **The counsel's ask:** a tally that sends the question to the person reads
  needs-you; a question that started before the tally ended does not clear
  it; one that started after it does, once it ends; a person's prompt
  clears it and a plugin's prompt does not.
- **Permission prompts:** a `PermissionRequest` reads needs-you and the
  call's return closes it; two need two returns; a subagent's prompt is
  closed by that agent's turn end and not by a main-loop return; the main
  turn's end closes the session's own; the reason names the tool and never
  its input.
- **The cleanup record:** two failures give a count of two and the newest
  error's last line; a token is withheld; a failure before cleanup is not
  counted.
- **The ticket check:** the file is at the spec's path with its ticket, ids
  and folder; a session with no ticket writes nothing and runs no `rm`; a
  ticket in a resumed transcript counts; a failed transcript read falls
  back to the submitted prompt; `CLAUDE_CONFIG_DIR` is preferred to `HOME`.
- **The minute refresh:** a minute later the file is written again with a
  new `writtenAt` and the same `stateSince`; a refused write is retried at
  the next tick; an event that changes nothing writes nothing.
- **The delete:** after a merge, `session.end` runs `rm -f` on the path;
  without a merge it does not; nothing is written after the end.
- **Robustness:** with one write held, two changes write once more, last,
  with the newest state; after `/clear` and a new session id, a prompt with
  no ticket writes nothing.

The generation guard against a writer left in an old module copy is argued
from the engine's types, because the test kit cannot run two copies of the
module; the pull request says so. No gate reads the README, so the report
says its reviewers alone checked it.
