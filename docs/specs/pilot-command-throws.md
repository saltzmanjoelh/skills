# The pilot tools answer when a command throws

Date: 2026-10-12

## Goal

On 2026-10-12 the pilot mod's watch tool twice answered with the engine's
error "pilot registered the tool watch but no tool.call hook answered this
call" while GitHub was unreachable from the machine, and `gh` printed
`dial tcp ...:443: i/o timeout`. Once GitHub was reachable again, the same
call worked.

The engine's documentation says that `$.process.run` rejects when the command
cannot start, or is still running when its timeout ends. The mod runs every
command through two helpers in `mods/pilot/hooks/register.tsx`, one for `gh`
and one for `git`. Neither catches that rejection, and none of the tools that
call them do either. The rejection reaches the `tool.call` hook's catch
handler, which hands the call on to the engine, and the engine then reports
that no hook answered.

After this change, a command that throws counts as a command that failed. Each
pilot tool then answers with the same text it already gives when that command
exits with an error.

## Users and trigger

The session running `/implement` calls the watch, package and review tools.
It also calls the counsel tool, from `/spec` as well as from `/implement`. The
mod's own background looks run `gh` too. The trigger is any command that hangs
past the 20-second timeout or cannot start. The usual cause is a network that
is down or very slow, during which both `gh` and `git fetch` hang.

## Behavior

- The `gh` helper returns null when `$.process.run` throws, just as it does
  when `gh` exits with an error or its output was cut off.
- The `git` helper returns null when `$.process.run` throws, in the same way.
- Every caller already treats null as a failure. The tools therefore answer
  with their existing failure text, and no new text is added. For example:
  - The watch tool answers "gh could not read o/r#7; still watching what was
    watched before." when the read of the pull request throws.
  - The watch tool answers "Could not read the repository or the gh login from
    this folder." when the read of the login throws.
  - The package tool answers "git could not fetch the base, ..." when
    `git fetch` throws.
- The comments on both helpers say that a throw counts as a failure. The
  try/catch in `readRuns` existed only because the `gh` helper let a throw
  through. It is removed, and its comment is reworded.

## Edge cases

- A throw while the watch tool reads the pull request leaves the pull request
  that was watched before still watched, as a failed read already does.
- A throw while a background look reads the pull request makes that look fail
  as a failed read does: nothing is handed over, and the next poll tries
  again.
- A throw during `git fetch` in the package tool writes no package.

## Non-goals

- The tools do not name the cause, such as a timeout, in their answers.
- The timeout stays at 20 seconds.
- Unguarded `JSON.parse` calls on `gh` output that succeeded are not
  touched.
- Engine calls other than `$.process.run` that might throw, such as
  `$.fs.write` or `$.ui.open`, are not touched.

## Failure modes

A command that cannot start at all, for example because `gh` is not
installed, now produces the ordinary failure text rather than the engine's
error. The person sees "gh could not read ..." instead of a message about
hooks. That message is closer to the truth, so this is accepted.

## Verification

Each test below is written first, and is seen to fail before the fix, by
answering no result.

- In `mods/pilot/tests/register.test.ts`, a fake `$.process.run` throws for
  `gh pr view`. The watch tool's result then contains "gh could not read
  o/r#7".
- A fake `$.process.run` throws for `git fetch`. The package tool's result
  then contains "git could not fetch the base".
- The existing test in which a runs read throws still passes.
- All four gates in the project's `CLAUDE.md` pass.

## Decided by the counsel

- Should the fix also make the git helper in mods/pilot/hooks/register.tsx treat a throw from $.process.run as a failed call, or should it change only the gh helper, as the brief names? The counsel chose Fix both the gh helper and the git helper in this pull request, each with its own reproducing test., 6 of 6.
