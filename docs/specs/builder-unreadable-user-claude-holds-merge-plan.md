# Plan: an unreadable user CLAUDE.md holds the merge

Written 2026-11-05 for `docs/specs/builder-unreadable-user-claude-holds-merge.md`,
from a plan tournament of three planners (simplest thing, most robust, most
extensible) and a judge. The most robust plan won, with three ideas grafted in
from the others.

## Chosen approach

The look reads the user's CLAUDE.md into one of three outcomes: read, missing
or unreadable. A pure function in `step.ts` turns the base branch's CLAUDE.md
and that outcome into the reviewers plus whether they are unknown, using the
same rule about which `Reviewer:` line wins as `reviewersOf`. The look stores
`reviewersUnknown: true` on the base facts only when it applies.
`chooseStep` reads the mark straight from the snapshot's facts, never through
`factsOf`, because `factsOf` answers the unread facts whenever the base file
was not read and would drop the mark in the case where both files are
unreadable. The mark goes into the fingerprint and into the list of changes,
so a file that becomes readable starts a turn and says why.

## The state it keeps

One optional field on the stored facts, written fresh by every look and
written only when true. A snapshot stored before this change has no field and
counts as known, and its fingerprint is unchanged, so an upgrade starts no
turn. A restart, a resumed or cleared session and a hot reload all show the
stored mark until the next look reads the file again. Two copies running at
once each decide from their own reads; at worst a passing failure in one costs
one extra turn, and it never causes a merge.

## Steps

1. **The contract.** In `mods/builder/types/index.d.ts`, add
   `reviewersUnknown?: true` to `BaseFacts`, with a comment that says what it
   means and that a snapshot without it counts as known. Run the first gate
   again afterwards, so foreman's linked types see it.
2. **The pure rule.** In `mods/builder/hooks/step.ts`, add
   the exported type
   `UserClaude = { kind: 'read'; text: string } | { kind: 'missing' } | { kind: 'unreadable' }`
   and
   `reviewerFactOf(project: string | null, user: UserClaude): { reviewers: string[]; isUnknown: boolean }`,
   which switches on the kind. The kind is a tag of its own, so a file whose
   whole text is the word "unreadable" is still read as text.
   `isUnknown` is true when the user's file is unreadable and the project has
   no `Reviewer:` line, which is the same `factIn(project, 'Reviewer')` check
   `reviewersOf` makes. `reviewersOf` stays and keeps its callers.
3. **Reading the user's file.** In `mods/builder/hooks/register.tsx`,
   `readUserClaude` returns a `UserClaude`, which `readBaseFacts` passes to
   `reviewerFactOf` as it is, and it never throws. No workable configuration folder answers missing. A
   rejected `env.get` answers unreadable, because the spec's two missing cases
   are the only ones. `$.fs.exists` answering false answers missing, and a
   rejected `exists`, a rejected read, or a read that gives no string answers
   unreadable. `readBaseFacts` calls `reviewerFactOf`, and `withReviewers`
   keeps its name and gains an argument that adds `reviewersUnknown: true`
   in both of its branches.
4. **The step.** In `step.ts`, add the kind `{ kind: 'user-claude-unread' }`
   and, in `chooseStep`, return it right after the `awaiting-review` return
   and before `runs-unread`, when `s.facts?.reviewersUnknown === true`. It
   then holds `runs-unread`, waiting, `head-unchecked`, the merge and the
   question about merging without checks. `labelFor` gives null. The title
   is "Both verdicts approve at this head, but the user's own CLAUDE.md could
   not be read". The text has two lines in the shape of `runs-unread`: the
   first says that the CLAUDE.md in the user's Claude configuration folder
   exists but could not be read at the mod's last look, so the reviewers its
   `Reviewer:` line may name are unknown; the second says to merge nothing and
   end the turn, and that the mod looks again at its next poll and starts a
   turn once the file can be read. Neither line holds a path or error text.
   Update the comment that counts the outcomes where both verdicts approve.
   `mergeLines` does not change.
5. **Fingerprint and changes.** In `mods/builder/hooks/github.ts`,
   `fingerprintOf` pushes `reviewers-unknown` when the mark is set and the
   verdicts approve, under the same condition as `runs-unread`.
   `changesBetween` gains "The CLAUDE.md in the user's Claude configuration
   folder could not be read." and "The CLAUDE.md in the user's Claude
   configuration folder could be read again."
6. **Documents.** Rewrite the edge case near line 237 of
   `docs/specs/builder-waits-for-outside-reviewer.md` and point it to the new
   spec. In `mods/builder/README.md`, change the sentence near line 97, the
   `Reviewer:` row near line 226 and the step list. In
   `skills/implement/SKILL.md`, change the `Reviewer:` row near line 44 and
   the sentence near line 233.

## Test plan

Tests come first and must fail before the code makes them pass.

- **The test kit rejects an unanswered call.** An `env.get` or `fs.exists`
  that no hook answers rejects, and today `readUserClaude` hides that. About
  eleven register tests reach a merge step with no environment hook, so under
  this change they would name the new step. Add `mock.env(on, {})` to each of
  them, so their variables are unset, no configuration folder can be worked
  out, and the file is missing. It cannot go into the shared `engine()`
  helper, because the kit takes one hook per event and other tests register
  their own.
- **`fakeFiles`** gains two sets returned through `Object.assign`:
  `refusedReads`, whose paths exist but whose read is refused, and
  `refusedExists`, whose `exists` call is refused. `reviewerStep` takes a
  `user` of `string | null | 'unreadable' | 'exists-refused'` and can make
  the base file unreadable.
- **`mods/builder/tests/register.test.ts`**, through the watch tool:
  - an unreadable user file with no base `Reviewer:` line names the new step
    and holds no `gh pr merge`;
  - a rejected `exists` names the new step;
  - a missing user file, a relative `CLAUDE_CONFIG_DIR`, and no `HOME` merge
    as before;
  - base `Reviewer: ann` names the request step for ann, and base
    `Reviewer: none` merges, both with the user file unreadable;
  - an unreadable user file with an unreadable base file names the new step;
  - a requested outside reviewer names `awaiting-review` first, and after
    that reviewer approves the next look names the new step;
  - after the file becomes readable, the next look names the merge and its
    changes say the file could be read again.
- **`mods/builder/tests/step.test.ts`:** the order (outside steps, then the
  new step, then `runs-unread`), the new kind in the list of every step and in
  the label map with null, the title and the text and that the text holds no
  path, `reviewerFactOf`'s cases, and that a snapshot without the mark merges,
  including one with unread base facts.
- **`mods/builder/tests/github.test.ts`:** the fingerprint part appears only
  with the mark and approving verdicts, and the two change sentences.
- The four gates, then the live check the spec describes.

## Grafts

- From the most extensible plan: the test kit rejects an unanswered call, so
  the old merge tests need an environment hook to keep showing that a missing
  file merges. Without this, the change would look broken in a dozen tests
  that have nothing to do with it.
- From the most extensible plan: unit tests for the fingerprint and the change
  sentences in `github.test.ts`.
- From the simplest plan: the exact places in the documents, and keeping
  `withReviewers` under its name with one more argument.

## Rejected alternatives

- **Putting the step after `runs-unread`.** It is as safe, because
  `runs-unread` never merges, but the spec puts the new step in place of every
  later step where both verdicts approve, and `runs-unread` is one of them.
- **Counting a rejected `env.get` as missing.** It keeps old tests quiet, but
  the spec names exactly two missing cases and counts every other failure as
  unreadable.
- **Returning `false` for unreadable.** A third value beside text and null is
  harder to read than a tagged result.
- **Writing the unknown check out inline in two places.** The two copies of
  the rule about which line wins could drift apart.
- **An exported `ClaudeRead` type and a renamed `withReviewers`.** They build
  a seam for changes the spec leaves out.
- **No change sentences.** The turn that starts when the file becomes
  readable would then say only that the pull request changed.
- **A test that a damaged mark counts as known.** The spec says only that a
  snapshot without the mark counts as known, and a damaged mark that counted
  as known would lean toward merging.
