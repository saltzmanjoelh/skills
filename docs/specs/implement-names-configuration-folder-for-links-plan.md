# Plan: the /implement skill names the configuration folder for the links

Spec: `docs/specs/implement-names-configuration-folder-for-links.md`.

## Chosen approach

The simplest-thing plan won. It rewrites two blocks of the section
"Updating the linked checkout" in `skills/implement/SKILL.md` and nothing
else: the first paragraph and the "Left alone" bullet. The first paragraph
says that the links live in the Claude configuration folder, using the
wording of the skill's `Reviewer:` row, and point into a repository's main
checkout. It also says that the mod finds them in the `skills`, `agents` and
`commands` folders inside that folder. The bullet adds the case where the mod
cannot find the configuration folder at all. In that case the outcome names
no checkout and no link, only the reason and the sentence that new sessions
will run the old code, which is what `leftAloneAll` in
`mods/builder/hooks/linked.ts` writes.

The change keeps no state, so a restart, a resumed or cleared session, a hot
reload or two copies running at once create no edge case.

## Grafts

- From the most-robust plan, the bullet names "the Claude configuration
  folder" in full, because the full name appears well above it and the
  owner's rule is to name the actual thing every time.
- From the most-robust plan, three mechanical checks: no line of the section
  is longer than 76 columns, no inline code span is split across two lines,
  and `git diff` touches only the two blocks.
- From the most-extensible plan, the section's lines are joined before the
  searches run, so a phrase split across a line break cannot slip past them.

## Rejected alternatives

- The most-robust plan's first sentence kept the original shape, "load
  through symlinks in the Claude configuration folder (...) into a
  repository's main checkout". With the long bracketed phrase in the middle,
  a reader has to work out what "into" attaches to, and it never says that
  the links live in the folder. Its bullet ended "only the reason", which
  does not say the reason for what.
- The most-extensible plan's bullet dropped the sentence that new sessions
  will run the old code. That misdescribes the mod, because `leftAloneAll`
  always adds that sentence, and it contradicts the bullet's own first
  sentence. Its search aimed at a later follow-up is outside this change.

## Steps

1. Run the spec's first search and see it print three lines.
2. Replace the first paragraph with:

   ```
   Skills, agents and the builder mod load through symlinks that live in the
   Claude configuration folder (`CLAUDE_CONFIG_DIR`, or `~/.claude` when that
   is unset) and point into a repository's main checkout, not into this
   worktree, so a session started a moment after the merge runs whatever that
   checkout holds. The builder mod keeps that checkout current itself: on the
   first look that chooses the step **Merged**, it finds the links in the
   `skills`, `agents` and `commands` folders inside the configuration folder,
   and fast-forwards the main checkout of the merged repository to the merge
   commit when that is safe. It runs the update once for each merged pull
   request, never forces a checkout, and never retries a failed update, except
   once after a lock. The session runs none of this itself and never works in
   a main checkout.
   ```

3. Replace the "Left alone" bullet with:

   ```
   - **Left alone:** the checkout's path or the broken link, what stopped it,
     and that new sessions will run the old code until someone updates it.
     This includes an update that started and did not finish, because the mod
     stopped in the middle of it. It also includes the case where the mod
     cannot find the Claude configuration folder at all, such as when
     `CLAUDE_CONFIG_DIR` is a relative path. Then the outcome names no
     checkout and no link, only the reason the folder could not be found and
     that new sessions will run the old code.
   ```

4. Run the checks below and commit.

## Test plan

No gate reads `skills/`, so these checks and the reviewers stand in for
tests, and the pull request says that the gates did not read the change.

- The spec's first search prints nothing, and its second prints at least one
  line.
- With the section's lines joined by `tr '\n' ' '`, a count of the
  `Reviewer:` row's wording, "the Claude configuration folder
  (`CLAUDE_CONFIG_DIR`, or `~/.claude` when that is unset)", is at least 1,
  and searches for `~/.claude/skills`, `~/.claude/agents`,
  `~/.claude/commands` and "under `~/.claude`" find nothing.
- No line of the section is longer than 76 columns, and no line of it holds
  an odd number of backticks.
- `git diff` changes only the first paragraph and the "Left alone" bullet.
- The four gates in `CLAUDE.md` still pass for builder and foreman.
