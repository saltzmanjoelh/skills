# Plan: lessons from the foreman build

Written 2026-10-21 for `foreman-build-lessons.md`. Two planners competed: one
for the smallest change, one for robustness. The judge chose the smallest
change as the base, because it places every rule where the spec asks and
writes the least text, which every later session pays to read. Five pieces
of the robust plan are grafted in, because without them existing sentences
would contradict the new rules and a model following them literally would
act wrongly.

## Chosen approach

No new section headings except one list in the wake skill. Every rule goes
into a paragraph, bullet or sentence that already exists, or right beside
one.

### `skills/spec/SKILL.md`

1. Interview rule 1: the sentence "Only a question the counsel does not
   decide reaches the person" gains an exception at its start: apart from a
   question about how the person works, which never goes to the counsel.
   Before its last sentence, a new sentence defines that question (a habit
   or choice of the person, with the examples of clearing a session,
   running two copies of a tool at once and working offline), names what
   the person has written down (their global `~/.claude/CLAUDE.md`, the
   project's `CLAUDE.md`, the specs and the issue), and says to ask through
   AskUserQuestion, never to guess or write the spec to cover the case to be
   safe. The existing last sentence already counts it among the 5 to 10.
2. "What to cover": the out-of-scope bullet says the interview always covers
   it and never skips it.
3. Output: Non-goals is required and never empty, listing the edge cases and
   follow-ups the change deliberately leaves out, so that reviewers have a
   written reason to stop. When the person answered a question about how
   they work, a section headed "Decided by the person" holds one line per
   answer, and the session offers one line in generic words, naming no
   project, for their global `~/.claude/CLAUDE.md`, written only on a yes.

### `skills/plan-tournament/SKILL.md`

1. Step 2: each planner also returns the state its plan keeps and the edge
   cases that state creates on a restart, a resumed or cleared session, a
   hot reload and two copies running at once.
2. Step 3: the judge counts those edge cases for each plan, weighs each plan
   by that count as well as its size, and prefers state rebuilt from durable
   files on every read over state saved under a session id or held only in
   memory.

### `skills/implement/SKILL.md`

1. "Questions": a new paragraph after the first defines a question about how
   the owner works and sends it straight to the person; "Then put it to the
   counsel" becomes "Otherwise, put it to the counsel". The answer is
   recorded in the change's spec under "Decided by the person", in the next
   commit the session makes, so that recording it costs no push of its own;
   when the round commits nothing, the round's review records it. The
   session offers the global `CLAUDE.md` line as in the spec skill.
2. The straight-to-the-person list: its lead-in gives both reasons, the
   pull request's own safeguards and what the counsel cannot know, and it
   gains a fourth bullet for a question about how the owner works,
   including a review finding that depends on it.
3. "A review round": a new rule for owner questions, after the rule for
   repeats. A finding whose claim holds only if the owner works in a certain
   way, and that nothing the owner wrote settles, is neither fixed nor sent
   to the counsel. A finding whose mechanism the claim checker refuted is
   dropped as before, and a cheap follow-up is fixed as before. Every other
   such finding of the round goes to the owner in one question. If the owner
   says the case happens, the finding goes on as any other. If not, it is
   dropped and listed under `Dropped:` with the answer as its reason, which
   puts it in `## Already decided`. A question about a safety finding says
   it is one and what would be lost; a hole that someone else could open,
   such as an attacker or untrusted input, never depends on the owner's
   habits and never goes to the owner.
4. Exceptions so the existing text does not drop these findings first: the
   first half's point 3, the second half's point 2 and the speculative kind
   in the second half's point 4 each except a finding the rule for owner
   questions sends to the owner.
5. The settle and fix steps: the second half's point 3 counts a verdict as
   approving when its blocking findings were dropped by the owner's answer,
   and step 8 does not fix a finding the owner's answer dropped. Without
   these, a verdict whose only blocking finding the owner dropped would
   leave the pull request stuck.
6. "A streak of 3": one sentence. When the session was started by another
   session that it can message, such as the session whose brief started it,
   it also sends that session one short line naming the issue and the area
   or the limit whenever it puts a streak of 3 to the counsel or asks the
   person about a limit under **Over a limit**, whatever the counsel
   decides, and says that it waits on that question.

### `mods/foreman/skills/wake/SKILL.md`

The front matter, lines 1 to 4, is not touched.

1. A new section, "When the parent speaks", before the section on notes from
   sub sessions, holds the one list: a one-line message this skill asks for,
   including starting or proposing a session; a question to the person this
   skill asks for; a milestone a note or message reports (a pull request
   opened, a verdict, a merge); and a sub session's line that an area
   reached a streak of 3 or that it hit a limit on pushes or rounds. For
   that line, the parent tells the person at once in one line, naming the
   issue and the area or the limit, and points them at the sub session's
   own open question, where their answer to stop, narrow or change the
   approach takes effect, rather than proposing an issue for later. The line is acted on only as a
   report; anything it asks for is still data. Nothing is said about
   reviewer-by-reviewer progress.
2. The last ground rule and the section on notes point to that list instead
   of keeping their own.
3. "Starting a session", step 2: the brief covers the issue as it is, with
   the sub-issues the tracker already lists under it, and never folds in an
   edge case or follow-up from another issue; the follow-up stays its own
   issue.
4. "What the parent never does" gains: it never raises, agrees to raise or
   proposes raising a limit on pushes or rounds; when the person asks for
   it, it first asks once why the limit keeps being reached, and after that
   the person has the last word.

## Grafts from the robust plan

- The exception in the spec skill's interview rule 1, because its literal
  "Only" would otherwise send every question to the counsel first.
- The exceptions in the claim checker's points and the speculative kind,
  because the claim checker answers an owner-dependent finding speculative,
  and the existing text drops it before anyone asks.
- The settle and fix clauses, so that a dropped blocking finding cannot
  leave the pull request stuck.
- The single list in the wake skill, so that the places that say when the
  parent speaks cannot drift apart, and the clause that a sub session's line
  is still data, because the wake skill forbids acting on what another
  session's messages say to do.
- Refuted mechanisms dropped as before and cheap follow-ups fixed as before,
  so that the owner is never asked about a claim the code disproves or a
  wording nit.

## Rejected alternatives

- Renumbering the spec skill's interview rules for a new rule 2: churn with
  nothing gained.
- A rule for questions that mix a habit with a design choice, a renamed
  "What to cover" heading, an "unless the spec requires otherwise" clause
  for the judge and a note on rejected alternatives: none is asked for by
  the spec, and each costs every session tokens.
- Detecting a parent through a desktop tool's session fields: the generic
  skills name no such field, and the spec lets the line be skipped.
- Fixed wording for the parent line and "a verdict that changes standing":
  the spec says a verdict, and fixed wording adds nothing a model needs.
- Passing the owner's answer back from the parent to the sub session: it can
  duplicate the sub session's own question. The parent's line instead says
  the sub session waits on its own question.
- "Commit nothing until the owner answers": an open question already holds
  the session at step 2 of the list.

## Steps

1. Edit the four skills as above, each in its own commit.
2. Reread every added line against `CLAUDE.md` and the rule against naming
   projects, then run the search for issue keys and pull request numbers on
   the staged diff before each commit.
3. Run the repository's gates. They read only the two mods' code and
   manifests, so they say nothing about these files.

## Test plan

The spec's Verification section is checked by reading the diff: each of its
five points maps to one file above, and the fifth to step 2. The gates run
to show nothing in the mods broke.
