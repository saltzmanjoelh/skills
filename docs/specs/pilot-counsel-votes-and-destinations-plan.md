# Plan: the counsel reads votes forgivingly and sends decisions where the session says

Spec: `docs/specs/pilot-counsel-votes-and-destinations.md`. Written 2026-10-14.

## Chosen approach

The most-robust plan won the tournament. Each fault becomes a pure rule in
`mods/pilot/hooks/counsel.ts` with a table test, and `register.tsx` only
gathers facts and applies the rule.

- **Vote reading** is a small parser inside `readVote`, not one large regular
  expression. It tidies the text, removes emphasis at most once, matches the
  option form, and reads a remark's first word as a word.
- **An unreadable vote's text** travels only in the value `votesOf` returns
  for one tally call, as a list of `{ member, text }`. That type lives in
  `counsel.ts`, not in `types/index.d.ts`, which is the stored-state contract,
  so the text cannot reach the counsel state, the store or the pane.
- **Where a decision goes** is one pure function, `destinationOf`, run once in
  `serveCounsel` before an id is taken or a brief is written.

## Grafts from the other plans

- From the extensible plan: the exported constant `READABLE_VOTE` and the named
  constants `QUOTE_CHARS` and `WITHHELD_VOTE`, so tests assert the exact words.
  The sentence is the spec's rule 9 word for word: "A readable vote is an
  option's number, alone or as option N, optionally followed by one remark in
  brackets, or none."
- From the extensible plan: the existing test of a question put after the
  watched pull request merged gains a call with `pull_request: 7` that is
  refused, so the test still proves something under the new default.
- From the extensible plan: the existing refusal test asserts that with every
  vote readable there is no quotation mark and no `READABLE_VOTE`.
- The remark is trimmed before its first word is read, which the robust plan
  left implicit.

## Rejected alternatives, with reasons

- **One regular expression with `split(/\s+/)` for the remark's first word**
  (the simplest and extensible plans). It reads `2 (or, 3)` and
  `2 (and/or 3)` as 2, and its two emphasis steps accept `***2***`. The judge
  ran both grammars against every listed form to find this.
- **Reading the watched pull request's state without checking it belongs to
  the watched number** (all but the robust plan). `watch()` writes the `run`
  atom and then the `pr` atom in two updates, so a counsel call between them
  sees the new number with the old pull request's state. The guard costs one
  comparison.
- **Keeping 80 characters and then adding the ellipsis** (the extensible plan).
  The spec says at most 80 characters including it.
- **Extra lines in the brief answer or the decided answer saying where a
  decision goes** (the robust and extensible plans, optional). The spec does
  not ask for them, and the decided answer already says "Record it in the
  spec".
- **Mentioning "option N" in the tally tool's vote description** (the simplest
  plan). It nudges the session to tidy a vote before passing it, which defeats
  the quote. The description says instead to pass the vote word for word.

## Steps

Each step writes its tests first and sees them fail.

1. **`readVote`** in `counsel.ts`. Tidy with `String(text ?? '')`, trim, remove
   one trailing full stop, trim. Compare `none` and `abstain` in lower case.
   Try the whole vote without emphasis when one or two `*` or `_` wrap it,
   symmetrically (`^(\*\*|\*|__|_)(.+)\1$`), tidying the inner text again and
   allowing no emphasis on the number; if that cannot be read, parse the
   original text allowing emphasis around the number or around `option N`.
   The core is `(?:option[ \t]+)?\d+`, case ignored, then nothing, or
   `[ \t]*[.,;:!?]+`, or `[ \t]*\(([^()\n]*)\)` optionally followed by
   `[ \t]*[.,;:!?]+`. Spaces inside a vote are only spaces and tabs. The
   remark is trimmed, and its first word is the leading run of
   `[\p{L}\p{N}'’-]` in lower case; `or` or `and` makes the vote unreadable.
   The range check and its refusal stay as they are. The comment above the
   function describes the grammar and the known limit in sentences.
2. **`votesOf`** returns `{ votes, unreadable }` on success, where `unreadable`
   is `UnreadableVote[]` (`{ member: string; text: string }`). An unreadable
   vote is recorded with its raw text, `String(raw.vote ?? '')`, keeping its
   case, only when its tidied text is not empty.
3. **`quoteVote(text)`**. When `secretIn` finds a secret in the whole raw text,
   it returns `WITHHELD_VOTE` ("its text was withheld because it looks like a
   secret"). Otherwise it trims, takes the first line (splitting on `\r\n`,
   `\r`, `\n`, U+2028 and U+2029), trims it, replaces control characters with
   spaces, and, counting by code point, keeps 79 characters plus `…` when the
   line is longer than `QUOTE_CHARS` (80). It returns the result in double
   quotation marks.
4. **`askAgainAnswer(q, members, unreadable = [])`**. When any of `members`
   has an unreadable entry, after the first line it adds "These votes could not
   be read:", one line per such member in member order
   (`- <member>: <quote>.`), and `READABLE_VOTE` once.
5. **`counselAnswer(q, t, unreadable = [])`**. In the ask branch, a member
   without a vote whose reason is null and who has an unreadable entry is
   listed with its quote in place of "no readable vote". `abstainerReason`
   stays as it is, because the pane uses it.
6. **`destinationOf(named, watched, state)`** in `counsel.ts`, returning
   `{ owedTo: { repo, number } | null } | { refusal }`. In order: `undefined`
   is the spec; a value that is not a safe whole number of at least 1, `null`
   included, is refused; nothing watched is refused; a different number is
   refused; a state other than open, unknown included, is refused; otherwise
   the decision is owed to the watched pull request. A refusal says what is
   watched ("Nothing is watched.", "o/r#7 is watched, and its last known state
   is merged.", or "... its state is not known yet."), says to call again
   without `pull_request` to record the decision in the spec and, when the
   watched pull request is open, that calling with its number is the other
   choice, and ends "No brief was written and nothing was recorded." It never
   repeats the value it was given.
7. **`register.tsx`**. `CounselInput` gains `pull_request`. `counselPullRequest`
   becomes `counselDestination($, named)`, which reads `run` and `pr` once and
   passes the snapshot's state only when its repo and number match `run`.
   `serveCounsel` calls it right after `briefRefusal` and before the folder,
   the id or any write, and returns `Refused: …` on a refusal; the later call
   goes. `serveTally` passes `unreadable` to both answers. The counsel tool's
   schema gains `pull_request: { type: 'integer', minimum: 1 }` with a
   description, not required, and its description replaces "Works with or
   without a watched pull request." The tally tool's vote description says to
   pass the vote word for word. Whether the engine checks the schema before
   the handler is confirmed during the build; the mod's own check stays either
   way.
8. **Text.** The comment on `CounselQuestion.pr` in `types/index.d.ts`;
   `skills/implement/SKILL.md`'s Questions section (pass `pull_request` with
   the number in every counsel call once the pull request is open and watched,
   nothing before, and a refusal says what is watched); `skills/spec/SKILL.md`
   rule 1 (never pass `pull_request`); `mods/pilot/README.md` (the tool row,
   the vote forms and quoting, the destination rule, and the store paragraph's
   wording). `docs/specs/pilot-counsel.md` is left as the record of the
   original counsel.

## Test plan

Mapped to the spec's Verification section.

1. `counsel.test.ts`: the test that held `**2**` unreadable becomes one table
   test of `readVote` with every form in the spec's Verification and Edge
   cases, the old cases (`Abstain.`, ` ABSTAIN `, `None.`, ` 3. `, `''`,
   `undefined`, `abstained`, `two, I think`), and `2 (or, 3)`,
   `2 (and/or 3)`, `***2***`, `*__2__*` and a vote with a line break as
   unreadable. `7 (a remark)` and `option 7` with three options are refused
   beside the existing out-of-range test. The `toEqual` of `votesOf`'s result
   gains `unreadable: []`.
2. `counsel.test.ts`: the refusal quotes `UNREAD-MARKER 2 or 3` with the
   readable-vote sentence; a 100-character vote is quoted as exactly 80
   characters including the ellipsis; a two-line vote by its first line; an
   AWS-shaped key on the second line and past character 80 is withheld and
   absent; an empty vote and a left-out member are named with no quote. The
   existing refusal test asserts no quotation mark and no `READABLE_VOTE`.
3. `register.test.ts`: a member unreadable with `FIRST-MARKER 2 or 3` and then
   `SECOND-MARKER 2 or 3` is quoted with the second text, not the first, in
   the answer that asks the person, and a left-out member keeps "no readable
   vote". A `counsel.test.ts` unit test of `counselAnswer` covers the same.
4. `register.test.ts`: an interceptor on every `state.set` and `store.set`
   finds no marker after both tallies, and the pane still reads
   "Abstained: data-reviewer (no readable vote)".
5. `register.test.ts`: with pull request 7 open and watched, a question put
   without `pull_request` and decided says "Record it in the spec", leaves no
   `counsel-owed:` key, and the next review has no "Decided by the counsel".
6. `register.test.ts`: the owed-decision tests at lines 2028, 2058, 2076,
   2126, 2164, 2235, 2263 and 2284 pass `pull_request: 7`. A grep for
   `counsel-owed` and "The mod lists this decision" finds any others.
7. `register.test.ts`: `pull_request` 8 while 7 is open, 7 after it merged or
   closed, 7 with nothing watched, and `"7"`, `7.5`, `0`, `-1` and `null` are
   each refused; each writes nothing under `/counsel/`, leaves `c1` unknown to
   the tally, and a valid call afterwards gets `c1`. The merged test at line
   2105 gains the refused call. `counsel.test.ts` has a table test of
   `destinationOf` covering every branch, an unknown state and a watched
   number different from the snapshot's.
8. `register.test.ts`: the counsel schema lists `pull_request` as an integer
   and does not require it.

The gates in `CLAUDE.md` run in order. The skills and the README are read by
no gate, and the report says so.
