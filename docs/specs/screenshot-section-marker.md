# The screenshot rules key on a marker that /implement writes

Date: 2026-11-07.

## Goal

The screenshot rules of `/implement` apply to any open pull request whose
body has a `## Screenshots` section, unless the base branch's `CLAUDE.md`
says `Frontend paths: none` (see `implement-frontend-by-default.md`, point
4). Some projects have a pull request body template, or body rules in their
`CLAUDE.md`, that always carry that heading. In such a project with no
`Frontend paths:` line, every plain pull request is handled as frontend: each
later commit gets the frontend check, commits carry misleading
"Screenshots not retaken: never captured" lines, and the section is
rewritten. The rules should apply only to a section that `/implement` wrote,
which a hidden marker tells apart from a heading that someone else put
there.

## Users/Trigger

A session running `/implement` opens a frontend pull request in step 7,
either through `/storypr` or through the fallback when `/storypr` returns a
reason. Later the same session, or a resumed or compacted one, commits,
pushes, resumes, compacts or merges on a pull request, and has to decide
whether the screenshot rules apply. The project may have a template or body
rules that put their own `## Screenshots` heading into the body.

## Behavior

1. **The marker.** The marker is the HTML comment
   `<!-- implement:screenshots -->`, alone on its line. GitHub does not
   render it, so the body reads as it does today.
2. **Who writes it.** `/storypr` writes it only in its section **When
   another skill calls it**, at point 3, on the line directly under the
   `## Screenshots` heading of the body file. Point 3 says so itself, rather
   than step 4's layout, so a person's direct run of `/storypr` writes no
   marker. The fallback in `frontend.md` writes it on the line directly under
   the heading of the section it ends the body with.
3. **The marked section.** A `## Screenshots` section runs from its heading
   line to the next line that begins `## ` or `# `, or to the end of the
   body. It is marked when the marker line appears anywhere inside it, not
   only directly under the heading. A pull request is frontend, for every
   screenshot rule, when its body has at least one marked section and
   the base branch's `CLAUDE.md` does not say `Frontend paths: none`. A
   `## Screenshots` section without the marker is never read, rewritten or
   counted, whatever it holds.
4. **Every condition keys on the marked section.** Each place that today
   says "a pull request whose body has a `## Screenshots` section" says
   instead that the body has a `## Screenshots` section holding the marker:
   SKILL.md's "When a turn ends", the paragraph **Screenshots on a frontend
   pull request** under "A review round", "Resuming" and "After a
   compaction"; `frontend.md`'s opening and its section **Screenshots on a
   frontend pull request**; and the builder mod's merge bullet.
5. **The rewrite.** Bringing the section up to date rewrites only the marked
   section, keeps the marker line in it, and leaves every other
   `## Screenshots` section and every other line as they are.
6. **Two marked sections.** When more than one `## Screenshots` section holds
   the marker, the body is unclear. The pull request still counts as
   frontend, so the check of each commit and the retakes go on, but the
   session rewrites no section and tells the person in one sentence that two
   sections carry the marker and that it left the body alone.
7. **The mod pins the marker.** `mods/builder/hooks/step.ts` exports the
   marker as a constant beside `FRONTEND_FILE` and `FRONTEND_SECTIONS`, and
   builds the merge bullet from it. A test asserts that both merge texts'
   frontend bullet holds the constant word for word and no longer describes
   a body that merely has a `## Screenshots` section.
8. **An editor's note.** `frontend.md`'s opening note for editors names the
   constant and lists every file that writes or reads the marker:
   `skills/storypr/SKILL.md`, `skills/implement/SKILL.md`,
   `skills/implement/frontend.md` and `mods/builder/hooks/step.ts`.

## Edge cases

- A template's heading with no marker, in a plain pull request: no rule
  applies, which is the fix.
- A template's heading and `/implement`'s marked section in the same body:
  only the marked section is read and rewritten.
- A person adds a line between the heading and the marker, or the rewrite
  adds one there: the section is still marked.
- A person deletes the marker: the pull request is handled as plain from the
  next turn on, and its image links stay pinned to the commits they name.
  Putting the marker back restores the rules.
- A frontend pull request opened before this change has no marker, and is
  handled as plain from the next turn on.
- A line inside a fenced code block that begins `## ` ends the section early.
  That can only make the section smaller, and the writers put the marker
  directly under the heading, so the marker is never cut off by it.

## Non-goals

- A person's direct run of `/storypr`, its step 4, writes no marker, so a
  pull request a person opened that way and later handed to
  `/implement --resume` gets no screenshot rules.
- No migration of pull requests already open, and no second sign of a
  frontend pull request, such as the commits' `Screenshots:` lines.
- No change to the heading text `## Screenshots`.
- No reading of GitHub's pull request template file.
- No test that reads `skills/`, because the plugin test runner refuses files
  outside the mod's folder; the skill files are checked by the reviewers.
- No sentence in `README.md`, which never described the old condition.

## Failure modes

- A copy of the marker that differs by one character in a skill file makes
  new frontend pull requests plain, silently. The mod's test guards only the
  bullet, and the editor's note and the reviewers guard the skill files.
- Two marked sections hold the rewrite back, and the person is told.
- A missing marker drops the screenshot upkeep but never corrupts the body,
  because nothing without the marker is rewritten.

## Verification

The gates read only the builder mod's test; the skill changes are checked by
reading the diff.

- The test in `mods/builder/tests/register.test.ts` asserts that both merge
  texts' frontend bullet holds the exported constant, and a test asserts the
  constant's exact text, and the gates pass.
- `grep -rn 'implement:screenshots' skills mods/builder/hooks` lists the
  marker in `storypr/SKILL.md` point 3, in `frontend.md`'s fallback, opening
  note and screenshot section, in the four places of `implement/SKILL.md`,
  and in `step.ts`, and nowhere in `storypr`'s step 4.
- `grep -rn 'body has a .## Screenshots. section' skills mods/builder/hooks`
  prints only lines that also name the marker.
- `frontend.md` defines the section boundary, the rewrite keeps the marker
  and touches only the marked section, and two marked sections hold the
  rewrite and tell the person.
- No added line names a project, client, product, person or issue number.

## Decided by the counsel

- What marker should /storypr (when another skill calls it) and the fallback in skills/implement/frontend.md write, so that the screenshot rules can tell a Screenshots section that /implement wrote apart from a `## Screenshots` heading that a project's pull request template or body rules put there? The counsel chose: The same HTML comment, but the rules apply when it appears anywhere inside the `## Screenshots` section, not only directly under the heading. 7 of 7 members voted for it.
- A pull request that /implement opened as frontend before this change has a `## Screenshots` section but no `<!-- implement:screenshots -->` marker. How should the screenshot rules treat such a pull request once the marker becomes the condition? The counsel chose: Strictly: no marker means no screenshot rules. Such a pull request is handled as a plain one from the next turn on; its image links stay pinned to the commits they name. Nothing else counts as a sign of a frontend pull request. 4 of 7 members voted for it.
- A body can hold two `## Screenshots` sections: one from the project's own body rules or template, and the one /implement wrote with the `<!-- implement:screenshots -->` marker. Which section do the screenshot rules read and rewrite, and what bounds a section? The counsel chose: The same, but when the marker sits in more than one `## Screenshots` section, the rules treat the body as unclear: they rewrite nothing, and the session tells the person in one sentence. 7 of 7 members voted for it.
- The marker text `<!-- implement:screenshots -->` will appear in skills/storypr/SKILL.md, skills/implement/frontend.md, skills/implement/SKILL.md and the builder mod's merge bullet in mods/builder/hooks/step.ts. No gate reads skills/. How should the change guard against the copies drifting apart? The counsel chose: The mod pins the constant and builds the bullet from it, and its test checks only the bullet text; the skill files are checked by the reviewers, as today, with a note in frontend.md naming the constant. 7 of 7 members voted for it.
- What is the scope of this change, and what does it deliberately leave out? The counsel chose: Scope: the marker is written by /storypr only in its section "When another skill calls it" (point 3, the body file) and by the fallback in frontend.md; every condition that today keys on the `## Screenshots` section keys on the marked section instead (SKILL.md's When a turn ends, A review round, Resuming, After a compaction; frontend.md's opening and its section Screenshots on a frontend pull request; the builder mod's merge bullet, built from a pinned constant); frontend.md defines the section boundary, keeps the marker on every rewrite, and handles two marked sections. Non-goals: a person's direct /storypr run (its step 4) writes no marker; no migration of open pull requests; no change to the heading text; no reading of GitHub's pull request template file; no test that reads skills/. 6 of 7 members voted for it.
