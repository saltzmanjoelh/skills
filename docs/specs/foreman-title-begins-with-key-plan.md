# Plan: a foreman parent's sub session titles begin with the issue key

Date: 2026-10-21. Spec: `foreman-title-begins-with-key.md`.

## Chosen approach

The simplest plan won. The title check goes into `briefFor` in
`mods/foreman/hooks/tickets.ts`, the pure function that already decides
whether a `start_session` call is refused, passed on or given a ticket, so
the hook keeps a single decision and cannot apply the checks in the wrong
order. The check adds no state: each call is decided from its arguments and
from whether the session is the parent, which the hook already reads. So a
restart, a resumed or cleared session and a hot reload create no new edge
case.

- `hooks/wake.ts` exports the issue key's shape as a pattern string, `KEY`,
  and builds its own anchored `KEY_SHAPE` from it, so the wake line and the
  title check share one definition of a key.
- `hooks/tickets.ts` adds `NO_ISSUE` (`No issue: `), a title pattern built
  from `KEY` followed by a space or a colon, one refusal text,
  `TITLE_REFUSAL`, an optional `title` on the `add` kind of `Brief`, and a
  `log` field on the `deny` kind.
- `briefFor` refuses a forked start first, as today. Then, unless the call
  names a `proposal_id` and gives no title (an undefined or null title), it
  refuses a title that is not a string, a title that matches neither the key
  pattern nor the marker, and a marker title on a call with no brief. A call
  with no brief otherwise passes. A call with a brief gets the ticket line,
  and a marker title has the marker replaced by `<ticket>: `.
- `hooks/register.tsx` logs `brief.log` on a refusal and passes the rewritten
  title on with the rewritten prompt.
- The refusal text names both valid forms and says the marker needs a brief:
  `foreman: start sub sessions with a title that begins with the issue key
  followed by a space or a colon, such as "ABC-123: short name", or, for
  work with no issue, with "No issue: short name" and a brief, so that
  foreman and its wake skill can find the sub session by its title.`
- The README's Tickets section gains a paragraph on the rule, quoting the
  refusal, and its sentence about a call with no brief says the title is
  still checked.
- The wake skill's description adds the person's own requests to pick,
  start, restart or resume an issue. "Starting a session" opens with a
  paragraph saying it applies to every start, including one the person asked
  for in their own words, and that the mod refuses any other title. Step 2
  describes the marker, and says it works only on a start that carries a
  brief, so a title-only offer card cannot use it.

## Grafts from the most robust plan

- **The key pattern followed by a space or a colon**, built from a pattern
  string `wake.ts` exports, rather than matching the text before the first
  space against the anchored `KEY_SHAPE`. It states the rule directly and
  keeps one definition of a key.
- **A `log` field on a refusal**, so `register.tsx` never tells refusals apart
  by comparing their texts, which would break silently when a text changes.
- **A test over odd argument values** that shows `briefFor` never throws and
  never passes a title of the wrong shape, because the hook's `.catch` passes
  a call on unchanged when the hook throws, which would let a bad title
  through.
- **A test that a forked start with a bad title still gets the fork
  refusal**, which pins the order of the two checks.
- **A null title counts as no title**, matching the spec's "gives no title".
- **The existing test of an answer that is an error gets a valid title**, and
  asserts that the call reached the desktop app, so it does not pass for the
  wrong reason once untitled calls are refused.

## Rejected alternatives

- **A second refusal text for a marker with no brief.** The single text
  already says the marker needs a brief and names both valid forms; the
  second text named only the key form.
- **Several log lines that quote the refused title.** More text to clean and
  test for little gain; one log line per kind of refusal is enough.
- **Letting an `ft-` title pass when the brief already ends with that ticket**,
  for two copies of the mod running at once. The spec does not ask for it,
  two copies already add two ticket lines to every brief, and it would patch
  one symptom of a setup that is not supported. The pull request notes that
  two copies refuse every marker start.
- **Advice in the skill to keep the name after the marker short.** Extra; if
  the desktop app cuts a long title, the ticket at its start survives.

## Steps

1. Write the tests below and see them fail.
2. Change `wake.ts`, `tickets.ts` and `register.tsx`.
3. Update the existing tests that start sessions without a valid title.
4. Update the README and the wake skill.
5. Run the four gates.

## Test plan

Hook tests in `mods/foreman/tests/acts.test.ts`, in a parent:

- A title `ABC-7: short`, and `ABC-7 short`, reaches the desktop app
  unchanged and is paired.
- `Implement ABC-7: short`, `ABC-7`, `abc-7: x`, a call with no title and a
  title-only offer card titled `Implement ABC-7` are each refused with
  `TITLE_REFUSAL`; nothing starts, no pairing is written, and the log says
  why.
- `No issue: tidy` with a brief reaches the desktop app as
  `<the ticket in the brief>: tidy`, and the pairing holds that ticket.
- `No issue: tidy` with no brief is refused and starts nothing.
- A `proposal_id` call with no title passes unchanged; one with a bad title
  is refused.
- A forked start with a bad title gets the fork refusal.
- A session that is not the parent passes every one of these unchanged.

Pure tests in `mods/foreman/tests/tickets.test.ts`:

- Every edge case in the spec through `briefFor`, including `ABC-123-fix: x`
  refused and `No issue: ABC-12 cleanup` becoming `ft-u-1: ABC-12 cleanup`.
- The odd-values test: for titles, prompts, proposal ids and contexts drawn
  from `undefined`, `null`, `0`, `''`, `'  '`, `[]`, `{}` and a symbol,
  `briefFor` does not throw, and a pass or an add comes only with a title of
  the right shape or a `proposal_id` call with no title.

The four gates run last. No gate reads the wake skill or the README, so the
pull request says those are checked only by the reviewers.
