# skills

Personal Claude Code skills and review agents, in one place. Each
`~/.claude/skills/<name>` is a symlink into this repository, so edit here.

The skills are `spec`, `plan-tournament`, `implement`, `verify-loop`,
`pr-comments`, `storypr`, `summarize` and `cleanup`, which is a generic
teardown of a finished worktree.

The review agents live in the builder mod, in `mods/builder/agents`. The
builder mod used to be called pilot. Its README says how to replace an old
link or install, and that builder starts with an empty store.

The foreman mod, in `mods/foreman`, lets one parent session run several
`/implement` sub sessions. It gives each sub session the parent starts a
ticket, reads the status files that builder writes, one per sub session,
and shows them in a band above the prompt and in a pane. It nudges a sub
session that sits idle, notifies the person when one needs them, frees a
slot when one finishes, and wakes the parent's model with one line only when
there is a decision to make. It does nothing in a session until that session
runs `/foreman`. It ships the skill `foreman:wake`, which tells the parent
what each wake line asks of it. Its README says how to install it and what it
does.

## Project facts

The skills take what differs between projects from the project's `CLAUDE.md`.
Each fact is one `Label: value` line anywhere in that file. The gates and the
hard rules are sections, each under its own heading. A skill refers to a
fact's value by its label in lower case inside angle brackets, such as
`<base branch>`. A directory fact stands for the directory without its
trailing slash, so that no path contains `//`.

One thing a skill reads is deliberately not a fact. `verify-loop` reads, as
plain prose anywhere in the project's `CLAUDE.md`, any statement of which paths
the project's gates do not read, and has no default for it.

This table is the contract. Each skill restates the defaults of the facts it
reads, because a skill is loaded alone into another project, where this README
is not in view. The skills must agree with this table word for word, so adding
a fact, or changing a default, changes this table and every skill its row
names.

| Fact | Default | Read by |
|---|---|---|
| `Base branch:` | `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name` | implement, storypr, cleanup |
| `Spec directory:` | `docs/specs/` | implement, spec, plan-tournament |
| `Architecture document:` | `docs/architecture.md`, skipped if missing | implement, plan-tournament |
| `Gotchas document:` | `docs/gotchas.md`, skipped if missing | implement, plan-tournament |
| `Screenshot directory:` | `docs/screenshots/` | storypr |
| `Issue tracker:` | none; the argument is a sentence | implement |
| `Worktree setup:` | none; a plain `git worktree add` | implement |
| `Max pushes per round:` | 8 | implement |
| `Max rounds:` | 5 | implement |
| `Merge command:` | `gh pr merge <n> --merge --match-head-commit <sha>`; a project whose merges go through its own gate names that command, with `<n>` and `<sha>` in it | implement |
| `Checks:` | `expected` when the base branch has files under `.github/workflows`, else `none`; a project whose checks report from an outside service writes `Checks: expected` | implement |
| `Next issue:` | none; ask the person | foreman |
| `## Gates` heading, one bullet per gate | detect from the manifests, confirm once, offer to write it | implement, verify-loop, pr-comments |
| `## Hard rules` heading | none | implement |
