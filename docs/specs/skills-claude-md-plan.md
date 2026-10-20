# Plan: the skills repository's CLAUDE.md

Spec: `docs/specs/skills-claude-md.md`. Written 2026-10-08.

## Chosen approach

The simplest plan won. One new file, `CLAUDE.md` at the repository root, holds
three fact lines at the start of their lines, a `## Gates` section with one
single-line bullet per gate, a paragraph saying what no gate reads, and a
`## Hard rules` section. No other file changes.

The spec writes the load step with a `<worktree>` placeholder, which nobody
can run as written. The file replaces it with a command that finds the root
itself and runs in a subshell:

```bash
(root="$(git rev-parse --show-toplevel)" && rm -rf "$root/mods/pilot/.claude-plugin/types" && cd "$(mktemp -d)" && { claude -p --max-turns 1 --plugin-dir "$root/mods/pilot" "ok" < /dev/null > /dev/null 2>&1; test -f "$root/mods/pilot/.claude-plugin/types/tsconfig.json"; })
```

The parentheses keep the move into the scratch folder from changing the folder
that the later gates start in, when one shell runs them all. Building it
showed that the types are written even when the model call fails for want of
a sign-in, and that a rerun leaves unchanged types untouched. So the command
deletes the folder first, ignores how the model call ends, and passes only if
the types exist again. Reading input from `/dev/null` stops `claude -p`
waiting three seconds for input that never comes. The other three
gates keep the spec's form, "From `mods/pilot`:" followed by the command.

## Grafts from the robust plan

- **The error text claims no order.** The type check prints
  `Cannot find global value 'Promise'` before the TS5083 line, so the bullet
  says the two appear together. The spec said "followed by", which was wrong,
  and it now says the same as the file.
- **The commands are checked from another folder.** Verification passes the
  mod's folder as an argument (`claude plugin test <dir>`,
  `claude plugin validate <dir>`, `tsc -p <dir>`) and runs the load step from
  `skills/`, so a pass does not depend on starting at the root.
- **The stale-types claim is measured.** The robust plan proposed checking
  that the generated `tsconfig.json`'s modification time moves forward. That
  check failed while building, because a rerun leaves unchanged types alone.
  Verification instead runs the gate and checks that the folder it deleted
  exists again.
- **Quoting is exercised.** The fresh-copy check runs in a folder whose name
  holds a space.
- **The fact values are read literally.** Verification checks each value with
  no trailing space and that no fact is written as a bullet.

## Rejected alternatives

- **A fenced command block per gate, each prefixed with
  `cd "$(git rev-parse --show-toplevel)/mods/pilot" &&`.** It departs from the
  spec's wording, makes the gates harder to count, and a `cd` inside a compound
  command can raise a permission prompt.
- **A paragraph explaining `<n>` and `<sha>`.** The spec does not ask for it,
  and `/implement` documents both.
- **Running the load step with Claude Code signed out**, to see how it fails.
  Signing out touches the person's credentials. The spec accepts the type
  check's error as the backstop for that case.

## Steps

1. Commit this plan by itself.
2. Write `CLAUDE.md` and run the checks below against it.
3. Run the four gates as the file writes them, and record the test summary
   line for the pull request description.
4. Commit `CLAUDE.md`.
5. When the pull request opens, expect `/implement` to ask the person before
   merging. The branch adds the `Base branch:`, `Checks:` and `Merge command:`
   lines, and `/implement` asks about any branch that changes them.

## Test plan

Each check maps to a bullet of the spec's Verification section.

1. **Facts.** `grep -E '^(Base branch|Checks|Merge command):' CLAUDE.md`
   prints exactly the three lines, `grep -E '^(Max pushes per round|Max rounds):' CLAUDE.md`
   prints nothing, `grep -nE '^(Base branch: main|Checks: none|Merge command: gh pr merge <n> --merge --match-head-commit <sha>)$' CLAUDE.md`
   finds all three with no trailing space, and
   `grep -nE '^\s*[-*] *(Base branch|Checks|Merge command|Max)' CLAUDE.md`
   prints nothing.
2. **Sections.** `grep -n '^## ' CLAUDE.md` shows `## Gates` before
   `## Hard rules`, and
   `awk '/^## Gates/{f=1;next}/^## /{f=0}f&&/^- /' CLAUDE.md` prints four
   bullets: the load step, the type check, the tests and validate.
3. **The quoted error.** Copy the tracked files of `mods/pilot` into a scratch
   folder whose name holds a space, run the type check there, and expect a
   non-zero exit, a line containing `TS5083: Cannot read file` and
   `.claude-plugin/types/tsconfig.json'.`, and
   `Cannot find global value 'Promise'`.
4. **Each gate as written.** Run the load step from `skills/`, and check that
   it exits 0 and that the types folder it deleted exists again. Then run
   the type check, `claude plugin test` and `claude plugin validate`, each
   once from `mods/pilot` as written and once from the root with the folder
   passed as an argument. All exit 0, and the test summary line goes into the
   pull request description.
5. **The diff.** `git diff --name-only origin/main...HEAD` lists `CLAUDE.md`,
   the spec and this plan, and nothing else.
