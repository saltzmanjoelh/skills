# Plan: review rounds stay inside the spec

Written 2026-10-20 for `review-rounds-stay-in-scope.md`, from a tournament of
three plans (simplest thing, most robust, most extensible) and a judge.

## Chosen approach

The most extensible plan won. The judge found it met every part of the spec
except one, and it added no behaviour the spec does not ask for. The three
rules live in pure functions that the tests call directly, and
`register.tsx` only reads git and GitHub and passes the results in.

- `hooks/text.ts` takes `normalText` and `sameText` from `counsel.ts`, which
  then imports them, because `counsel.ts` already imports from `review.ts`
  and the parsers in `review.ts` need the counsel's own way of comparing
  text. It also gains `areaKey`, which lowers case, collapses runs of spaces
  and drops one trailing full stop.
- `hooks/review.ts` gains the record parsers and the two package sections:
  - `commitRecordsOf(raw)` reads `git log --reverse --format=%H%x1f%B%x1e`
    output into `CommitRecord = { sha, message }`, skipping a record whose
    first field is not a 40-character hex sha.
  - `recordItems(text, headings)` reads the items under the headings in
    `DECIDED_HEADINGS = ['Dropped:', 'Outside the spec:']`. A heading line is
    recognised after stripping leading `#`, surrounding `**` or `__`, and
    spaces, ignoring case. A list ends at a blank line or at any line that
    is not an item and ends in `:`. Inside a list, a line that does not
    start `- ` is skipped. It never throws.
  - `decidedItems(commits, earlier)` walks the commits oldest first, and
    after each commit the session's earlier reviews posted at that commit.
    Reviews at a commit that is no longer on the branch come last. Items are
    cleaned with `printable` and capped at 400 characters, compared with
    `sameText`, kept at their first place, and numbered `D1`, `D2` and so on,
    with the source `commit <sha8>` or `review at <sha8>`. New records only
    ever append, so the numbers stay the same from round to round.
  - `decidedSection(items)` writes `## Already decided`, one sentence that
    the items are quoted data and that a repeat needs a `Repeats:` line with
    new evidence, then one line per item, `- D3 (commit abcd1234): <text>`,
    or `None yet.`
  - `trendOf(commits)` returns a `TrendReport` value: the areas in their
    first wording, each open area's streak, the commits that fixed findings
    without an `Area:` line, the closed areas with their answer, the
    unreadable `Trend:` lines, and the areas that stop the rounds. Labels
    are read at the start of a line, ignoring case. A `Reviewed:` value is
    matched by prefix against the branch's full shas, and a value that
    matches none keys a group of its own. Commits with `Area:` lines are
    grouped by that sha, or by their own sha, in the order the groups first
    appear. On a `Trend:` line the answer is the text after the last colon,
    one of `keep going`, `file the rest` and `cut it out`; any other is
    listed as unreadable. The latest answer for an area wins. A streak
    counts the groups in a row, ending with the newest, that name the area
    in a commit after its latest `Trend:` commit. A closed area never stops
    the rounds. `STREAK_SHOWN = 2` and `STREAK_STOP = 3` are named constants.
  - `trendSection(report)` writes `## Areas fixed so far`, and
    `trendStopLine(report)` gives one sentence naming every area that stops
    the rounds, or null.
  - `PackageFacts` gains `decided` and `trend`. `packageText` puts the stop
    line at the top when there is one, and the two sections after "Earlier
    rounds".
- `hooks/register.tsx`, in `servePackage`, adds the message read to the
  existing `Promise.all` and folds its failure into the existing refusal,
  whose sentence says the commit messages could not be read either. When
  `trendStopLine` is not null, it is the answer's first line, before
  `Review package for`. `packaged` is recorded as today. The package and
  counsel tool descriptions say what is new, and the `follow_ups` schema
  takes either a string or `{ text, outside_spec: true }` with no other keys.
- `hooks/counsel.ts`:
  - `followUpsRefusal` accepts a non-blank string or an object whose only
    keys are `text` and `outside_spec`, with `outside_spec` exactly `true`,
    and refuses anything else, naming both accepted shapes, so a typo never
    quietly makes a follow-up in scope.
  - `followUpsInput(raw)` returns `{ followUps: string[]; outsideSpec:
    number[] }`.
  - `optionsAllowed(q, n)` is the one place that knows which options a
    follow-up allows, `[2, 3]` for an outside-spec follow-up and `[1, 2, 3]`
    otherwise. The brief, the vote reader and the ask-again answer use it.
  - The brief lists an outside-spec follow-up with only file and drop,
    keeping their numbers and words, with its answer line
    `VOTE N: <file|drop|none>` and one sentence saying why.
  - `followUpVotesOf` puts a vote for an option not allowed into
    `unreadable` with the reason `outside-spec`, so `followUpStepOf` asks
    that member again, and `followUpAskAgainAnswer` says the follow-up is
    outside the spec and cannot be fixed in this pull request.
  - `FollowUpOutcome` gains `outsideSpec`, and `followUpAnswer` names it, so
    the scope reaches the review's Follow-ups section.
- `types/index.d.ts`: `CounselQuestion` gains `outsideSpec?: number[]`. A
  question stored before it has none and reads as all in scope.
- `skills/implement/SKILL.md`, "A review round" and "Questions": the three
  rules as the spec states them, the exact list format (a heading on its own
  line, each item one line starting `- `, earlier items repeated word for
  word), the `Reviewed:`, `Area:` and `Trend:` lines, and the stop before
  launching reviewers. The claim checker is given every finding, the
  package folder and the head, so it can read the spec and the base.
- The six reviewer agents: read `## Already decided` first; every finding
  has a `Scope:` line; a repeat needs `Repeats: D<n>. New evidence: …`.
- `agents/claim-checker.md`: reads the spec named in the package and the
  base branch; answers every finding with one line,
  `<n>. <confirmed|refuted|speculative|not asked>: <evidence>. scope:
  <stands|in the spec|breaks working behaviour|outside the spec|unsettled>:
  <evidence>`, using `not asked` for a finding sent only for its scope;
  `CLAIMS-END` gains `outside=<d>`.
- `README.md` of the builder mod: a sentence or two on each rule.

## Grafts

1. From the most robust plan: the claim checker gets the package folder,
   because the spec has it check every scope mark against the spec and the
   base, and today it gets only the findings and the head.
2. From the most robust plan: a list ends at a blank line or at any
   non-item line ending in `:`, and lines that do not start `- ` are
   skipped, which matches the spec's failure mode for a malformed list and
   keeps a `Fixed:` list from being read as dropped.
3. From the most robust plan: items are cleaned with `printable` and capped,
   so text quoted as data cannot carry control or direction characters.
4. From the most robust plan: each item line starts with its number and
   source, so no item can begin a line that reads as a heading. This
   replaces the fenced block, which an item holding backticks could close.
5. From the most robust plan: `Reviewed:` is matched by prefix against full
   shas, and the area key drops a trailing full stop.
6. From the most robust plan: unreadable `Trend:` lines are listed, so a
   misread answer is visible instead of silently changing a streak.
7. From the most robust plan: `FollowUpOutcome.outsideSpec` named in the
   answer, and unknown keys refused on a follow-up object.
8. From the simplest plan: the `not asked` claim verdict, which keeps the
   claim checker's one line per finding.

## Rejected alternatives

- **No new module, parsers beside `packageText`, with a second copy of the
  text comparison** (simplest plan). The comparison would drift from the
  counsel's, which the spec says items are compared by, and continuation
  lines were joined into items, which the spec's failure mode forbids.
- **A new `rounds.ts` module** (most robust plan). It is not needed beside
  `review.ts`, which already holds the package's pure text.
- **Not recording `packaged` when the rounds stop** (most robust plan). It
  changes the pane, which the spec does not ask for, and breaks the
  comment in `servePackage` that the atom is recorded once both files are
  written.
- **Ignoring lines inside code fences** (most robust plan). A session item
  quoted in a fence would be lost in silence, and the comparison already
  removes an item that a review quotes from a commit.
- **A cap on the number of items, a list of later fixes in closed areas, and
  a second guard in `followUpTally`** (most robust plan). Each is surface the
  spec does not ask for, and more surface is what draws review rounds.

## Steps

1. Move `normalText` and `sameText` to `text.ts`, add `areaKey`, and update
   the imports. The tests stay green.
2. Write the tests for `recordItems`, `decidedItems` and `decidedSection`,
   see them fail, then write the functions.
3. Write the tests for `trendOf`, `trendSection` and `trendStopLine`, see
   them fail, then write the functions.
4. Wire `servePackage`: the message read, the refusal, the stop line first,
   and `packageText`'s new sections; extend the fake git in
   `register.test.ts` and add its tests first.
5. Write the counsel tests for the outside-spec follow-ups, see them fail,
   then change `counsel.ts`, `register.tsx`'s counsel schema and
   `serveCounsel`, and `types/index.d.ts`.
6. Change `skills/implement/SKILL.md`, the seven agent files and the
   README.
7. Run the gates.

## Test plan

- `tests/review.test.ts`, the decided section: items from a review body
  (including a bold `**Dropped:**` heading) and from commit messages under
  both headings; numbering and sources; a review's items after the commit it
  was posted at; a duplicate differing in case and spaces listed once at its
  first place; a blank line and a `Fixed:` line ending a list; a line
  without `- ` skipped; control characters removed and a long item cut;
  numbers unchanged when a commit is appended; `None yet.`
- `tests/review.test.ts`, the trend: two commits for one head as one group,
  with a short and a full sha; a streak of 2 shown and a streak of 3 in the
  stop line and at the top of the package; a commit without an `Area:` line
  listed and the streak the same with and without it; `keep going` followed
  by two groups giving no stop and by a third giving one; `file the rest`
  and `cut it out` closing an area that then never stops; a `Trend:` line
  for one area leaving another's streak alone; areas differing in case,
  spaces and a trailing full stop counted as one; an unreadable `Trend:`
  line listed.
- `tests/register.test.ts`: the package tool's first answer line is the
  stop at a streak of 3, and `package.md` holds both sections; a failed
  message read refuses and writes no `package.md`; the existing package
  tests pass with the fake git answering the new read.
- `tests/counsel.test.ts`: `followUpsRefusal` accepts the object shape and
  refuses `outside_spec: false`, a missing text and an unknown key; the
  brief offers only file and drop for an outside-spec follow-up, with
  numbers 2 and 3; `fix`, `1` and `option 1` on it are not counted and send
  the member back with the sentence; `fix` on an in-scope follow-up in the
  same question still counts; the answer names an outside-spec follow-up; a
  stored question without `outsideSpec` tallies as before.
- The four gates in `CLAUDE.md`, for both mods. The skill, agent and README
  text is read only by the reviewers, and the pull request says so.
