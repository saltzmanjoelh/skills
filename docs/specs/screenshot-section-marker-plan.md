# Plan: the screenshot rules key on a marker that /implement writes

Spec: `screenshot-section-marker.md`. Date: 2026-11-06.

## Chosen approach

Three planners wrote plans from different priors: the simplest change, the
most robust change and the most extensible change. A judge scored them
against the spec, and the simplest plan won. The robust and extensible plans
each supplied a few ideas that are grafted in below.

The marker is defined once, in prose, in the first paragraph of the section
**Screenshots on a frontend pull request** of `skills/implement/frontend.md`.
That paragraph says where a `## Screenshots` section starts and ends, when it
is marked, when a pull request counts as frontend, that an unmarked section is
never read, rewritten or counted, and what happens when two sections are
marked. Every other place states the condition in one sentence that quotes
the marker word for word and points at that section.

The condition is worded everywhere as "whose body holds the marker
`<!-- implement:screenshots -->` inside a `## Screenshots` section". This
wording never contains the old phrase "body has a `## Screenshots` section",
so the spec's second grep prints no line, in the skills or in `step.ts`.

The builder mod exports the marker as `SCREENSHOTS_MARKER` beside
`FRONTEND_FILE` and `FRONTEND_SECTIONS`, and builds the merge bullet from it.
The mod keeps no new state. The only state is the marker line in the pull
request body on GitHub, which is read again at every moment that a rule needs
it.

## Grafts from the runners-up

1. **Each condition sits on one physical line** (from the robust plan). The
   spec's grep reads one line at a time, and two of the four places in
   `skills/implement/SKILL.md` ("When a turn ends" and the paragraph under
   "A review round") already wrap the old phrase across two lines, so the grep
   cannot see them today. Every rewritten condition keeps "holds the marker
   `<!-- implement:screenshots -->` inside a `## Screenshots` section" on one
   line, and Verification adds a search across line breaks.
2. **A check that `/storypr`'s step 4 holds no marker** (from the robust
   plan), with an `awk` range over that step.
3. **Write the marker without the backticks** (from the robust plan). The
   skill text shows the marker as inline code. A body that carried the
   backticks would show the marker to readers and would not match, which
   silently makes the pull request plain. `/storypr`'s point 3 and the
   fallback both say to write the line without them.
4. **Read the body fresh** (from the robust plan). The single definition says
   that the body is read with `gh pr view <n> --json body --jq .body` at each
   moment it is needed, never taken from memory or from a compaction summary.
5. **A skill that starts writing or reading the marker joins the list** (from
   the extensible plan). The constant's comment and the editor's note in
   `frontend.md` both say so.
6. **The register test imports the constant as a value**, and the old
   closing sentence of the bullet is replaced in its list of expected parts.
   All three plans missed this.
7. **A manual check that HTML comments survive.** After the edits, load the
   `implement` and `storypr` skills with the Skill tool and look at a merge
   step's text, and confirm the marker is still visible in each.

## Rejected alternatives

- **A third writer in "A frontend change"**, which would add the marker to
  the body that `/storypr` returned when it is missing. The spec names exactly
  two writers. A third copy has to be kept in step with the others, and it
  would hide a fault in `/storypr` that the person ought to see.
- **"Never add, move or copy the marker"** as a rule. Nothing in the spec
  needs it, and it contradicted the third writer that came with it.
- **Tolerance for trailing spaces and carriage returns.** The body is read by
  a model, not split into lines by code, so the rule protects almost nothing,
  and it invites a rewrite that changes line endings the spec says to leave as
  they are.
- **A stricter heading rule**, that the heading must read `## Screenshots` and
  nothing else and that `### ` does not end a section. The second half already
  follows from the boundary, and the first half narrows the spec for no case
  the writers can produce.
- **A test over every step text** that requires the constant wherever
  `## Screenshots` appears. Every text it would read carries the same fixed
  merge bullet that the register test already checks, and its minimum count
  ties it to how many merge cases the step list happens to hold.
- **Restating the section boundary in the merge bullet.** It would be a
  second definition, worded differently from the one in `frontend.md`, which
  is the drift the spec tries to prevent.
- **Keeping the old phrase in the bullet** and arguing that the constant's
  name counts as naming the marker. Changing the words removes the question.

## Steps

1. **Tests first.** Add the constant to `step.ts` with the bullet unchanged,
   so the test files load. Then:
   - in `mods/builder/tests/step.test.ts`, beside the pin test for
     `frontend.md`, add "the screenshot marker is pinned word for word", which
     asserts that `SCREENSHOTS_MARKER` is `'<!-- implement:screenshots -->'`;
   - in `mods/builder/tests/register.test.ts`, change the import to
     `import { SCREENSHOTS_MARKER, type UserClaude } from '../hooks/step'`. In
     the merge-bullet test, expect the backticked constant, the text
     "inside a `## Screenshots` section", and the new closing sentence, and
     expect the bullet not to contain "whose body has a `## Screenshots`
     section" or "A pull request whose body has no such section skips this
     bullet.".
   Run the tests and see the register test fail for both merge texts.
2. **The mod.** Rebuild the bullet in `mergeLines` from the constant:
   "On a frontend pull request, one whose body holds the marker
   `` `<marker>` `` inside a `## Screenshots` section and whose fetched base
   branch's CLAUDE.md does not say `Frontend paths: none` … bring the marked
   section up to date as that section says … A pull request whose body holds
   no `## Screenshots` section with that marker skips this bullet, whatever
   other `## Screenshots` section it has." The constant's comment names the
   four files and says a new writer or reader joins the list. Run the tests
   and see them pass.
3. **`skills/storypr/SKILL.md`, point 3 of "When another skill calls it".**
   Add that, on the line directly under the body's `## Screenshots` heading,
   the skill writes the line `<!-- implement:screenshots -->` alone and
   without the backticks shown here, which tells the calling skill that this
   section is the one it keeps up to date, and that a person's direct run of
   the skill writes no such line. Step 4 stays as it is.
4. **`skills/implement/frontend.md`.**
   - The opening condition uses the new wording and points at the section
     below for what bounds a section.
   - The editor's note names `SCREENSHOTS_MARKER`, lists
     `skills/storypr/SKILL.md`, `skills/implement/SKILL.md`, this file and
     `mods/builder/hooks/step.ts`, says that a copy differing by one character
     makes new frontend pull requests plain without warning, and says that a
     skill that starts writing or reading the marker joins the list.
   - The fallback writes the marker, without backticks, on the line directly
     under its `## Screenshots` heading.
   - The first paragraph of **Screenshots on a frontend pull request**
     becomes the single definition: the boundary, the marked section, the
     frontend condition, the unmarked section, the fresh read with
     `gh pr view`, and the rule for two marked sections. The sentences about a
     plain body and about `Frontend paths: none` stay.
   - The rewrite brings "the marked section" up to date, rewrites only that
     section, keeps the marker line in it, and leaves every other
     `## Screenshots` section as it is. The read just before posting finds the
     marked sections in the fresh copy again, and posts nothing when there are
     none, or when there is more than one, in which case it tells the person
     as the definition says.
5. **`skills/implement/SKILL.md`, the four places.** "When a turn ends", the
   paragraph under "A review round" (including its "no such section"
   sentence), "Resuming" and "After a compaction" each take the new
   condition on one physical line.
6. **Gates and checks.** Run every gate in `CLAUDE.md`, then the checks
   below.

## Test plan, mapped to the spec's Verification section

- **The mod's tests.** The pin test and the edited register test, written
  first and seen failing, then passing in the gates.
- **Where the marker appears.**
  `grep -rn 'implement:screenshots' skills mods/builder/hooks` lists
  `storypr/SKILL.md` point 3, `frontend.md`'s opening, note, fallback and
  screenshot section, the four places of `implement/SKILL.md`, and the
  constant in `step.ts`. The command
  `awk '/^### 4\./,/^### 5\./' skills/storypr/SKILL.md | grep -c 'implement:screenshots'`
  prints 0.
- **The old condition is gone.**
  `grep -rn 'body has a .## Screenshots. section' skills mods/builder/hooks`
  prints nothing, and so does
  `perl -0777 -ne 'print "$ARGV\n" if /body\s+has\s+a\s+`##\s+Screenshots`\s+section/' $(git ls-files skills mods/builder/hooks)`,
  which also sees a phrase split across lines.
- **No drifted copy.**
  `grep -rhoE '<!-- ?implement[^>]*-->' skills mods/builder/hooks | sort | uniq -c`
  shows one distinct string.
- **The rules in `frontend.md`.** Reading the diff shows the boundary, the
  rewrite that keeps the marker and touches only the marked section, and the
  rule that two marked sections hold the rewrite and tell the person.
- **The loaded text.** The manual check in graft 7.
- **No names.** The staged-diff search from `.claude/rules/no-project-names.md`.

No gate reads `skills/`, so the report on this change says that the skill
files were checked only by these commands and by the reviewers.
