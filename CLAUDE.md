# Skills

This repository holds generic skills, agents and mods for Claude Code. The
`/implement` and `/verify-loop` skills read the facts, gates and rules below.

Base branch: main
Checks: none
Merge command: gh pr merge <n> --merge --match-head-commit <sha>

The repository has no continuous integration, so no checks report on a pull
request. Every other fact that `/implement` reads keeps its default.

## Gates

Run every gate on every change, in this order.

- Load the builder and foreman mods together once, from a scratch folder outside the repository, starting anywhere inside it: `(root="$(git rev-parse --show-toplevel)" && rm -rf "$root/mods/builder/.claude-plugin/types" "$root/mods/foreman/.claude-plugin/types" && cd "$(mktemp -d)" && { perl -e 'alarm 120; exec @ARGV' env CLAUDE_CODE_PLUGIN_DIR_WATCH=1 claude -p --max-turns 1 --plugin-dir "$root/mods/builder" --plugin-dir "$root/mods/foreman" "ok" < /dev/null > /dev/null 2>&1; test -f "$root/mods/builder/.claude-plugin/types/tsconfig.json" && test -f "$root/mods/foreman/.claude-plugin/types/tsconfig.json"; })`. Loading a mod writes its engine types into its own `.claude-plugin/types/` folder. Foreman names builder under `dependencies` in its manifest, so the load also links builder's state contract into foreman's types folder, and foreman's type check reads builder's types through that link. The link points at the builder that the same load saw, so the command loads both folders in one call, which makes the link point at this checkout's builder rather than at a copy installed elsewhere. From Claude Code 2.1.299, a non-interactive load writes a mod's types only for plugin folders that it watches for live reloads, and it watches none unless `CLAUDE_CODE_PLUGIN_DIR_WATCH` is set, so the command sets that variable on the `claude` call alone. Git ignores both types folders, and each mod's `tsconfig.json` extends the `tsconfig.json` inside its own types folder, so the type checks need this step first. The command deletes the old types so that the new ones always match the installed Claude Code, because a rerun does not rewrite types that are already there. Run it again after a change to either manifest, for the same reason. It ignores how the model call ends, because Claude Code writes the types even when `claude` is not signed in, and it passes only if the types of both mods exist again. The `perl` alarm stops the `claude` call after two minutes, because a stuck MCP server or startup hook would otherwise hold the gate for up to ten minutes, which is how long Claude Code waits for a hook. It uses `perl` because macOS has no `timeout` command by default. Claude Code writes the types before it runs a stuck hook, so a load that the alarm cuts short still passes. Two minutes is about three times the slowest measured load that finished by itself in under a minute. On a machine whose load needs longer, the alarm stops `claude` before the types are written, so this gate fails instead of hanging, and running it again fails the same way, so time the load and lengthen the alarm. The alarm stops only `claude`, so a hook or MCP server that it cuts off can leave its own process running until that process ends or someone stops it. The parentheses keep the move into the scratch folder from changing where the next gate starts.
- From `mods/builder`, and then from `mods/foreman`: `npx -y -p typescript@5.6.3 tsc -p . --noEmit`. When the first gate did not run, or failed, this prints `error TS5083: Cannot read file '…/.claude-plugin/types/tsconfig.json'.` together with errors such as `error TS2468: Cannot find global value 'Promise'.` The cure is to run the first gate. Never edit `tsconfig.json` to make these errors go away.
- From `mods/builder`, and then from `mods/foreman`: `claude plugin test .`
- From `mods/builder`, and then from `mods/foreman`: `claude plugin validate .`

No gate reads `skills/`, `docs/` or `README.md`. A change to those
files is checked only by its reviewers, and a green run of the gates says
nothing about them, so a report on such a change says that the gates did not
read it.

## Hard rules

- The skills, the agents, the mods and `README.md` name no project, client or
  product. They are generic, so that any repository can use them.
- Specs and plans under `docs/specs/` describe the incident behind a
  requirement, because a requirement needs its reason, but in generic terms:
  they name no project, client, product or person, and never contain
  credentials, customer data, personal details, local paths, or the contents
  of a private repository.
- A reviewer applies these rules to the text a pull request adds or changes.
- Everything is written in plain, complete sentences: skills, agents, specs,
  commit messages, pull request descriptions and reviews.
