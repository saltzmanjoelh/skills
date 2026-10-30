# Plan: a carried-over review is not a verdict head

Written 2026-10-30 for `docs/specs/carried-over-verdict-head.md`, after a plan
tournament between a simplest, a most robust and a most extensible plan.

## Chosen approach

The simplest plan won. One exported regular expression in
`mods/builder/hooks/review.ts` recognises a carried-over review:

```ts
export const CARRIED_OVER = /^Both verdicts are carried over from /m
```

With the `m` flag, `^` matches at the start of the body and after every line
end, whether `\n`, `\r\n` or a lone `\r`. So an opening on any line counts,
including one under a heading, while an indented line, a bullet, a quoted
line and a phrase inside a sentence do not. The expression has no `g` flag,
so `test` keeps no state between calls.

- `verdictHeadOf` becomes
  `earlier.filter(round => round.sha !== head && !CARRIED_OVER.test(round.body)).at(-1)?.sha ?? null`.
  The sha that a carried-over review names is never read.
- `earlierLines`, for a later package, repeats in full the newest review at
  `since` that was not carried over (falling back to the newest review, as
  today) and every carried-over review after it that is not at the current
  head. Every other review stays one line, in list order.
- `readingLines` calls the verdict head "the newest head both verdict
  reviewers read".
- `packageShapeOf` in `register.tsx` needs no code change, because the
  ancestor and merge checks, the reviewed head, both `git diff` calls, the
  `Since:` line and `isUpForCheck` all take the verdict head from
  `verdictHeadOf`.

The change keeps no state. Every package call reads the reviews from GitHub
again, so a restart, a resumed or cleared session, a hot reload and two
copies running at once all reach the same verdict head.

## Grafts

- From the most robust plan: update the `package` tool's description in
  `register.tsx`, which still says the verdict head is the newest head with a
  verdict review and that only the newest earlier review is repeated in
  full. Without it the tool tells every session the old rule.
- From the most robust plan: a negative test for a quoted `> Both verdicts`
  line, because the spec names a quoted line as a case that must not count.
- From the most robust plan: a test body with CRLF line ends, which shows
  the `m` flag handles them at almost no cost.
- From the most extensible plan: the tests hold both openings that
  `skills/implement/SKILL.md` gives, copied word for word, because the spec
  names that test as the only guard against the wording drifting apart.
- From the judge: the sentence `earlierLines` writes into `package.md`, and
  the comments above `earlierLines`, its fallback and `verdictHeadOf`, all
  change to the new rule.

## Rejected alternatives

- Allowing spaces or tabs before the phrase. The spec says a line must begin
  with the phrase, and an indented line in Markdown is often a code block or
  a quoted example.
- A predicate function taking the whole review as a seam for a structured
  marker. The marker is a non-goal, and a regular expression is already a
  single place to change.
- Skipping carried-over reviews in `isUpForCheck`. The verdict head is now
  always the head of a review that was not carried over, and the spec only
  asks that the check move with the verdict head.
- A second fallback in `earlierLines` to any review at `since`. It cannot
  run, because `verdictHeadOf` picks `since` from the same reviews.
- A `carried` field on `EarlierRound`, set in `register.tsx`. It would split
  the definition across two files and change every test fixture.

## Steps

1. Write the three tests below and see them fail.
2. Change `review.ts`: the constant, `verdictHeadOf`, `readingLines`,
   `earlierLines` and their comments.
3. Change the `package` tool's description in `register.tsx`.
4. Change the definition and the full-repeat rule in
   `docs/specs/cheaper-review-rounds.md` and the review package paragraph
   in `mods/builder/README.md`.
5. Run the gates.

## Tests

1. `review.test.ts`: the verdict head skips a carried-over review after an
   approved one, for both openings from the skill, for a body with CRLF line
   ends, and for an opening under a heading. It does not skip a review whose
   bullet or quoted line holds the phrase. It gives no verdict head when
   every review at another head was carried over.
2. `review.test.ts`: a later package with reviews at `a`, the verdict head
   `b`, a carried-over review at `d` and a carried-over review at the head
   `c` repeats `b` and `d` in full and `a` and `c` as one line, and its
   reading line calls `b` the newest head both verdict reviewers read.
3. `register.test.ts`: through the package tool, with commits A, then D and
   C both with the cheap-fix subject, an approved review at A and a
   carried-over review at D, the tool runs `git diff` and the changed-file
   listing from A, writes `Since: A`, and does not say the head is up for the
   check after approval. Giving C the cheap-fix subject makes the last
   assertion fail on the code before the change.
