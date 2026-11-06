# An unreadable user CLAUDE.md holds the merge

Written 2026-11-05. Seeded from an issue in the owner's tracker that collected
the follow-ups to the change that made the mod wait for an outside reviewer
(see `docs/specs/builder-waits-for-outside-reviewer.md`).

## Goal

When the CLAUDE.md in the user's Claude configuration folder exists but cannot
be read, the builder mod must not merge around a reviewer whom only that file
names. Today the mod treats every failure to read that file as a file with no
`Reviewer:` line, so such a reviewer silently drops out and the step can be a
plain merge. Nothing later catches it, because the merge texts re-read only
the base branch's CLAUDE.md.

## Users/Trigger

A person who names their reviewer once, in the `Reviewer:` line of their own
CLAUDE.md, for every project, and whose file cannot be read at a look: its
permissions forbid reading it, a folder stands where the file should be, it
is over the engine's read limit, or the read fails for a passing reason such
as a lock or a rewrite. The mod's look runs at every poll, about every 90
seconds, and at each call to the watch tool.

## Behavior

### Reading the user's file

- The mod works out the configuration folder as today: `CLAUDE_CONFIG_DIR`
  when it is set and not empty, otherwise `.claude` under `HOME`.
- The user's file counts as **missing** in exactly two cases, and a missing
  file means no `Reviewer:` line, as today:
  - no configuration folder can be worked out, because `CLAUDE_CONFIG_DIR` is
    set but relative, or `HOME` is unset or not absolute;
  - `$.fs.exists` answers false for `<folder>/CLAUDE.md`.
- Every other failure counts as **unreadable**: a read that rejects for a
  path that exists, and an `exists` call that itself rejects. The mod tells
  the two apart only with `$.fs.exists`, never by the shape or text of a read
  error.
- A file that is read keeps its meaning as today.

### Unknown reviewers

- The reviewers are **unknown** when the user's file is unreadable and the
  `Reviewer:` fact would have come from it: the base branch's CLAUDE.md has
  no `Reviewer:` line, or could not be read.
- When the base branch's CLAUDE.md has a `Reviewer:` line, including
  `Reviewer: none`, that line decides as today, and an unreadable user file
  changes nothing.
- The look stores the unknown state with the base facts. A snapshot stored
  before this change has no such mark and counts as known.

### The new step

- With the reviewers unknown, once both verdicts approve, the look still
  names the three outside reviewer steps first, for the outside reviewers it
  does know (those requested now, and those whose review carries `OWNER`,
  `MEMBER` or `COLLABORATOR`).
- When none of those applies, the look names a new step in place of every
  later step where both verdicts approve: before waiting on checks, the merge,
  and the question about merging without checks. It never names a merge
  step while the reviewers are unknown.
- The step is shaped like the step for workflow runs that could not be read.
  Its title says that both verdicts approve at this head but the user's own
  CLAUDE.md could not be read. Its text names the file by its place, the
  CLAUDE.md in the user's Claude configuration folder, says that it exists
  but could not be read so the reviewers it may name are unknown, tells the
  session to merge nothing and end the turn, and says that the mod looks
  again at its next poll and starts a turn once the file can be read.
- The step sets no state label, so the label the pull request carries stays.
- The mod's existing stuck prompt, after a long quiet time with the pull
  request open, catches a file that stays unreadable.

### Documents

- `docs/specs/builder-waits-for-outside-reviewer.md` stops saying that an
  unreadable user file is treated as having no `Reviewer:` line, and points
  to this spec.
- `skills/implement/SKILL.md` and `mods/builder/README.md` say what an
  unreadable user file does, where they describe the `Reviewer:` fact.

## Edge cases

- **The file is removed between the `exists` call and the read.** The read
  rejects for a path that existed, so it counts as unreadable and the merge
  waits one more poll. The next look finds it missing.
- **The file is unreadable and the base branch's CLAUDE.md cannot be read
  either.** The reviewers are unknown, and the new step holds the merge.
- **The file is unreadable, but an outside reviewer is already requested or
  has given feedback.** The outside reviewer steps come first, as today. The
  new step comes only after every known outside reviewer approves.
- **The file is unreadable for a passing reason.** The next poll reads it,
  the step changes, and the mod starts a turn as for any change of step.
- **A person has no user CLAUDE.md at all.** It is missing, so pull requests
  merge as before.

## Non-goals

- The base branch's unreadable CLAUDE.md. The look may still name a merge
  there, and the merge texts' fetch and re-read of that file stop it, as
  today.
- Any change to the merge texts.
- Any other fact read from the user's file.
- Foreman's own reads of the configuration folder.
- Showing the read error's text. The step names the file and says it could
  not be read, and the error's shape is not documented and would put
  untrusted text into a prompt.
- Resolving a relative `CLAUDE_CONFIG_DIR` to find a file there.

## Failure modes

- **A file that stays unreadable.** No merge happens. The step's text and the
  pane's title say why. The stuck prompt reaches the session after a long
  quiet time, and the session then asks the person.
- **The engine reports an unreadable file as not existing.** The mod would
  take it for missing and merge as before. The live check below is there to
  show that the real engine does not do this.

## Verification

- Tests in `mods/builder/tests/register.test.ts`, through the watch tool, with
  the fake file system extended so that a path can exist yet refuse its read,
  and so that an `exists` call can reject. They show:
  - an unreadable user file with a base file that has no `Reviewer:` line
    names the new step and no merge;
  - an `exists` call that rejects names the new step;
  - a missing user file, and no workable configuration folder, merge as
    before;
  - a `Reviewer:` line in the base branch's CLAUDE.md, and `Reviewer: none`
    there, still decide when the user's file is unreadable;
  - an unreadable user file with an unreadable base file names the new step;
  - a known outside reviewer's step still comes before the new step.
- Unit tests in `mods/builder/tests/step.test.ts` or
  `mods/builder/tests/outside.test.ts` for the new step's place in the order,
  its title and text, and its null state label, and that a snapshot without
  the unknown mark counts as known.
- The four gates in the project's CLAUDE.md.
- One live check: a real Claude Code session with `CLAUDE_CONFIG_DIR` pointed
  at a scratch folder whose CLAUDE.md names a reviewer and has had its read
  permission removed, watching a pull request in a scratch repository on which
  both verdicts approve. The pane and the watch tool's answer name the new
  step, and nothing merges. The owner's real configuration is never touched.

## Decided by the counsel

- When the user's own CLAUDE.md (in CLAUDE_CONFIG_DIR or ~/.claude) exists but cannot be read, and the base branch's CLAUDE.md has no Reviewer: line of its own, what should keep a reviewer named only in the user's file from being merged around? The counsel chose: The mod's look treats the reviewers as unknown and names no merge step until a look reads the file; the merge texts are unchanged. 5 of 7 members voted for it.
- While the user's own CLAUDE.md exists but cannot be read (and the base branch's CLAUDE.md has no Reviewer: line of its own), both verdicts approve and no other step applies, which step should the look name in place of a merge step? The counsel chose: A new step shaped like 'runs-unread': it names the file and says it could not be read, tells the session to merge nothing and end the turn, and sets no state label; the mod looks again at its next poll and starts a turn when the step changes, and the stuck prompt catches a file that stays unreadable. 7 of 7 members voted for it.
- Which failures to read the user's own CLAUDE.md count as a missing file (no Reviewer: line, merge as before), and which count as unreadable (reviewers unknown, no merge step)? The counsel chose: Missing only when $.fs.exists answers false for the path, or when no configuration folder can be worked out (CLAUDE_CONFIG_DIR relative, or HOME unset or not absolute), because then there is no file to read; every other failure, including a rejected read of a path that exists and an exists call that itself rejects, counts as unreadable. 4 of 7 members voted for it.
- What does this change deliberately leave out? The counsel chose: Only the user's-file side of the Reviewer: fact changes. Left out: the base branch's unreadable CLAUDE.md (the look may still name a merge there, and the merge texts' re-read stops it, as today); the merge texts themselves; any other fact read from the user's file; foreman's own reads of the configuration folder; and showing the read error's text, since the step names the file and says it could not be read. 7 of 7 members voted for it.
- How will we know the change works? The counsel chose: The gate tests of the first option, plus one live check: a real session with CLAUDE_CONFIG_DIR pointed at a scratch folder whose CLAUDE.md is made unreadable, watching an approved pull request in a scratch repository, to see the pane and the step name the new step and not merge. 4 of 7 members voted for it.
