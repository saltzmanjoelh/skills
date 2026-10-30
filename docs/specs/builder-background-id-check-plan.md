# Plan: builder's background task id, checked against the real engine

Spec: `docs/specs/builder-background-id-check.md`. Date: 2026-10-30.

## What the check showed

The check ran before this plan, because its result decides which of the
spec's behaviours applies. On Claude Code 2.1.314, a throwaway probe mod with a
hook on `tool.call` that logged each call's result, and a hook on
`classic.Stop` that logged `background_tasks`, ran under `claude -p`. A Bash
call started with `run_in_background` returned `backgroundTaskId`
`b4bwbq10z`, and the turn-end list held the same command, a `shell` task with
status `running`, under the `id` `b4bwbq10z`. For a command the person moves
to the background, the engine's own code registers the task under the shell
output's task id and returns that same value in the result as
`backgroundTaskId`, together with `backgroundedByUser: true`. The ids match on
both paths, so behaviour 4 applies and builder's code does not change.

## Chosen approach

The simplest plan won. One paragraph goes under the "Once, against the real
engine" bullet of the Verification section of
`docs/specs/builder-names-background-wait.md`. It is dated, names the version,
describes the probe well enough to build again, quotes both values, says what
the engine's code showed for a command the person moves to the background
(described by what the code does, never by a minified name, which changes
between builds), and concludes that the lookup needs no change.

## Grafts

- From the judge: the paragraph says that the check covered only the
  session's own Bash calls, which are the only calls whose start builder
  records, so a reader does not take it to cover commands a subagent starts.
- From the judge: the gates run, and the pull request says that no gate reads
  `docs/`, so the record is checked by its reviewers alone.

## Rejected alternatives

- Adding `backgroundedByUser: true` to the `backgrounded` fixture in
  `mods/builder/tests/register.test.ts`, from the robust plan. The spec allows
  a test change only when the check fails, and that fixture stands for both
  paths, while the flag belongs to only the path the person starts, so the
  fixture would describe less than it does now.
- A clause in the Failure modes section of the background-wait spec saying the
  match was confirmed. That section already says Verification checks it, and
  the record there is enough.
- Saying in the record that the earlier plan's variant, which read the line
  after a foreground `sleep 30`, was not used. Logging both ids is a direct
  check and needs no comparison with an indirect one.

## Steps

1. Add the paragraph to the Verification section of
   `docs/specs/builder-names-background-wait.md`, and commit it.
2. Search the staged diff for project names, issue keys and local paths, as
   `.claude/rules/no-project-names.md` says.
3. Run the gates in the project's `CLAUDE.md`.

## Test plan

- Spec Verification, the logged values: the paragraph quotes both.
- Spec Verification, the person's path: the paragraph says what the engine's
  code showed.
- Spec Verification, the record: it is in the background-wait spec.
- Spec Verification, a fix's test: none, because no fix is needed.
- Spec Verification, the gates: all four run, and the report says that none
  of them reads `docs/`.
