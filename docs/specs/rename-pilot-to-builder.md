# The pilot mod is renamed builder

Written 2026-10-20. Seeded from an issue in the owner's tracker, the first of
five steps in building the foreman and builder mods. The issue answered every
question the interview would have asked, so none was put to the counsel.

## Goal

The mod that runs in every `/implement` session is called builder instead of
pilot, everywhere in this repository except the older specs, so that the
later steps, which add a status file to builder and a new foreman mod that
reads it, can use the new name from the start. Builder does everything pilot
did; only the names change.

## Users and trigger

The owner and anyone else who installs these skills. A parent session will
soon run a foreman mod that watches several `/implement` sub sessions, each
running this mod, and "pilot" beside "foreman" reads as two pilots. The name
builder says what each sub session does.

## Behavior

1. **The folder.** `mods/pilot` moves to `mods/builder`, with its history
   kept by `git mv`.
2. **The plugin.** The manifest's `name` is `builder`, and the marketplace
   entry in `.claude-plugin/marketplace.json` is named `builder` with its
   source at `./mods/builder`.
3. **What the engine sees.** Every `$.state` key is `{ plugin: 'builder', ... }`.
   The tools are `mcp__builder__*`, the agents are `builder:*`, the command is
   `/builder` with the same subcommands, the pane's id and title are
   `builder`, and the agent pane's id is `builder-agent`.
4. **What the person sees.** Every line, prompt, answer and pane text that
   began with or named `pilot` names `builder` instead, such as
   `builder: spec (2 of 9)` and `builder: pull request #N changed.`
5. **Files the mod writes.** Review packages and counsel briefs go under
   `<git dir>/builder/` instead of `<git dir>/pilot/`. Old folders under
   `<git dir>/pilot/` are left where they are; they were never committed
   and go away with their worktree.
6. **The code's own names.** Identifiers that carry the name, such as the
   `PilotRun` type, are renamed to match (`BuilderRun`), so a reader does not
   meet the old name in the code.
7. **The gates.** The four gates in the root `CLAUDE.md` load and check
   `mods/builder`, including the types folder
   `mods/builder/.claude-plugin/types/`.
8. **The documents.** The root `README.md`, the mod's README, the skills
   `implement`, `pr-comments` and `spec`, and the repository's rules name
   builder. The mod's README has an upgrade note that says builder used to
   be called pilot, how to replace the old link, and that builder starts with
   an empty store.
9. **The old specs stay.** Files under `docs/specs/` other than this spec and
   its plan are not changed. Text elsewhere that points at an old spec by its
   path, such as `docs/specs/pilot-true-state.md`, keeps that path, because
   the file keeps its name.

## Edge cases

- **The store starts empty.** The engine keeps `$.store` in one file per
  plugin, named after the plugin (tested on Claude Code 2.1.299). Builder
  starts with an empty store, so any counsel decision still owed to a pull
  request and the record of what a session was already told are dropped.
  Builder does not try to read pilot's store; one mod cannot read another's.
  The README's upgrade note says so.
- **The link.** Sessions in other repositories load the mod through the
  link `~/.claude/skills/pilot`, which points at `mods/pilot` in this
  repository's main checkout. Once the merge reaches that checkout, the link
  points at nothing. The pull request gives the owner the exact commands to
  remove it and add `~/.claude/skills/builder`. No session changes
  `~/.claude` itself.
- **Sessions already running** keep the old names until they restart, so
  the change merges only while no `/implement` run other than the one
  merging it is in flight. The merging run loads pilot from the main
  checkout, so its merged step takes `mods/pilot` away from under it; it
  finishes on what it already loaded, and the owner replaces the link and
  restarts sessions afterwards.

## Non-goals

- No alias: there is no `/pilot` command, `mcp__pilot__` tool or `pilot:`
  agent kept for a transition.
- Other repositories that name pilot are not changed. The pull request
  describes them in general terms, because the repository's rules forbid
  naming a project in it, and the session gives the owner their names and
  the matching lines outside the repository.
- No change to what the mod does.

## Failure modes

- A reference left behind names a tool or agent that no longer exists, so a
  skill tells a session to call `mcp__pilot__watch` and the call fails. The
  search in Verification catches this.
- A rename that also rewrote a path to an old spec would point at a file
  that does not exist.

## Verification

- `git grep -i pilot -- ':!docs/specs/'` finds only the mod README's
  upgrade note, the sentence in the root README that points at it, and
  paths to old specs.
- `test ! -e mods/pilot` and `test -d mods/builder`.
- The four gates pass against `mods/builder`.
- A fresh session that loads builder opens the pane with `/builder`, and in
  it the reviewer agents appear as `builder:*` and the tools as
  `mcp__builder__*`.
