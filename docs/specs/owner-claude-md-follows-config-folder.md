# The owner's global CLAUDE.md follows the configuration folder

Date: 2026-11-06.

## Goal

Every skill and agent in this repository that reads or writes the owner's
personal `CLAUDE.md` names the file Claude Code actually loads. Claude Code
loads that file from its configuration folder, which is `CLAUDE_CONFIG_DIR`
when that variable is set, and `~/.claude` otherwise. Today four skills and
two builder agents name `~/.claude/CLAUDE.md` as a fixed path. On a machine
that sets `CLAUDE_CONFIG_DIR`, they read a file Claude Code never loads, and
when the owner agrees to save a preference line, the session writes it into
that unloaded file, where it is silently lost and the session may ask the same
question again later.

## Users/Trigger

- A session running `/implement` or `/spec` that offers the owner one line for
  their global `CLAUDE.md` after the owner answers a question about how they
  work, and writes it when the owner says yes.
- A session running `/implement`, `/spec`, `/plan-tournament` or `/pr-comments`
  that reads what the owner has written down.
- The builder mod's maintainability reviewer and owner's advocate, which read
  the owner's global instructions to judge a pull request or a counsel
  question. Both have only the Read, Grep and Glob tools, so they cannot read
  an environment variable.

## Behavior

1. **One name for the file.** Every place that reads the owner's global
   instructions names the file as `CLAUDE.md` in the Claude configuration
   folder (`CLAUDE_CONFIG_DIR`, or `~/.claude` when that is unset), the
   wording that the `Reviewer:` row of `skills/implement/SKILL.md` already
   uses. The places are the "Questions" section of `skills/implement/SKILL.md`,
   interview rule 1 of `skills/spec/SKILL.md`, the brief and judging steps of
   `skills/plan-tournament/SKILL.md`, and the writing rules of
   `skills/pr-comments/SKILL.md`. A session running those skills has a shell
   and reads the variable when it needs the actual path.
2. **The write resolves the path first.** The write offers in the "Questions"
   section of `skills/implement/SKILL.md` and the "Output" section of
   `skills/spec/SKILL.md` tell the session, before it offers a line, to read
   `CLAUDE_CONFIG_DIR` from its shell, and to choose the file this way:
   - set, not empty and an absolute path: `CLAUDE.md` in that folder;
   - unset or empty: `~/.claude/CLAUDE.md`;
   - a relative path: no file. The session offers nothing and writes nothing,
     and tells the owner in one sentence that it cannot save the line because
     `CLAUDE_CONFIG_DIR` is a relative path, so the configuration folder
     cannot be found.
3. **The offer names the file.** When a file was chosen, the offer to the
   owner names its full path, so the owner's yes covers the exact file that is
   written. The session still writes only when the owner says yes.
4. **The agents use what Claude Code loaded.** The maintainability reviewer
   (`mods/builder/agents/maintainability-reviewer.md`) and the owner's
   advocate (`mods/builder/agents/owners-advocate.md`) name the file with the
   same wording as point 1, and are told that Claude Code already loads it into
   their context as the user's instructions, so they use that text. They read
   `~/.claude/CLAUDE.md` themselves only when their context holds no user
   instructions.
5. Nothing else in these files changes: when the skills ask the owner, what
   they record in the spec, and what the agents do with the owner's word stay
   as they are.

## Edge cases

- `CLAUDE_CONFIG_DIR` set to an absolute path with a trailing slash: the file
  is `CLAUDE.md` inside that folder; the session does not write a doubled
  slash into the offer.
- `CLAUDE_CONFIG_DIR` set to an absolute folder that holds no `CLAUDE.md` yet:
  the session creates the file there on the owner's yes, as it creates
  `~/.claude/CLAUDE.md` today.
- An agent whose context holds no user instructions on a machine that sets
  `CLAUDE_CONFIG_DIR` reads `~/.claude/CLAUDE.md` and so may miss the owner's
  word. That is no worse than the base branch, and it needs two unusual
  conditions at once.

## Non-goals

- The install lines in `README.md`, `mods/builder/README.md` and
  `mods/foreman/README.md`, which name `~/.claude/skills` rather than
  `CLAUDE.md`. The spec
  `docs/specs/implement-names-configuration-folder-for-links.md` left them out
  on purpose.
- The older specs and plans under `docs/specs/` that mention
  `~/.claude/CLAUDE.md`. They record past work.
- The mod's code, its README, its counsel briefs and the fixed reviewer
  prompts in `skills/implement/SKILL.md`. No path is passed to an agent.
- The mod's whole rule for finding the folder, with its `HOME` and
  `USERPROFILE` fallbacks; the skills keep the short rule above.
- A test over the agents' text. The builder tests read no agent file, and a
  test that pinned this prose would break on any rewording.

## Failure modes

The change is wording in instructions to a model. If a session ignores the
rule, it writes to the wrong file as it does today. A relative
`CLAUDE_CONFIG_DIR` now makes the session say that nothing can be saved
instead of losing the line silently, so the owner can save it by hand.

## Verification

No gate reads `skills/`, and the builder tests do not read the agents' text;
the gates check only that the agents' frontmatter is still valid. The pull
request says so, and quotes the output of these searches, run from the
repository's top folder.

The old fixed-path wording is gone. This search prints every line of the six
files that names `~/.claude`. A reviewer reads each line it prints and checks
that it belongs to the new wording (the unset branch of the write rule, the
short form "`CLAUDE_CONFIG_DIR`, or `~/.claude` when that is unset", or the
agents' fallback sentence), or to text this change does not touch, namely the
`Reviewer:` row and the "Updating the linked checkout" section of
`skills/implement/SKILL.md`.

```bash
grep -n '~/\.claude' skills/implement/SKILL.md skills/spec/SKILL.md skills/plan-tournament/SKILL.md skills/pr-comments/SKILL.md mods/builder/agents/maintainability-reviewer.md mods/builder/agents/owners-advocate.md
```

The new wording is present in each of the six files, so the search above did
not come back short because a file was moved or emptied. This prints a count
of at least 1 for every file:

```bash
grep -c 'CLAUDE_CONFIG_DIR' skills/implement/SKILL.md skills/spec/SKILL.md skills/plan-tournament/SKILL.md skills/pr-comments/SKILL.md mods/builder/agents/maintainability-reviewer.md mods/builder/agents/owners-advocate.md
```

The write rule's relative case and the offer's path are present in both
writing skills. This prints at least one line for each file:

```bash
grep -n 'relative' skills/implement/SKILL.md skills/spec/SKILL.md | grep -i 'CLAUDE_CONFIG_DIR\|configuration folder'
```

## Decided by the counsel

- Which files does this change correct, given that two builder agents also read the owner's global CLAUDE.md at the fixed path ~/.claude/CLAUDE.md but the issue does not list them? The counsel chose: The four skills the issue lists and the two builder agents (maintainability-reviewer and owners-advocate). 7 of 7 members voted for it.
- When /implement or /spec writes a line the owner agreed to save into their global CLAUDE.md, how does the session decide which file to write? The counsel chose: Before writing, the session reads CLAUDE_CONFIG_DIR from its shell. When it is set, non-empty and absolute, it writes CLAUDE.md in that folder; when it is unset or empty, ~/.claude/CLAUDE.md; when it is relative, it writes nothing and tells the owner why. 7 of 7 members voted for it.
- How do the places that only read the owner's global CLAUDE.md name it, given that the two builder agents have only Read, Grep and Glob and so cannot read CLAUDE_CONFIG_DIR themselves? The counsel chose: Every read place names it with the short wording 'CLAUDE.md in the Claude configuration folder (CLAUDE_CONFIG_DIR, or ~/.claude when that is unset)'. The skills, whose session has a shell, read the variable when they need the path. The two agents are told that Claude Code already loads that file into their context as the user's instructions, so they use that text, and read ~/.claude/CLAUDE.md only when their context holds no user instructions. 7 of 7 members voted for it.
- Should the offer to save a line into the owner's global CLAUDE.md name the full path the session resolved, so the owner sees which file they are approving? The counsel chose: Yes: the offer names the resolved path, and when CLAUDE_CONFIG_DIR is relative the offer is replaced by a sentence saying why nothing can be saved. 7 of 7 members voted for it.
- How is this change verified, given that no gate reads skills/ but the two agent files sit inside the builder mod, whose tests the gates do run? The counsel chose: Recorded searches only: the spec lists grep commands over skills/ and mods/builder/agents/ whose output the pull request quotes, each paired with a search that must still find the new wording, so an empty result means something. 7 of 7 members voted for it.
