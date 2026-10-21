# Plan: the narrowing trend counts only real fixes

Written 2026-10-21 for `narrowing-trend-counts-real-fixes.md`, from a
tournament of three plans (simplest thing, most robust, most extensible) and a
judge.

## Chosen approach

The most robust plan won, trimmed. The judge checked the plans' differing
claims against the code. The robust plan was the only one that kept every
`Tidied:` line listed, as the spec asks, that listed every commit whose
`Reviewed:` value could not be matched, and that noticed what the reviewers
can see: the package's `## Commits, oldest first` block gives each commit's
short sha, subject and file list, but not its message body or its own diff,
and the six reviewers have only Read, Grep and Glob. So a mislabel finding is
always inferred, and the claim checker, which has Bash, confirms it with
`git show`.

All behaviour stays in the pure trend code in `mods/builder/hooks/review.ts`.
Nothing is stored; the trend is rebuilt from the branch's commit messages on
every package call, so a restart, a resumed or cleared session, a hot reload
and two copies running at once all see the same result. Two copies of the mod
at different versions count differently, which no plan can avoid.

- `review.ts`:
  - `export const SHA_MIN_CHARS = 7`, beside `STREAK_SHOWN` and `STREAK_STOP`.
  - `shaWord(value)` reads a value's first word as today: trimmed, split on
    whitespace, trailing punctuation removed, lower case.
  - `commitNamed(word, commits)` gives the one branch commit whose full sha
    starts with `word`, or undefined unless `word` is 7 to 40 hex characters
    and exactly one commit matches.
  - `groupKeyOf` keeps its job: no `Reviewed:` line, or a blank first word,
    keys the commit's own sha, as today; a named commit keys its full sha;
    anything else keys `reviewed <word>`.
  - `retagOf(value, commits)` splits a `Retag:` value at its first colon,
    reads the sha part with `shaWord` and `commitNamed` and the area with
    `areaKey`, and gives the commit's index and the area, or undefined when
    there is no colon, the area is blank, the sha names no single commit, or
    that commit has no `Tidied:` line for the area.
  - `trendOf` reads every `Retag:` line first, into a map from commit index
    to a set of area keys, so a duplicate is a silent no-op and a retag
    applies wherever it stands. Then today's loop runs, and at each commit the
    counted areas are its `Area:` lines and the `Tidied:` lines a retag names,
    pushed with that commit's own index. A commit with a `Reviewed:` line and
    only `Tidied:` lines forms no group and is not listed as unlabelled.
    Every commit with a `Reviewed:` line whose value names no single commit
    is listed as unmatched, a blank value shown as `(no value)`.
  - `TrendReport` gains `tidied: { sha, area, retagged }[]`,
    `unmatched: { sha, value }[]` and `unappliedRetags: string[]`, all cleaned
    with `printable`; `unreadable` stays for `Trend:` lines.
  - `trendSection` prints three blocks after the areas: the `Tidied:` lines,
    each `- <area> (<sha8>)`, with a note on the retagged ones that they are
    read as `Area:` lines; the unmatched values; and the `Retag:` lines that
    changed nothing, under one lead-in sentence naming both reasons. Its
    `None yet.` needs the new lists empty too.
  - `trendStopLine` adds, on its single line, that the stop happens whatever
    the findings behind it were, and that a later safety finding in the area,
    or one that breaks working behaviour, stays in scope and blocking
    whatever the answer, so the answer governs only the area's other later
    findings.
- `register.tsx`: only the package tool's description names `Tidied:` and
  `Retag:` lines.
- `text.ts`: the comment on `areaKey` names `Tidied:` lines too.
- The six reviewer agents: one identical paragraph after their
  `## Already decided` paragraph. Read the `Tidied:` lines in
  `## Areas fixed so far`; judge each by the files its commit touched, in
  `## Commits, oldest first`, and by the whole diff; a `Tidied:` line on a fix
  that changed what the code does, a change to an instruction file such as a
  skill, an agent, a command or a mod included, is a finding with
  `Scope: in the spec`, citing the review rounds' rule that a `Tidied:` line
  is only for a fix that changes nothing the code does, and
  `Needs checking: yes`, naming the commit's short sha and the area.
- `claim-checker.md`: one sentence that such a finding is in the spec,
  whatever the pull request's spec says, and that it confirms the claim with
  `git show <sha>`.
- `skills/implement/SKILL.md`: "The fix lines" gives the `Area:` and
  `Tidied:` rule, both lines when a commit has both kinds of fix, the
  `Retag:` correction (in the first half it goes in that round's fix commit;
  in the second half it is a cheap fix at point 4, listed under `Fixed:`;
  when the limit rule makes no commit it goes in the next commit made; the
  rule for rounds is unchanged), and how to write the values: bare, with no
  backticks; `Reviewed:` with the full head sha the package tool's answer
  gives; `Retag:` with the short sha the `Tidied:` listing prints or the full
  sha from `git log`. "A streak of 3" says the stop always happens, the
  question carries the safety sentence, and cut it out removes the hole with
  the code. "The rule for scope" says a mislabel finding is in the spec.
- `README.md`: the package tool row names `Tidied:` and `Retag:` lines, the
  unmatched list, and the stop's safety sentence.
- `review-rounds-stay-in-scope.md`, rule three: edited where it becomes wrong
  (the grouping sentence, the fix lines, the cheap follow-ups sentence, the
  list of what the package shows, the stop) with a pointer to the new spec.

## Grafts

- From the most extensible plan: the claim checker sentence, which the judge
  called the most important graft. The claim checker checks scope against the
  pull request's own spec, which never mentions `Tidied:` lines, so without
  it a mislabel finding is set aside as outside the spec and never corrected.
  Also its `register.test.ts` assertion that the new sentence is in the first
  line of the package tool's answer, and its exported sha-length constant.
- From the simplest plan: the small helpers `shaWord` and `commitNamed`
  rather than a per-commit record of every label, and one plain paragraph for
  all six reviewers.

## Rejected alternatives

- **Moving a retagged `Tidied:` line out of the `Tidied:` list** (simplest and
  extensible plans). The spec lists every `Tidied:` line, and the marker lets
  a later reader see the mislabel was already corrected.
- **The unmatched note only for commits that form a group** (simplest plan).
  The spec says each commit whose value could not be matched.
- **A record of every label per commit** (extensible plan). A refactor no
  behaviour needs, which widens the diff.
- **An exception in the security reviewer's prompt saying a mislabel finding
  is not a safety finding** (extensible and robust plans). The skill and the
  claim checker count any `[security]` finding as a safety finding by its
  tag, so the sentence could not work, and it is not needed: the security
  reviewer is a focused reviewer whose surviving findings are fixed anyway.
- **A reason printed for each unappliable `Retag:` line** (robust plan). The
  spec asks for the listing that unreadable `Trend:` lines get, one lead-in
  sentence.
- **Requiring the sha part of `Retag:` to be a single token** (robust plan).
  It departs from "the same rule as `Reviewed:`", and a line missing the
  colon after the sha is unappliable anyway, because its area matches no
  `Tidied:` line.
- **A set guard against duplicate commit records** (robust plan). `git log`
  never gives a commit twice.
- **Telling sessions the package tool's answer gives the `Retag:` sha**
  (robust plan). It gives only the head.

## Steps

1. Tests first, in `mods/builder/tests/review.test.ts`, then see them fail.
2. `review.ts`: the constant, the helpers, `groupKeyOf`, `retagOf`, the two
   passes in `trendOf`, the report fields, `trendSection`, `trendStopLine`
   and their comments. See the tests pass.
3. `register.tsx` description, `text.ts` comment, `register.test.ts`
   assertion.
4. The six reviewer agents and the claim checker.
5. `SKILL.md`, `README.md` and rule three of the older spec.
6. The gates.

## Test plan

In `tests/review.test.ts`, with colliding shas built inline, such as
`'abcdef1' + 'a'.repeat(33)` and `'abcdef1' + 'b'.repeat(33)`:

- Matching: a 7-character value matching one commit groups under it; a
  6-character value keys its own group and is listed; a value matching two
  commits keys its own group and is listed; two commits giving the same
  ambiguous value share a group; a 7-character value that matched one commit
  keys its own group once a second commit shares its prefix; a blank value
  keeps the commit's own group and is listed as `(no value)`.
- Tidied: a `Tidied:` line neither lengthens nor breaks a streak and is
  listed; a `Reviewed:` commit with only `Tidied:` lines is not unlabelled; an
  `Area:` and a `Tidied:` line for one area count once and list the tidied
  line; a section with only `Tidied:` lines does not say `None yet.`
- Retag: a retag turns a streak of 2 into 3 at the retagged commit's place
  and stops, and the tidied entry is marked; a `keep going` line between the
  two commits still resets it; a retag in or before the commit it names
  applies; a duplicate changes nothing and is not listed; a retag in a closed
  area leaves it closed; unappliable retags (a 6-character sha, an ambiguous
  sha, a sha matching nothing, no colon, a blank area, a commit with no
  `Tidied:` line for the area) are listed and change nothing; listed values
  are cleaned of control and direction characters.
- Stop line: it holds the safety sentence, on one line.

In `tests/register.test.ts`, the package tool's streak test also checks the
safety sentence in the answer's first line. Then the four gates for both
mods. No gate reads the skill, the agents, the README or the specs, and the
pull request says so.
