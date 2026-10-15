# Plan: the pilot mod's type gate writes the installed version's types again

Spec: `docs/specs/pilot-type-gate-watch.md`. Issue: SAL-285. Written 2026-10-14.

## Chosen approach

Two planners competed, one aiming for the smallest change and one for
robustness, and the judge chose the robust plan with four ideas grafted from
the smaller one.

Change only the first gate, line 17 of `CLAUDE.md`. Put
`CLAUDE_CODE_PLUGIN_DIR_WATCH=1` as a prefix on the `claude -p` call, so the
variable reaches that one process and nothing else in the command. Leave
every other word of the bullet as it is. Add one sentence, placed right
after the sentence saying that loading the mod writes its engine types:

> From Claude Code 2.1.299, a non-interactive load writes a mod's types only
> for plugin folders that it watches for live reloads, and it watches none
> unless `CLAUDE_CODE_PLUGIN_DIR_WATCH` is set, so the command sets that
> variable on the `claude` call alone.

## Grafts from the smaller plan

- The test runs the old gate from `git show origin/main:CLAUDE.md`, not from
  `HEAD`. Once the change is committed, `HEAD` holds the new command, and a
  check against it would quietly test the wrong thing.
- The test takes the new command mechanically from the changed `CLAUDE.md`,
  from the first pair of backticks on the gate's line, and runs that text,
  so the command tested is provably the command written.
- The sentence sits beside the sentence about writing the types, which is
  the sentence it explains.
- The test ends with `git diff --stat origin/main`, which must list only the
  spec, this plan and `CLAUDE.md`.

## Rejected alternatives

- Setting the variable in settings or exporting it for the whole command.
  Claude Code strips it from settings in some modes, and an export would
  reach `rm`, `mktemp` and `test` for no reason.
- Pinning the gate to the 2.1.294 binary. The type check would then say
  nothing about the version that loads the mod.
- Relying on `claude plugin test .` to write the types. It is unmeasured,
  and it would reorder the gates.
- Printing the Claude Code version. The counsel ruled it out six to none,
  because the gate's delete and existence check already tie the types to the
  installed version.
- Locking against two sessions running the gate at once in one worktree.
  Both write the same files from the same binary, and a rerun clears a
  failure, so the spec allows no such machinery.

## Steps

1. Edit line 17 of `CLAUDE.md` as above, and commit it alone.
2. Run the test plan below, then `/verify-loop` for the four gates.

## Test plan

Each step runs from the worktree root, and maps to the spec's Verification
section.

1. Report `claude --version`, which must print 2.1.299.
2. Take the old command from the first backtick pair on line 17 of
   `git show origin/main:CLAUDE.md` and run it with `bash -c`. It must exit
   with a nonzero status and leave no types folder.
3. Take the new command the same way from the changed `CLAUDE.md` and run
   it under `time`. It must exit 0 in about the time a one-turn model call
   takes, which rules out a watcher that keeps the process alive, and leave
   `claude-code`, `claude-code-mcp`, `claude-code-tools` and `tsconfig.json`.
4. Run the new command again from `mods/pilot/.claude-plugin`. It must exit
   0 again, which shows that it works from any folder inside the repository
   and that a rerun deletes and rewrites the types.
5. Run the other three gates from `mods/pilot`; each must exit 0.
6. Run `git diff --stat origin/main`.

The unchanged gate text still says that Claude Code writes the types even
when `claude` is not signed in. That was measured without the variable, and
this change does not measure it again, so the report says so.
