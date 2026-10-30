# Foreman: the comment above `shownNow` says what it is for

Date: 2026-10-30. This is a follow-up filed from the review of the change
that made builder count what its session spends and made foreman show it
(see `docs/specs/session-token-cost.md`).

## Goal

The comment above `shownNow` in `mods/foreman/hooks/register.tsx` says the
function gives "the rows the band and the pane show". That stopped being true
when the pane began working out its own rows, in `view`. `shownNow` is now
read only by the open, nudge and release buttons, which look up the clicked
row in its result, and by the count of busy slots when a slot is freed. A
maintainer who trusts the comment could change the pane's rows and not
`shownNow`'s, and a button pressed on a row the pane shows would then
silently do nothing, with no test to catch it. This change rewords the
comment so that it says what `shownNow` is for and that its rows must stay
the same as the rows the pane shows.

## Users and trigger

A maintainer reading or changing foreman's buttons or the pane's rows.

## Behavior

1. The comment says that `shownNow` gives the rows that the open, nudge and
   release buttons act on, and that the count of busy slots reads.
2. The comment says that these rows must stay the same as the rows the band
   and the pane show, which `view` works out on its own, because a button
   pressed on a row either of them shows does nothing when `shownNow` lacks
   that row. The band's chips are open buttons too.

## Edge cases

None. The change touches one comment.

## Non-goals

- No code changes. Making `view` and `shownNow` share one function, so the
  two lists cannot drift apart, is a refactor the issue did not ask for.
- No test that the two lists agree. The issue asks only for the comment.
- No other follow-up from that review.

## Failure modes

None at run time, because no code changes. The only failure is a comment that
is still wrong or unclear, which the reviewers judge.

## Verification

- `git diff` against the base shows only the comment lines above `shownNow`
  changed in `mods/foreman/hooks/register.tsx`, beside this spec and its
  plan.
- The new comment names the open, nudge and release buttons, the busy slot
  count, and the rule that the rows must match the pane's.
- The four gates in the project's `CLAUDE.md` pass.
