# Plan: the `Frontend paths: none` bullet skips only the frontend `git diff`

Date: 2026-11-07. Spec: `implement-frontend-none-skips-only-the-diff.md`.

## Chosen approach

Two planners worked blind, one for the simplest change and one for the most
robust, and a judge compared them. Both proposed the same text edits, so the
simplest plan won as the base, with three checks taken from the robust one.

Only `skills/implement/SKILL.md` changes, in one commit. Only the lines that
hold the changed sentences are rewrapped, so every other line of step 7 stays
byte for byte, and each phrase the spec's Verification section searches for
sits whole on one line.

The bullet's old lines 188 to 190 become these four lines, and the line after
them, which begins `` `CLAUDE.md` "says `Frontend paths: none`" ``, is
unchanged:

```
  from spaces, no change is frontend: skip the second read, which is the
  `git diff` command below, and open the pull request the plain way, as the
  paragraph that begins "Check the diff against the base" says.
  Everywhere in this skill and in `frontend.md`, the base branch's
```

The bullet gains a line, so the retry paragraph moves down by one. Its old
lines 234 to 238 become new lines 235 to 240, and the line after them, which
begins `` `AskUserQuestion`, in the form ``, is unchanged:

```
When a read that ran gives no answer, run `git fetch origin <base>` again,
whether or not the first fetch succeeded, and then
run the reads again, as the paragraphs above say, once, so the read that
failed is repeated with a fresh `CLAUDE.md`. This is the only retry in one
pass through step 7. When a read that ran still gives no answer, push
nothing and open no pull request. Ask the person with
```

The short line that ends "and then" is deliberate. It keeps "run the reads
again, as the paragraphs above say" whole on the next line.

The change keeps no state, so a restart, a resumed or cleared session, a hot
reload and two copies running at once raise no edge case. A session that read
step 7 before the merge keeps the old wording until it reads the skill again.

## Grafts from the robust plan

- Reread the passages that refer to step 7's retry and confirm that they still
  agree with the edits: lines 165 to 167 of the skill ("a failed read fetches
  again later", "only a read that fails counts"), the question at lines 1225
  and 1226 ("still gives no answer after a fetch and one more try"), and line
  22 of `skills/implement/frontend.md` ("after step 7's check gave no answer").
  A gap there would pass every gate.
- Run `git diff --check` for trailing spaces.
- Search that `paragraph that begins "Check the diff against the base" says.`
  now sits whole on line 190, so a session can find that paragraph by its
  opening words.

## Rejected alternatives

- Counting the pinned phrase "does not say `Frontend paths: none`" in
  `mods/builder/hooks/step.ts`. This change never touches that file, and the
  gates already run the test in `mods/builder/tests/register.test.ts` that pins
  it. The phrase that matters in the skill sits on the unchanged line after the
  bullet's edit, which the diff shows.
- Listing as risks the first read's fallback from `git show` to `git ls-tree`
  and the comma chain "as the paragraphs above say, once,". Lines 176 to 184
  already define the first read as a whole, and the comma chain is wording the
  counsel decided. Neither can lead to an edit within the spec, and listing
  them would invite a change outside it.
- Rewrapping whole paragraphs to even out the short lines. That would touch
  lines the spec leaves unchanged and make the diff harder to review.

## Steps

1. Make the two edits above in `skills/implement/SKILL.md`.
2. Run the searches, the width check, `git diff --check` and the reread of the
   passages that refer to the retry.
3. Commit the edits alone, after the issue-key search from
   `.claude/rules/no-project-names.md` finds nothing.
4. Run every gate.

## Test plan

- Before the edit, each of the four old-phrase searches prints one line, so a
  search that prints nothing afterwards shows a real change.
- After the edit, these print nothing:
  `grep -n "run no command below" skills/implement/SKILL.md`,
  `grep -n "When either read gives no answer" skills/implement/SKILL.md`,
  `grep -n "run both reads again" skills/implement/SKILL.md` and
  `grep -n "When a read still gives no answer" skills/implement/SKILL.md`.
- After the edit, each of these prints one line, at the line given:
  `skip the second read, which is the` at 188,
  `When a read that ran gives no answer` at 235,
  `run the reads again, as the paragraphs above say` at 237 and
  `When a read that ran still gives no answer` at 239.
- `awk 'NR>=187 && NR<=191 || NR>=235 && NR<=240 {print NR": "length}'
  skills/implement/SKILL.md` shows no line over 78 columns.
- The walk through the three cases in the spec's Verification section is read
  against the edited text, and the report says what step 7 tells the session
  in each.
- Every gate in the project's `CLAUDE.md` runs and passes. None of them reads
  `skills/`, so the report says that the gates did not read this change.
