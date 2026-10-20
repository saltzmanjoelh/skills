# Plan: the pilot mod is renamed builder

Written 2026-10-20, for `rename-pilot-to-builder.md`.

## How the plans were compared

Two planners worked blind to each other, one asked for the smallest change
and one for the most robust. A small mechanical change does not need a third
plan. Both chose the same method: move the folder with `git mv`, then rewrite
every `pilot` outside `docs/specs/` in one pass with a guard for paths to old
specs, then fix by hand the few places a blind rewrite gets wrong. The robust
plan won because it adds checks that cost nothing: the move goes in its own
commit so git records every file as a whole rename, and the list of paths to
old specs is taken before and after the rewrite and must not change.

## Grafted from the simplest plan

- Two lines in `skills/implement/SKILL.md` already said "a builder agent",
  meaning any agent that builds code. After the rename that reads as the
  mod, so they say "an implementation agent".
- A comment in `hooks/pane.tsx` said "so the builders write it from here",
  meaning the functions below it. It says that instead.

## Rejected

- **An alias for the old names**, such as a `/pilot` command or `pilot:`
  agents kept for a while. The spec rules it out, and running sessions keep
  the old names until they restart anyway.
- **Reading pilot's store from builder.** One mod cannot read another mod's
  store, so builder starts empty and the README says so.
- **Listing other repositories by name in the pull request.** The issue asked
  for it, but the repository's rules forbid naming a project in a pull
  request. The pull request describes them in general terms, and the session
  reports the list by name to the person who asked, outside the repository.

## Steps

1. Check that `mods/pilot` holds no ignored files that `git mv` would leave
   behind, then `git mv mods/pilot mods/builder` and commit the move alone.
2. Record the paths to old specs:
   `git grep -oh 'docs/specs/[a-z0-9-]*\.md' -- ':!docs/specs/' | sort`.
3. Rewrite, in tracked files outside `docs/specs/`:
   `perl -pi -e 's{(?<!docs/specs/)pilot}{builder}g; s{(?<!docs/specs/)Pilot}{Builder}g'`.
4. Take the paths to old specs again. The list must equal the one from step
   2, and every file in it must exist.
5. Fix by hand: the expected strings in `tests/pane.test.ts` that are cut to
   a fixed width, because builder is two characters longer than pilot,
   recomputed from what the unchanged code prints; the two grafted wordings;
   any changed prose that no longer reads well.
6. Write the upgrade note in the mod's README: builder used to be called
   pilot; how to replace the link; how to replace a marketplace install;
   builder starts with an empty store.
7. Commit the rewrite, then run the gates.

## Test plan

- `git grep -i pilot -- ':!docs/specs/'` matches only the upgrade note and
  the paths to old specs, each read by hand.
- `test ! -e mods/pilot` and `test -d mods/builder`.
- The four gates in `CLAUDE.md`, in order, against `mods/builder`. The type
  check also proves the `builder` key in `types/index.d.ts` agrees with every
  `{ plugin: 'builder' }` state key, and the tests prove the tool, agent and
  command names.
- A fresh session loaded with `--plugin-dir mods/builder` answers `/builder`
  and lists `builder:*` agents and `mcp__builder__*` tools.
- The rules file's search for issue keys and pull request numbers over the
  staged diff.
