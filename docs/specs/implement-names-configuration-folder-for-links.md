# The /implement skill names the configuration folder for the links

Date: 2026-11-06.

## Goal

The section "Updating the linked checkout" of `skills/implement/SKILL.md`
says where the builder mod looks for the links to skills, agents and
commands, and that statement matches what the mod does. Today the section
says the links are under `~/.claude` and that the mod finds them in
`~/.claude/skills`, `~/.claude/agents` and `~/.claude/commands`. The mod
searches Claude Code's configuration folder instead, which is
`CLAUDE_CONFIG_DIR` when that is set (see `configFolderOf` in
`mods/builder/hooks/status.ts` and `updateAll` in
`mods/builder/hooks/linked.ts`).

## Users/Trigger

A session running `/implement` reads this section to know what the
**Merged** step's outcome sentences mean, and a person reads it to know
where the links live. The change that made the mod search the configuration
folder (`docs/specs/linked-checkout-on-windows-and-failed-calls-from-tool-call.md`)
left the section unchanged, and its review filed this as a follow-up. On a
machine where `CLAUDE_CONFIG_DIR` points somewhere other than `~/.claude`,
the section names one folder and the Merged step's sentence names another.

## Behavior

1. The section's first paragraph names the folder with the wording that the
   `Reviewer:` row of the same skill's facts table already uses: "the Claude
   configuration folder (`CLAUDE_CONFIG_DIR`, or `~/.claude` when that is
   unset)". It says that the links live there and that the mod finds them in
   the `skills`, `agents` and `commands` folders inside it.
2. The section no longer contains the strings `~/.claude/skills`,
   `~/.claude/agents` or `~/.claude/commands`, and no longer says the links
   are "under `~/.claude`".
3. The "Left alone" bullet adds the case where the mod cannot find the
   configuration folder at all, such as when `CLAUDE_CONFIG_DIR` is a
   relative path. In that case the outcome names no checkout and no link,
   only the reason, so the bullet says that.
4. Nothing else in the section changes: what the session does with each
   outcome stays as it is.

## Edge cases

- `CLAUDE_CONFIG_DIR` unset: the wording names `~/.claude`, which is where
  the mod looks when `HOME` is set, as it is on macOS and Linux.
- On Windows the mod falls back to `USERPROFILE` when `HOME` is unset. The
  short form does not spell this out; the mod's README and its code hold the
  whole rule, and the Merged step's sentences name the resolved paths.

## Non-goals

- Every other mention of `~/.claude` stays as it is: the skills' mentions of
  `~/.claude/CLAUDE.md` as the owner's global instructions, in
  `skills/implement/SKILL.md`, `skills/spec/SKILL.md`,
  `skills/plan-tournament/SKILL.md` and `skills/pr-comments/SKILL.md`, and
  the install lines in `README.md`, `mods/builder/README.md` and
  `mods/foreman/README.md`. The ones that write a preference line into that
  file are filed as their own follow-up issue.
- The skill does not copy the mod's whole rule for finding the folder
  (absolute values only, the `HOME` and `USERPROFILE` fallbacks, dropped
  trailing slashes).
- The "Left alone" bullet does not list the mod's other reasons for leaving
  every checkout alone, such as values from GitHub that are unsafe to pass
  to git. Each of those sentences states its own reason.
- No change to the mod, its tests or its README.
- No test reads the skill: the testing kit refuses files outside a mod's
  folder.

## Failure modes

The change is wording only. If it is wrong, a session or a person reads a
folder that differs from the one the mod searches; the Merged step's own
sentences still name the real paths, so the session's report stays correct.

## Verification

No gate reads `skills/`, so the reviewers check the change and the pull
request says that the gates did not read it. These searches, run from the
repository's top folder, record the result:

```bash
sed -n '/^### Updating the linked checkout/,/^## Questions/p' skills/implement/SKILL.md | grep -nE '~/\.claude/(skills|agents|commands)|under `~/\.claude`'
```

prints nothing.

```bash
sed -n '/^### Updating the linked checkout/,/^## Questions/p' skills/implement/SKILL.md | grep -n 'CLAUDE_CONFIG_DIR'
```

prints at least one line, and the reviewers compare the section with
`updateAll` and `noConfigReason` in `mods/builder/hooks/linked.ts`.

## Decided by the counsel

- Which places should this change correct? The section "Updating the linked checkout" in skills/implement/SKILL.md says the links are under `~/.claude` and that the mod finds them in `~/.claude/skills`, `~/.claude/agents` and `~/.claude/commands`, while the mod now searches Claude Code's configuration folder. Other text also names `~/.claude`: the "Questions" section of the same skill and the spec, plan-tournament and pr-comments skills name `~/.claude/CLAUDE.md` as the owner's global instructions, and the install lines in README.md, mods/builder/README.md and mods/foreman/README.md tell people to make links under `~/.claude/skills`. The counsel chose: Only the section "Updating the linked checkout" in skills/implement/SKILL.md; every other mention of ~/.claude is left as it is. 7 of 7 members voted for it.
- How precisely should the corrected section describe the folder the mod searches for links? The counsel chose: Reuse the short form the Reviewer: fact row already uses, "the Claude configuration folder (CLAUDE_CONFIG_DIR, or ~/.claude when that is unset)", and name the three folders as skills, agents and commands inside it. 7 of 7 members voted for it.
- Should the section's list of outcomes say that the mod leaves the checkout alone when it cannot work out the configuration folder at all? The counsel chose: Yes: add to the "Left alone" bullet that this includes the case where the configuration folder could not be found, such as a relative CLAUDE_CONFIG_DIR. 5 of 7 members voted for it.
- Several counsel members noted that the skills tell a session to offer and then write a preference line into `~/.claude/CLAUDE.md` (skills/implement/SKILL.md "Questions" section, line 1149, and skills/spec/SKILL.md line 93), which is not the file Claude Code loads when CLAUDE_CONFIG_DIR points elsewhere. This change leaves those lines alone, as decided. What should happen to that gap? The counsel chose: File it as its own follow-up issue, so a later change decides whether those lines should name the configuration folder. 7 of 7 members voted for it.
- How should this change prove that the corrected section matches the mod? The counsel chose: By review and a recorded search only: the spec's Verification lists the grep commands that show the section no longer names ~/.claude/skills, ~/.claude/agents or ~/.claude/commands and now names CLAUDE_CONFIG_DIR, and the pull request says that no gate reads skills/. 7 of 7 members voted for it.
