# Plan: foreman wakes the parent for pull request milestones

Written 2026-10-21 for `docs/specs/foreman-wakes-for-milestones.md`. Three
planners competed, one for the simplest change, one for the most robust and
one for the most extensible, and a judge compared them. The simplest plan
won, with grafts from the other two.

## Chosen approach

Builder copies the verdict pair its snapshot already holds at the current
head into the status record's `pr.verdicts`. Foreman's reader keeps the pair
only when it is well formed. Each pairing's acts gain `announced`, the
milestones told to the parent, and a new `milestoneRule` in
`mods/foreman/hooks/act.ts`, beside the other rules, compares the record's
pull request with that memory and answers the reasons to wake. Four new
reason kinds in `mods/foreman/hooks/wake.ts` carry the four sentences. The
idle rule returns early for a closed pull request. The "Noted." text, the
wake skill and the README change to match. No new file and no new
dependency.

## Files and changes

### Builder

- `mods/builder/types/index.d.ts`: `BuildStatus['pr']` gains
  `verdicts: Verdicts | null`, with a comment saying it is the newest
  verdict pair at the current head with the head's full commit id, or null,
  and that no review text is written. `version` stays `1`.
- `mods/builder/hooks/status.ts`: `recordOf` writes
  `verdicts: s.verdicts !== null && s.verdicts.sha === s.head ? { sha, spec, adversarial } : null`,
  copied field by field in that order so the compared text stays stable.
  The head check makes the copy true even for a snapshot an older build
  stored.
- `docs/specs/builder-status-file.md` and `mods/builder/README.md`: the
  `pr` row lists `verdicts`.

### Foreman

- `mods/foreman/hooks/record.ts`:
  - `verdictsIn(raw)` answers `{ sha, spec, adversarial }` only when `raw`
    is an object, `sha` matches `/^[0-9a-f]{7,40}$/` and both verdicts are
    `APPROVE` or `REQUEST_CHANGES`; otherwise null. `pullRequestIn` adds
    `verdicts: verdictsIn(p.verdicts)`. `RecordPullRequest` derives from
    `BuildStatus['pr']`, so the type check asks for it.
  - `prStateOf(pr)` answers `OPEN`, `MERGED` or `CLOSED` from the state
    text, ignoring case, and null for anything else, such as the reader's
    `unknown`.
- `mods/foreman/types/index.d.ts`: `ForemanActs` gains
  `announced: { number: number | null; state: 'OPEN' | 'MERGED' | 'CLOSED' | null; verdicts: { sha; spec; adversarial } | null } | null`,
  spelled out because the contract stands alone. Null marks a pairing stored
  before this change, which takes its next read as already announced.
- `mods/foreman/hooks/tickets.ts`: `ACTS_FRESH.announced` is the all-null
  object, so `newPairing` starts with nothing announced. `actsIn` reads a
  missing `acts` as `ACTS_FRESH` with `announced: null`, and a present
  `acts` through `announcedIn`, which answers null unless every field
  parses: a positive whole number or null, one of the three states or null,
  and a pair that `verdictsIn` keeps or null.
- `mods/foreman/hooks/wake.ts`: `Reason` gains `opened`, `verdicts`,
  `merged` and `closed`, each with `who` and `number`, and the pair's fields
  for `verdicts`. `REASON_WORDS` gains the four sentences of the spec;
  `sha` is cut to seven characters only in the sentence. `quotesText` is
  unchanged, so no data note.
- `mods/foreman/hooks/act.ts`:
  - `milestoneRule(s)` answers the reasons. With `announced` null it records
    the baseline from the record (all null when the record has no pull
    request) and answers none. With no pull request it changes nothing.
    Otherwise, in order: a new number gives `opened` and resets the memory
    to that number alone; a pair at a new sha gives `verdicts` and is
    recorded, unless both approve and the announced pair also had both
    approving, which records nothing; a state from `prStateOf` that is not
    null and differs from the announced one is recorded and gives `merged`
    or `closed` for those two.
  - `decide` runs it right after the step is built and before the state
    rule, and pushes its reasons after the state rule and the gone rule, so
    slot-free stays last.
  - `idleRule` begins by clearing the stretch and returning when
    `prStateOf` says `CLOSED`.
  - `mayBeGone` keeps its own test unchanged.
- `mods/foreman/hooks/notes.ts`: `NOTED` becomes the spec's text.
- `mods/foreman/skills/wake/SKILL.md`: four sections headed with the
  sentences, each asking the parent to tell the person the fact in one line,
  naming the issue, and to do nothing else, such as looking the pull request
  up or messaging the sub session. The verdict section says what `<sha7>`
  and `<word>` are. The milestone bullet in "When the parent speaks" names a
  foreman line. The rule for a note or message keeps "Noted." except for a
  question and for the streak or limit line that the list names.
- `mods/foreman/README.md`: the four sentences in the list, the idle
  exception for a closed pull request, and the "Noted." paragraph without
  its milestone exception.

## Grafts

- From the extensible plan, `prStateOf`, so that an unknown or missing state
  changes nothing. Without it, a merged, then unknown, then merged record
  announces the merge twice.
- From the robust plan, the whole-object rule for `announcedIn`, so that a
  damaged memory gives silence rather than repeated announcements.
- From the robust plan, the head check in builder's copy.
- From the extensible plan, the ordering tests.
- From the robust plan, the skill's wording that the parent does nothing
  but tell the person.
- From the robust plan, an end-to-end test that the baseline is stored and
  survives a reload.

## Rejected alternatives

- The robust plan's stale-write guard, which remembered the write time of
  the record that last changed the memory and skipped older records. Each
  status file has one writer, the guard adds failure modes for a missing
  write time, a clock that steps back and a cap on future times, and the
  spec does not ask for it.
- The robust plan's rule that a merge is final. GitHub never reopens a
  merged pull request, and the rule risks swallowing a second pull
  request's close if the reset for a new number runs in the wrong order.
- A compile-time check that foreman's verdict shape matches builder's.
  Foreman's record type derives from builder's, so the type check already
  catches a mismatch where it matters.
- The extensible plan's separate module with an ordered list of step
  functions. Three milestones do not need it, and the spec's non-goals rule
  out more.
- A builder-side check of the verdict words. Foreman's reader is the
  boundary the spec names, and builder's own parser already allows only the
  two words.
- A log line for each baseline taken. Nothing asks for it.

## Step sequence

Each step writes its tests first and sees them fail.

1. Builder: tests in `mods/builder/tests/status.test.ts` that `recordOf`
   copies the head's pair, writes null without one, and writes null for a
   pair whose sha is not the head. Then the type, `recordOf` and the docs.
2. Foreman reader: tests in `mods/foreman/tests/record.test.ts` for
   `verdictsIn` and `prStateOf`. Then the code, and the existing whole
   record expectations gain `verdicts: null`.
3. Ledger: tests in `mods/foreman/tests/tickets.test.ts` that a new pairing
   has the all-null memory, that a missing field, missing acts and a
   malformed memory read as null, and that a good one round-trips. Then the
   type, `ACTS_FRESH` and `announcedIn`.
4. Sentences: tests in `mods/foreman/tests/wake.test.ts` pinning the four
   sentences, both verdict words, a ticket-named sub session, and no data
   note. Then the reason kinds.
5. Decisions: tests in `mods/foreman/tests/act.test.ts` for every case in
   the spec's Verification and Edge cases, the unknown state between two
   merges, the baseline pairing against a new one, the order of sentences
   against the state, gone and slot-free ones, and released and unowned
   pairings. Then `milestoneRule` and its place in `decide`.
6. Idle: tests that a closed pull request gets no nudge and no wake past
   three thresholds, that an open one still does, and that a reopen counts
   again. Then the guard.
7. Existing fixtures that now gain an opened sentence are updated, each
   checked to be expected.
8. End to end in `mods/foreman/tests/acts.test.ts`: a pull request opening
   wakes once, and a stored pairing from before the change stays silent and
   holds its baseline after a reload.
9. Notes: the pinned text in `mods/foreman/tests/notes.test.ts`, then
   `NOTED`.
10. The skill and the README.
11. The four gates.

## Known gaps for the pull request description

- The fixed "Noted." line names only the question exception, so a streak or
  limit line that reaches the parent with it relies on the wake skill's
  rule, as it did before this change.
