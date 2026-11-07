# Plan: the owner's global CLAUDE.md follows the configuration folder

Date: 2026-11-06. Spec: `docs/specs/owner-claude-md-follows-config-folder.md`.

## Chosen approach

Two plans competed. One looked for the smallest change, and the other started
from failure modes. The simplest-thing plan won. It rewords eight passages in
six files, adds no new file and no new section, and keeps no state: each
offer reads `CLAUDE_CONFIG_DIR` fresh, so a restart, a resumed or cleared
session, or a hot reload changes nothing. Two copies running at once may each
append a line to the same file, just as they can on the base branch.

There are two kinds of edit:

- **Read places** in the implement, spec, plan-tournament and pr-comments
  skills name the file with the `Reviewer:` row's wording: `CLAUDE.md` in the
  Claude configuration folder (`CLAUDE_CONFIG_DIR`, or `~/.claude` when that
  is unset).
- **Write offers** in the implement Questions section and the spec Output
  section state the rule for choosing the file in full, in the same sentences
  in both skills. `/spec` runs on its own, so a pointer from it into the
  1,250-line implement skill would make it harder to follow, and the rule is
  only a few sentences long. Identical sentences let one search find both
  copies when the rule changes later.

The two builder agents name the file the same way. They are told that Claude
Code already loads it into their context as the user's instructions, and they
read `~/.claude/CLAUDE.md` only when their context holds no user
instructions.

## Grafts from the most-robust plan

1. **A separate sentence for the list of what the owner wrote down.** The
   implement Questions section and spec rule 1 each say "What the owner has
   written down is their global `CLAUDE.md` in the Claude configuration
   folder (`CLAUDE_CONFIG_DIR`, or `~/.claude` when that is unset), the
   project's `CLAUDE.md`, …". This keeps the row's wording exactly, and it
   avoids a list in parentheses that holds other parentheses.
2. **"With the home folder written out" in the unset case.** The offer then
   names a real full path, as Behavior point 3 asks, and the session never
   passes a literal `~` to the tool that writes the file.
3. **A scoped check in the pull request.** The spec's third search already
   matches a line in the "Updating the linked checkout" section of the
   implement skill on the base branch, so it proves nothing for that file.
   The pull request also quotes
   `sed -n '/^## Questions/,/^## /p' skills/implement/SKILL.md | grep -n 'relative'`,
   which reads only the Questions section, and says why.
4. **"You cannot read `CLAUDE_CONFIG_DIR`, so"** before each agent's
   fallback sentence, so the agent knows why the fallback exists.

## Rejected alternatives

- **A shell command that prints the finished path**, pasted into both writing
  skills. It is correct under bash, zsh, sh and bash with unset variables
  treated as errors, but its parameter expansion cannot be read without a
  shell manual. Two pasted copies could drift apart, and the spec
  deliberately keeps the short rule in prose.
- **Extra rules: never reuse a path from an earlier offer, and never type a
  `~` into a file path.** Behavior point 5 says nothing else changes.
  Reading the variable before each offer already covers the first rule, and
  the home-folder graft covers the second.
- **Treating every value that does not begin with `/` as relative.** This
  would call a Windows drive path relative, which is wrong. The spec keeps
  the short rule.
- **An extra sentence in plan-tournament telling the session to read the
  variable first.** Behavior point 1 already says a session with a shell reads
  the variable when it needs the actual path.
- **One copy of the write rule, with the other skill pointing at it.** This
  was rejected for the reason given under the chosen approach.

## Step sequence

1. In `skills/implement/SKILL.md`, in the Questions section, move the list of
   what the owner wrote down into its own sentence, using the shared wording.
   Then replace the offer's fixed path with the full write rule:
   - read `CLAUDE_CONFIG_DIR` from the shell before offering;
   - when it is set to an absolute path, the file is `CLAUDE.md` in that
     folder, with no doubled slash when the value ends in one;
   - when it is unset or empty, the file is `~/.claude/CLAUDE.md`, with the
     home folder written out;
   - the offer names the full path, and a yes creates the file when it does
     not exist yet;
   - when the value is a relative path, offer nothing, write nothing, and
     say why in one sentence.
2. Make the same two edits in `skills/spec/SKILL.md`, in interview rule 1 and
   the Output section. These say "person" where the implement skill says
   "owner".
3. In `skills/plan-tournament/SKILL.md`, use the shared wording in step 1
   and step 3, and rewrap the overlong line in step 3.
4. In `skills/pr-comments/SKILL.md`, use the shared wording in the writing
   rules.
5. In `mods/builder/agents/maintainability-reviewer.md` and
   `mods/builder/agents/owners-advocate.md`, use the shared wording, the
   sentence saying Claude Code already loads the file, and the fallback
   sentence. Leave the frontmatter alone.
6. Run the searches below again after the final line wrap, because a
   different wrap can split "relative" and `CLAUDE_CONFIG_DIR` onto separate
   lines.

## Test plan

These map to the spec's Verification section and run from the repository's
top folder.

1. `grep -n '~/\.claude'` over the six files. Every line it prints belongs to
   one of these:
   - the short form;
   - the unset case of the write rule;
   - the agents' fallback sentence;
   - the untouched `Reviewer:` row or "Updating the linked checkout" section
     of the implement skill.

   A short form that wraps so that `~/.claude` begins a line is checked
   against the line before it.
2. `grep -c 'CLAUDE_CONFIG_DIR'` over the six files prints at least 1 for
   each. On the base branch it prints 0 for five of them.
3. The spec's `relative` search prints at least one line for each writing
   skill. The scoped `sed` check above prints the new lines of the implement
   Questions section.
4. The repository's gates pass. They check that the agents' frontmatter
   still loads, and they do not read `skills/`, which the pull request says.
5. The staged-diff search from `.claude/rules/no-project-names.md` prints
   nothing.
