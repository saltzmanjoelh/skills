# The pilot line and Remote Control

Written 2026-10-14.

## Goal

The owner wanted a dot at the start of the pilot line above the prompt,
green when Remote Control is on for the session and red when it is off, so
that they can tell before walking away from the desk whether the session can
be reached from their phone.

Claude Code 2.1.299 gives a mod no reliable way to know whether Remote
Control is on, so this change ships the issue's own fallback. The pilot line
shows no dot, the mod guesses nothing about Remote Control, and an upstream
request asks Claude Code to expose the state to mods. The request is
[pilot-remote-control-dot-upstream-request.md](pilot-remote-control-dot-upstream-request.md),
and the owner sends it to Anthropic themselves.

## Users and trigger

The owner, who follows `/implement` sessions from their phone through Remote
Control and looks at the pilot line, for example "pilot: no pull request yet
· 1 background command", before leaving the desk.

## What was looked for, and why each source fails

The engine types that Claude Code 2.1.299 writes for the mod
(`mods/pilot/.claude-plugin/types/claude-code/index.d.ts`) and the Claude
Code program itself were searched for a call, an event, a session field or a
setting that holds the session's Remote Control state. On `main` at the time
of writing, the first gate does not produce that file, because Claude Code
2.1.299 writes the types only when the gate sets the variable that
`pilot-type-gate-watch.md` adds. The copy searched was the one that version
wrote into that change's worktree on 2026-10-14; its first line reads
"Written by Claude Code 2.1.299."

- **No call, event or session field names it.** The identifiers
  `remoteControl`, `RemoteControl`, `isRemote` and `bridgeState` appear
  nowhere in the types.
- **The `/config` row `remoteControl`** was found in the Claude Code program,
  not in the types: the types declare a row's key only as a plain string,
  and `$.config.list()` returns this row while Claude Code runs. It is
  labelled "Enable Remote Control for all sessions" and is backed by the
  setting `remoteControlAtStartup`, which project or local settings can
  override. It is the default for new sessions. Turning Remote Control on
  with `/remote-control` changes only the session and leaves the setting
  alone, so the row can say off while the session is on. Disconnecting from the
  Remote Control dialog, in a session where it was turned on that way, sets
  the setting to false, so the row then describes the next session rather
  than this one. The desktop app's toolbar switch is handled outside this
  program and could not be traced. These were read in the Claude Code
  2.1.299 program on 2026-10-14.
- **`$.session.surfaces()`, with the events `session.attach` and
  `session.detach`,** lists the clients drawing the session now. The desktop
  app's Code tab and the editor extension count whether or not Remote Control
  is on, which gives a wrong green, and Remote Control can be on with no
  phone open, which gives a wrong red.
- **A prompt, a `/config` change or a delivery whose origin kind is
  `bridge`** proves that Remote Control was used once in the session. It
  never shows that it is on now, and nothing fires when it is turned off.
  The issue forbids this guess by name.

A wrong green is the worst outcome, because the owner leaves the desk and
cannot reach the session.

## Behavior

1. The pilot line is unchanged on every surface: no dot, and no text about
   Remote Control.
2. No file under `mods/` changes.
3. The upstream request lives in its own file, written to be sent outside
   the company as it stands. It names no project, client or person, describes
   no private incident, and asks for two things: a read of the session's
   Remote Control state, and an event when that state changes.
4. When this pull request merges, this spec's issue is marked done, and one
   new issue is filed that holds the dot itself. It says it waits on Claude
   Code exposing the session's Remote Control state, and it links the merged
   pull request and the upstream request.

## Edge cases

- **A later Claude Code adds the state.** The follow-up issue is where the
  dot gets built, against the real source, with the issue's original
  done-when: a green or red dot on every surface, a text alternative to the
  colour, an update when the state changes, and tests for on, off and
  unknown.
- **The owner edits the request before sending it.** The file in the
  repository is the draft, and the owner's sent text is what counts.

## Non-goals

- Drawing a dot from any proxy (attached surfaces, the `/config` row, or a
  prompt from the bridge).
- Drawing code for a dot whose source is hard-wired to unknown. The owner
  chose not to ship code that cannot show anything yet.
- Sending the upstream request. The owner sends it.

## Failure modes

- If a reviewer finds a reliable source that this search missed, the
  fallback is wrong and the dot should be built from that source instead,
  which reopens the question of what this pull request ships.

## Verification

- `git diff --stat origin/main` on the branch lists only files under
  `docs/specs/`.
- The request file names no project, client or person and contains nothing
  private; a reviewer reads it whole against that rule, because no gate reads
  `docs/`.
- The mod's tests and `claude plugin validate` still pass, which shows only
  that the mod is unchanged. The load gate and the type check fail on `main`
  for the reason `pilot-type-gate-watch.md` describes, whatever this change
  does.
- Behavior 4 cannot be checked before the merge. It is confirmed afterwards
  by this spec's issue being done and the new issue linking the merged pull
  request and the request file.

## Decided by the owner

- Ship the fallback, with a pull request holding the spec, the plan and the
  upstream request and changing no mod code (2026-10-14).
- The owner sends the upstream request to Anthropic themselves (2026-10-14).

## Decided by the counsel

- The issue behind this spec asks for a green or red dot on the pilot line showing whether Remote Control is on for the session. Claude Code 2.1.299 gives a mod no direct way to know that. Which outcome should this pull request ship? The counsel chose Ship the issue's fallback: the line shows no dot, nothing about Remote Control is guessed, and a short upstream request is drafted for the owner asking the engine to expose the session's Remote Control state (and an event when it changes) to mods., 6 of 6.
- When this spec's pull request merges (spec, plan and upstream request document only, no mod code), what should happen to the issue behind this spec, which asked for the dot itself? The counsel chose Mark that issue done, and file one new issue that holds the dot itself, to be picked up when Claude Code exposes the session's Remote Control state., 6 of 6.
- Where in the skills repository should this spec's upstream request (the text asking Claude Code to expose the session's Remote Control state and a change event to mods) live? The counsel chose In its own file next to the spec, docs/specs/pilot-remote-control-dot-upstream-request.md, which the spec links., 6 of 6.
