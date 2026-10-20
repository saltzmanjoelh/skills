# Builder writes a status file for the foreman

Written 2026-10-20. Step 2 of 5 in building the foreman and
builder mods.

## Goal

Foreman is a mod for a parent session that runs several `/implement` sub
sessions. It shows which of them need a person, nudges the idle ones and
starts the next issue when a slot frees. Builder already runs in every sub
session and already sees the events that matter there. In this step builder
publishes what it sees as one JSON file per sub session, so that foreman can
read the state of every sub session without spending the parent's tokens.

## Users and trigger

The reader is foreman, in a parent session, reading a folder of files on its
own timer. The writer is builder, in a sub session that foreman started. The
channel is a file because probes on Claude Code 2.1.299 ruled out the
alternatives: `$.store` is kept separately for each mod, so foreman cannot
read builder's store, and a mod's `$.session.send` is checked like the
model's `SendMessage` tool, so in auto mode it was refused until `SendMessage`
was allowed. A file written with `$.fs.write` needs no permission and
survives the parent being closed.

## Behavior

### Which sessions write

1. **The ticket.** Builder writes a file only in a session whose first prompt
   holds a line `foreman-ticket: <value>`, where the value is the rest of the
   line with surrounding white space removed. Foreman adds that line when it
   starts a session. A session the owner starts by hand has no such line and
   never writes a file.
2. **The first prompt** is the first user message of the session's
   transcript, read with `$.session.messages()` at the first prompt that
   builder sees in its process. When the transcript holds no user message
   yet, the prompt being submitted is the first. A resumed session therefore
   finds the ticket of its original first prompt. Once looked for, the answer
   is kept in the mod's state, so a hot reload does not look again.
3. **A `/clear`** ends the session under its old id. The ticket is dropped
   with it, and the new conversation looks for a ticket in its own first
   prompt.

### Where, and when

4. **The path** is `<config>/foreman/builds/<engine session id>.json`, where
   `<config>` is the `CLAUDE_CONFIG_DIR` variable when it is set and
   `$HOME/.claude` otherwise, the folder foreman reads, and the id is
   `$.session.id()`.
5. **Every write replaces the whole file.** A reader that catches a file in
   the middle of a write sees text that does not parse, and only has to read
   again.
6. **Builder writes when the record changes,** comparing every field except
   the write time with what it last wrote. The record is worked out again at
   each event that can change it: a turn's start and end, an agent's spawn
   and end, a background list, a tool call's start and end, a question asked
   and answered, a permission prompt, a counsel tally, the cleanup skill, a
   failed tool call, a look at the pull request, a scheduled look and a
   usage-limit hold.
7. **It also writes at least once a minute** while the session lives, with a
   new write time even when nothing else changed. A file whose write time
   stops moving means the session is gone or hung.
8. **Writes go one at a time.** A change that arrives while a write runs is
   written after it, so the newest record is always the last one written.
9. **When the session ends** after its pull request merged, builder deletes
   the file. The engine's file interface has no delete, so builder runs
   `rm -f <path>` through `$.process.run`. When the session ends without a
   merge, the file stays for foreman to read.

### The record

10. **The record's type is declared in builder's contract,**
    `mods/builder/types/index.d.ts`, as `BuildStatus`, with its state as
    `BuildState` and its stage as `BuildStage`, so that foreman can name
    builder as a dependency and type-check against it. The field names are
    the ones foreman's session proposed, so that the two mods match. Its
    fields:

    | Field | What it holds |
    |---|---|
    | `version` | `1`, raised whenever a field changes meaning |
    | `sessionId` | the engine's session id, the same as the file name |
    | `ticket` | the value of the `foreman-ticket:` line |
    | `desktopSessionId` | the desktop app's session id, from the `CLAUDE_CODE_HOST_SESSION_ID` variable; left out outside the desktop app |
    | `cwd` | the folder the session started in, so foreman can find the session before it knows the desktop id |
    | `issueKey` | a leading issue key, such as `ABC-123`, of the title last reported through the progress tool, or null when there is none |
    | `issueTitle` | the rest of that title, or the empty string before any report |
    | `stage` | the stage last reported, or null before any report |
    | `stageDone` | the stages done out of nine, as the progress bar counts them |
    | `pr` | `{ repo, number, state, checks }` of the watched pull request, where `state` is `OPEN`, `MERGED` or `CLOSED` and `checks` is `none`, `pending`, `passed` or `failed`; null before a watch |
    | `state` | one of the six states below |
    | `reason` | one line that says why the state holds |
    | `stateSince` | when the state began |
    | `writtenAt` | when the file was written |
    | `cleanup` | `{ failedCalls, lastError }` once the cleanup skill has started, whatever the state, with `lastError` empty until a call fails; left out before |

    Every time is milliseconds since the epoch, as `$.clock.now()` gives it.

### The states

11. **One state at a time,** the first of these that holds:
    1. `needs-you`: an `AskUserQuestion` call of the session's own is open;
       or a counsel tally answered that the person must be asked, and since
       then neither has an `AskUserQuestion` call that started after the
       tally ended come to an end nor has the person sent a prompt; or a
       permission prompt is open.
    2. `working`: the session's own turn runs, or an agent, a background
       task or a tool call of the session's own runs.
    3. `waiting-on-builder`: builder has a look at the pull request scheduled,
       or a usage-limit hold is on.
    4. `in-cleanup`: the `cleanup` skill has started in this session. It
       lasts until the session ends.
    5. `done`: the watched pull request merged.
    6. `idle`: none of the above.

    So `done` and `in-cleanup` show only once nothing runs, and foreman sees
    `done` only when the merged session has stopped working.
12. **`stateSince`** is the time of the write at which the state last
    changed. It survives a hot reload.
13. **A permission prompt** counts as open from the classic
    `PermissionRequest` event until the same loop's call of the same tool
    returns, or that loop's turn ends. The loop is the session's own, or one
    subagent's, named by the event's `agent_id`. Several open prompts of one
    loop and one tool are counted, and each return closes one.
14. **The cleanup record** begins when the `skill.prompt` event names the
    skill `cleanup`, or a plugin's skill whose name ends in `:cleanup`. It
    counts every `PostToolUseFailure` event since then, the session's own
    and its subagents', and keeps the last non-empty line of the newest
    error, cleaned of control characters and cut to 200 characters. A line
    that looks like a secret is replaced by `(withheld: it looks like a
    secret)`.

### Which engine event a permission prompt raises

Found at build time on Claude Code 2.1.299, by reading the engine's bundle,
because a probe outside the desktop app could not reach a real prompt: a
`claude` started there is not signed in, so no turn ran. The engine runs the
classic `PermissionRequest` hooks from the code that handles an `ask`
verdict on its way to the permission prompt, the dialog in the terminal or
the host's ask in the desktop app, and skips them only for a call run
remotely. The event carries `tool_name`, `tool_input` and, inside a
subagent, `agent_id`, but no `tool_use_id`. The `tool.check` event fires
earlier, before the permission mode settles an ask, so in auto mode an `ask`
there can be approved by the classifier with nobody asked. The bundle also
names a `Notification` whose type is `permission_prompt`, but it was not
confirmed that the desktop app raises it. Whether the desktop app raises
`PermissionRequest` for its own prompt card is unverified until a signed-in
session shows it.

## Edge cases

- **Two calls of one tool in one loop,** one of which asked: the first to
  return closes the prompt, so `needs-you` can end early. The turn's end
  bounds the error either way.
- **A call run remotely** raises no `PermissionRequest`, so its prompt is
  never reported.
- **A session resumed** after a restart finds its ticket in the transcript,
  unless the transcript is longer than the 4096 entries `$.session.messages()`
  returns, in which case the first entry seen is not the first prompt and no
  ticket is found.
- **Neither `CLAUDE_CONFIG_DIR` nor `HOME`:** nothing is written.
- **A cleanup that refuses** (a dirty tree, for example) still leaves the
  session `in-cleanup` until the session ends, as the counsel chose.
- **The record never copies a tool's input,** which can hold commands, paths
  or secrets; a permission prompt's reason names the tool only.

## Non-goals

- Foreman itself, the ticket line in its briefs and the `gone` state, which
  foreman decides from a file that stops updating.
- A push channel from builder to the parent.
- Atomic writes: the engine offers no rename, and a reader retries.

## Failure modes

- A write that fails is dropped; the next change or the next minute's write
  tries again. Nothing a write does can stop a hook.
- The delete at the session's end runs inside the engine's short budget for
  ending a session. When it fails or is cut off, the file stays and reads
  `done`, or `in-cleanup` when the cleanup skill had started, either of which
  tells foreman the session finished its pull request.
- Reading the transcript for the ticket can fail; then the prompt being
  submitted is checked instead.

## Verification

`claude plugin test`, from `mods/builder`, covers:

- each of the six states, driven from raised events, with the reason;
- the order: a merged pull request with a turn running reads `working`, a
  question open during cleanup reads `needs-you`, and a merged pull request
  after cleanup started reads `in-cleanup`;
- the counsel's ask held until an `AskUserQuestion` call that started after
  the tally ends, and until a prompt of the person's;
- a permission prompt opened by `PermissionRequest` and closed by its call's
  return, and by the turn's end;
- the cleanup record's count and last error line;
- the ticket check: a session with a ticket writes to the path above, and a
  session with no ticket writes nothing;
- the once-a-minute refresh on the mocked clock;
- the delete after a merge, and no delete without one.

The four gates in the project's `CLAUDE.md` pass, and the mod's README
describes the file and its fields.

## Decided by the counsel

- When more than one of the six states holds at once in a sub session (for example the pull request has merged, the cleanup skill is running, and an AskUserQuestion call is open), which state does builder write to the status file? The counsel chose: Needs you first, then working, then waiting on builder, then in cleanup, then done, then idle, so done and in cleanup show only once nothing runs. 6 of 7 members voted for it.
- How long does the in cleanup state last once the cleanup skill has started? The counsel chose: Until the session ends; cleanup is the last thing a session does, and it ends by archiving the session. 5 of 7 members voted for it.
- After the counsel tally answers that the person must be asked, how long does that keep the status at needs you? The counsel chose: Until an AskUserQuestion call that started after the tally ends, or the person sends a prompt, whichever comes first. 7 of 7 members voted for it.
- How are the times and the state written in the status record that foreman reads? The counsel chose: Times as milliseconds since the epoch, and the state in kebab case: working, waiting-on-builder, idle, needs-you, in-cleanup, done. 7 of 7 members voted for it.
- Which engine signal should builder treat as "a permission prompt is open" for the needs you state, and when does it count as closed? The counsel chose: Open on the classic PermissionRequest event for that loop (the main session or one subagent), closed when that loop's tool.call for the same tool returns, or when that loop's turn ends. 7 of 7 members voted for it.
