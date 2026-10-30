# Plan: the comment above `shownNow` says what it is for

Date: 2026-10-30. Spec: `docs/specs/foreman-shownnow-comment.md`.

## Chosen approach

Replace the two-line comment above `shownNow` in
`mods/foreman/hooks/register.tsx`, and change nothing else in the code. Two
planners competed, one aiming at the simplest wording and one at the most
robust, and a judge picked the simplest one with the robust one's sentence
structure grafted in. The comment becomes:

```ts
// The rows that the open, nudge and release buttons act on, and that the
// count of busy slots reads when a slot is freed. They are the rows that own
// a ticket of this parent that was not freed. Each button looks up the row
// that was pressed in this result. The pane does not read this result:
// `view` works out the pane's rows on its own. These rows must stay the
// same as the rows the pane shows, because a button pressed on a row that
// the pane shows does nothing when this result lacks that row.
```

## Grafts

- From the robust plan: a sentence of its own saying that each button looks
  up the pressed row in this result. The simplest plan folded it into a
  phrase without a verb, which was hard to read the first time.
- From the simplest plan: the sentence defining the rows, which the old
  comment had and the robust plan dropped.

## Rejected alternatives

- The robust plan's sentence "Today both come from `shownRows` over the same
  rows and ledger". It is not exactly true, because `view` reads the ticket
  ledger only while foreman is on and shows no rows when it is off, while
  `shownNow` reads the ledger either way. "Today" would also go stale.
- Pointing back at `shownNow` from the comment on `view`. The spec allows
  only the comment above `shownNow` to change.
- Making `view` and `shownNow` share one function, or adding a test that
  their rows agree. Both are outside the spec.
- Capitalised button names. The pane draws the open button as an arrow with
  the pull request's words, not as "Open", so the comment names the buttons
  by what they do.

## Steps

1. Replace the comment.
2. Run the four gates.

## Test plan

The gates in the project's `CLAUDE.md` do not read what a comment says, so
the reviewers judge the wording against the spec's Verification section.
`git diff origin/main` must show only those comment lines in
`register.tsx`, besides the spec and this plan. There is no test to write
first, because no behaviour changes.
