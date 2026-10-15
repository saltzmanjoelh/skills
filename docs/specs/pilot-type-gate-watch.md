# The pilot mod's type gate writes the installed version's types again

Issue: SAL-285. Written 2026-10-14.

## Goal

The first gate in the repository's `CLAUDE.md` loads the pilot mod once so
that Claude Code writes the mod's engine types into
`mods/pilot/.claude-plugin/types/`, which the second gate's type check
extends. Claude Code 2.1.299 stopped writing those types for this load, so
the first gate fails for every session on that version. The gate must make
the installed Claude Code write them again.

## Users/Trigger

Every session that runs the gates of this repository, through `/verify-loop`
or by hand, on Claude Code 2.1.299 or later.

## Behavior

- The first gate's command sets `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` on its
  `claude -p --max-turns 1 --plugin-dir "$root/mods/pilot" "ok"` call, and
  on nothing else. Everything else in the command stays as it is: it still
  deletes the old types first, runs from a scratch folder, ignores how the
  model call ends, and passes only if `tsconfig.json` exists again.
- The gate's text gains one sentence saying why the variable is there:
  from Claude Code 2.1.299, a non-interactive load writes a mod's types only
  for plugin folders it watches for live reloads, and it watches none unless
  `CLAUDE_CODE_PLUGIN_DIR_WATCH` is set.
- No other gate, file or skill changes.

The variable is not documented. It was found by reading the 2.1.299 and
2.1.294 binaries, and the measurement below is what the change rests on.
Version 2.1.294 also reads the variable, where it only decides whether
plugin folders are watched, so the changed gate still writes types there.

## Edge cases

- A later Claude Code stops honouring the variable. The gate's existence
  check then fails loudly, as it does today on 2.1.299, and the sentence in
  the gate tells the next reader where to look.
- The variable is set on the command line rather than in settings, because
  Claude Code strips it from user settings and global config in some modes.

## Non-goals

- Printing or recording the Claude Code version the types came from. The
  gate deletes the types and has the installed `claude` write them again, so
  a pass already ties them to the installed version.
- Pinning the gate to an older binary.
- Changing `/verify-loop` or any other skill, or the older specs that quote
  the previous command as history.

## Failure modes

If the installed Claude Code writes no types, the first gate fails, and the
type check then fails with the `TS5083` error that `CLAUDE.md` already
describes. Nothing fails silently.

## Verification

Measured on 2026-10-14, each run from a scratch folder after deleting the
types folder:

| Command | Types written |
|---|---|
| installed `claude` 2.1.299, no variable | none |
| installed `claude` 2.1.299 with the variable | `claude-code`, `claude-code-mcp`, `claude-code-tools`, `tsconfig.json` |
| 2.1.294, no variable | the same four entries |

The change is verified when the first gate, copied exactly from the changed
`CLAUDE.md`, passes on the installed 2.1.299 starting from no types folder,
and the three other gates then pass. The installed version is reported next
to the result.

## Decided by the counsel

- Besides setting CLAUDE_CODE_PLUGIN_DIR_WATCH=1 on the first gate's `claude -p` command, should the first gate also show which Claude Code version wrote the types, so that a report can say which version the type check ran against? The counsel chose No. Change only the command and add one sentence saying why the variable is there. The gate already deletes the types and rewrites them with the installed `claude`, so they always come from the installed version., 6 of 6.

The owner approved adding the variable to the gate on 2026-10-14, as the
issue requires for any change to a gate.
