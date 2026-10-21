# Foreman parent: every sub session title begins with its issue key

Date: 2026-10-21. It changes the foreman mod's `start_session` hook
(`mods/foreman/hooks/tickets.ts` and `mods/foreman/hooks/register.tsx`), its
tests, its README, and its wake skill (`mods/foreman/skills/wake/SKILL.md`).

## Goal

Foreman and its wake skill find a sub session by the issue key at the start
of its title. In a parent session, the person typed "pick the next issue",
and the parent started a sub session titled "Implement <KEY>: …". When that
sub session later got stuck in cleanup, the parent's lookup by title could
not find it. The rule that a title begins with the key was already written
in the wake skill's "Starting a session" section, but the skill loads only on
lines that start with "foreman: ", so a request in the person's own words
never loaded it.

This change closes the gap in two layers. The wake skill also loads when the
person asks the parent to pick, start, restart or resume an issue. And the
mod itself refuses a start whose title is of the wrong shape, so the rule
holds on every device that has the mod, even when the model never loads the
skill.

## Users and trigger

A parent session, one that ran `/start-foreman`, when its model calls the
desktop app's `start_session` tool, whether a `foreman: ` line or the
person's own words asked for the start. A session that is not the parent is
untouched.

## Behavior

### The wake skill

- Its description says that it also applies when the person asks the parent
  session to pick, start, restart or resume an issue, in any words.
- Its body says, at the top of "Starting a session", that the section applies
  to every start the parent makes, including one the person asked for in
  their own words, and that the mod refuses a title of any other shape.
- "Starting a session" says how to start work that has no issue: a title
  that begins with `No issue: `, which the mod replaces with the ticket.

### The mod's title check

The check runs in the existing `start_session` hook, only while the session
is the parent, after the existing refusal of a forked start.

1. A call that names a `proposal_id` and gives no `title` passes unchanged,
   as it does today, because the proposal's title was checked when it was
   proposed.
2. Every other call needs a `title` that begins with an issue key followed by
   a space or a colon, such as `ABC-123: short name` or `ABC-123 short name`,
   or with the marker `No issue: `. An issue key is an upper-case letter,
   then upper-case letters or digits, a hyphen and digits, the same shape the
   wake skill and the mod's wake line already use. Anything else, a missing
   title included, is refused.
3. A title that begins with `No issue: ` on a call with a brief has the
   marker replaced by the ticket the mod issues for that call, so the title
   that reaches the desktop app begins `ft-<uuid>: `, which the wake skill's
   lookup by ticket matches. The rest of the title is kept as it was.
4. A title that begins with `No issue: ` on a call with no brief is refused,
   because no ticket is issued without a brief, so nothing could replace the
   marker.
5. A refusal answers the model with one line that starts `foreman: `, says
   what a valid title looks like (`ABC-123: short name`, or `No issue: short
   name` for work with no issue), and writes a line to foreman's log, as the
   refusal of a forked start does.

## Edge cases

- `Implement ABC-123: …`, the incident's title, is refused.
- `ABC-123` with nothing after it is refused, because the wake skill's lookup
  needs a space or a colon after the key.
- `abc-123: …` is refused, because the key is matched exactly, upper case.
- `ABC-123-fix: …` is refused, because a hyphen is neither a space nor a
  colon, so one key is never read as part of a longer word.
- `No issue: ABC-12 cleanup` becomes `ft-<uuid>: ABC-12 cleanup`; the marker
  wins, because it was typed on purpose.
- A `proposal_id` call that also gives a new title is checked like any other
  call.
- A start that the desktop app turns into a proposal card, with no session
  id yet, still gets the title rewrite, because the rewrite happens before
  the call goes on.

## Non-goals

- The mod does not check that the title's key is the issue the brief runs
  `/implement` on; that stays the parent's job, as the wake skill says.
- Titles of sub sessions started before this change are not renamed.
- A session that is not the parent is not checked.
- A proposal made before the session became the parent, and later started by
  its `proposal_id` alone, is not checked.
- The wake skill's archive work, which a separate change makes, is not part
  of this change.
- If the hook itself throws, the call goes on unchanged, as every foreman
  hook does today; the check is pure code so that it does not throw.

## Failure modes

- A refused start reaches the model as the refusal line, and the model starts
  again with a valid title. Nothing is started and no ticket is issued.
- When the desktop app refuses or fails the call after the rewrite, nothing
  changes from today: no ticket is paired.

## Verification

- Tests in `mods/foreman/tests/` show, through the hook in a parent: a title
  `ABC-7: short` passes with its title unchanged; `Implement ABC-7: short`,
  `ABC-7`, `abc-7: x`, a missing title and a title-only offer card with a bad
  title are refused with the refusal line and start nothing; `No issue: tidy`
  with a brief reaches the desktop app as `ft-<the ticket in the brief>:
  tidy`; `No issue: tidy` without a brief is refused; a `proposal_id` call
  with no title passes unchanged; and a session that is not the parent passes
  every one of these unchanged.
- Pure tests of the title function cover the edge cases above.
- The four gates pass. No gate reads the wake skill's text, so its change is
  checked only by the reviewers, and the pull request says so.

## Decided by the counsel

- While a session is the foreman parent, the mod will refuse a start_session call whose title does not begin with an issue key followed by a space or a colon. Should a start with no issue at all (work that only has foreman's ticket) be allowed, and if so how? The counsel chose: Allow it only through an explicit marker: a title that begins with the words "No issue: " passes, and the mod replaces that marker with the ticket it issues, so the title begins "ft-<ticket>: " and the wake skill's lookup by ticket can find it. 4 of 7 members voted for it.
- Which start_session calls in a foreman parent does the title check skip, and what happens to a "No issue: " title on a call that has no brief? The counsel chose: Skip only a call that starts an existing proposal by its proposal_id and gives no title, because that proposal's title was checked when it was proposed. Every other call needs a title that begins with an issue key followed by a space or colon, or with "No issue: ". A "No issue: " title on a call with no brief is refused, because no ticket is issued without a brief, so there is nothing to put in place of the marker. 7 of 7 members voted for it.
- Should the mod also check that the issue key at the start of the title is the same issue the brief runs /implement on, or does this change leave that out? The counsel chose: Leave it out and list it as a non-goal. The mod checks only the title's shape; whether the key names the right issue stays the parent's job, as the wake skill's "Starting a session" already says. 7 of 7 members voted for it.
