# Foreman wakes the parent for pull request milestones

Written 2026-10-21. Seeded from an issue in the owner's tracker, which the
counsel filed while deciding `docs/specs/foreman-quiet-parent.md`. That
spec's rules stay in force except where this one changes them. The questions
the issue left open were put to the counsel.

## Goal

Foreman now drops the desktop app's turn-end notes about its sub sessions,
including a note whose quoted report says that a pull request opened or
merged, so the parent never hears of a milestone unless the person looks at
the band or the pane. The owner wants the parent to speak only when the
person has something to decide or a milestone happens: a pull request
opened, a verdict, a merge, or a question for the person.

This change makes foreman wake the parent with its own `foreman: ` line when
a sub session's status file shows its pull request opened, a new verdict
pair, a merge, or a close without merging, so that the parent can tell the
person in one line. Every fact in those lines comes from fields builder
writes from its own GitHub reads, never from text a sub session's model
wrote.

## Users and trigger

The owner, running a parent session that has run `/start-foreman` and starts
`/implement` sub sessions. The trigger is a read of the status folder, as
for foreman's other wakes. In a session whose role is off, nothing below
changes anything.

## What the status files hold today

Builder writes the status record's `pr` field, `{ repo, number, state,
checks }`, from its own `gh pr view` of the watched pull request, with
`state` one of `OPEN`, `MERGED` and `CLOSED`. No text from a sub session's
report reaches it. The verdicts are not in the record. Builder parses them
into its snapshot from the first line of the reviews that the session's own
gh login posted, against a fixed pattern, as the head's full commit id and
two words, each `APPROVE` or `REQUEST_CHANGES`, and keeps only the newest
pair at the current head.

## Behavior

### Builder

1. **The verdicts in the record.** The status record's `pr` field gains
   `verdicts`: `{ sha, spec, adversarial }` copied from the snapshot's
   verdicts at the current head, or null when the head has none. `sha` is
   the head's full commit id, and `spec` and `adversarial` are each
   `APPROVE` or `REQUEST_CHANGES`. No review text is ever written. The
   field is declared in `BuildStatus` and listed in
   `docs/specs/builder-status-file.md`. `version` stays `1`, because no
   field changes meaning.

### Foreman's reading

2. **A tolerant read.** Foreman keeps `pr.verdicts` only when `sha` is 7 to
   40 lowercase hexadecimal characters and both verdicts are one of the two
   words. Anything else, or a missing field, reads as null, so a status file
   from an older builder gives no verdict wake and no error.

### The milestone memory

3. **What foreman remembers.** Each pairing's acts gain `announced`, the
   milestones foreman has told the parent about: the pull request's number
   and state, and the last verdict pair announced, each null until there is
   one. A pairing made after this change starts with all three null.
4. **A pairing from before this change.** A stored pairing whose acts have
   no `announced` field takes what its first read shows as already
   announced, wakes for nothing on that read, and from then on wakes only
   for changes. The stored field is written on that read, so a hot reload
   does not take a later read as the baseline again. The parser keeps a
   missing field apart from a field whose values are null.

### The milestone rule

5. **When it runs.** On every read, for every active pairing whose owner
   record foreman reads, whatever the record's state, before the rule for
   that state. A record with no pull request changes nothing.
6. **Opened.** A pull request number that differs from the one announced
   gives the sentence `<who> opened pull request #<n>.` A new number resets
   the announced state and verdicts, so the steps below judge the new pull
   request alone.
7. **A verdict pair.** A pair whose `sha` differs from the announced pair's
   gives the sentence
   `<who>'s pull request #<n> has verdicts at <sha7>: spec <word>, adversarial <word>.`,
   where `<sha7>` is the first seven characters of `sha` and `<word>` is
   `approves` or `requests changes`. The one exception is a pair in which
   both approve when the announced pair also had both approving: it wakes
   nothing and is not recorded, which is the review carried over to a new
   head after a commit of cheap fixes. A null pair, as after a push, changes
   nothing.
8. **Merged and closed.** A state of `MERGED` or `CLOSED` that differs from
   the announced state gives `<who>'s pull request #<n> merged.` or
   `<who>'s pull request #<n> was closed without merging.` A pull request
   that goes back to `OPEN` wakes nothing, but the announced state follows
   it, so a second close wakes again.
9. **One line.** The sentences of one read come in the order above, after
   the sentences of the rules foreman already has for the same pairing and
   before the slot-free sentence, all in one `foreman: ` line, as today.
   `<who>` is named as foreman names a sub session today. The line quotes
   no record text, so it carries no data note.

### The idle rule

10. **A closed pull request stops the idle rule.** For a record whose pull
    request is `CLOSED`, the idle rule ends any stretch it was counting and
    neither nudges nor wakes, as the gone rule already skips a merged pull
    request. When the pull request opens again, the rule counts as before.

### The parent's side

11. **The "Noted." line loses its milestone exception.** The fixed context
    line of the earlier spec becomes:

    > From the foreman mod: this prompt holds only the desktop app's notes about sessions this parent started, or messages from them. Reply with the single word "Noted." and end the turn, unless one of them asks the person or this parent a question. Foreman reports pull requests opened, verdicts, merges and closes in its own lines. In a foreman parent this overrides the app's request to report the outcome in one or two lines.

12. **The wake skill** gets a section for each new sentence, headed with it,
    which asks the parent to tell the person that fact in one line and do
    nothing else. Its "When the parent speaks" list replaces the milestone
    that a note or message reports with the milestone that a foreman line
    reports. Its rule for a note or a message keeps asking for "Noted.",
    except for a question and for a sub session's line about a streak of 3
    or a limit, which "When the parent speaks" still lists, so that relay
    keeps working.
13. **The README** lists the four new sentences with the others, and says
    that a closed pull request stops the idle nudges.

## Edge cases

- **A record that skips a step.** A first read that already shows a merged
  pull request with verdicts, for a pairing made after this change, gives
  the opened, verdict and merged sentences together in one line.
- **Two rounds that request changes in a row** both wake, because their
  pairs are at different heads.
- **An approval after a round that requested changes** wakes, and so does a
  round that requests changes after an approval.
- **A second, fresh round that approves again** after an announced approval
  wakes nothing, as the carried-over review does; the merge wake follows.
- **A sub session that watches a second pull request** gets an opened
  sentence for it, and the second pull request's verdicts and close are
  judged afresh.
- **A pull request reopened after a close** wakes nothing for the reopening;
  the idle rule counts again.
- **A released or freed pairing,** or a record foreman does not own, wakes
  nothing, as for the other rules.
- **A malformed `verdicts` field** reads as null.

## Non-goals

- Waking for a change of checks, a stage, a label, a conflict or any other
  field of the record.
- Waking for a pull request that goes back to `OPEN` after a close.
- Telling the parent about the milestones of a session foreman does not
  track, such as one it never paired or one the person released. The
  person sees those in the band and the pane, and their notes now draw only
  "Noted.".
- Announcing a milestone that a pairing from before this change reached
  between its last read under the old code and its first read under this
  one. That is lost once, at the upgrade.
- Making the gone rule skip a closed pull request; a closed sub session
  whose session ended still gets the gone wake.
- Reading a milestone from the words of a note, a message or a report.
- Raising the record's `version`.
- Changing how builder parses verdicts, or which reviews it counts.

## Failure modes

- If builder stops writing `verdicts`, foreman sees null pairs and wakes for
  no verdict; the opened, merged and closed wakes go on.
- If a wake is refused, it is logged and not tried again, as foreman's other
  wakes are, and the milestone counts as announced.
- If the parent's model ignores the skill, it reports the milestone in more
  than one line, which is no worse than today's notes.

## Verification

- A builder test shows the record's `pr.verdicts` copied from a snapshot
  with verdicts at the head, and null for a snapshot without.
- Foreman tests show that the reader keeps a well-formed `verdicts` field
  and reads a malformed or missing one as null.
- Foreman tests of the decision show, each with the exact sentence: a new
  pairing whose record gains a pull request wakes once with the opened
  sentence, and not on the next read; a new verdict pair wakes once; a
  carried-over approval after an announced approval wakes nothing; a second
  pair that requests changes after one that requested changes wakes; a
  merge wakes once; a close wakes once; a reopened and closed again pull
  request wakes for the second close.
- A test shows that a stored pairing whose acts lack `announced`, read with
  an open pull request that has verdicts, wakes for nothing, and that a new
  pairing whose first read shows the same record wakes with the opened and
  verdict sentences.
- A test shows that an idle record whose pull request is `CLOSED` gets no
  nudge and no idle wake past three idle thresholds, and that the same
  record with an `OPEN` pull request still does.
- The test that pins the "Noted." line pins its new text.
- The wake sentences are pinned word for word, as today's are.
- The four gates pass. No gate reads the wake skill's text, so the pull
  request says so.

## Decided by the counsel

- Foreman will wake the parent with its own "foreman: " line for a sub session's pull request milestones. Builder's status file already records the pull request's number and its OPEN, MERGED or CLOSED state from builder's own GitHub reads, but it does not record the verdicts. Should this change also add the verdicts to builder's status file so that foreman can wake the parent for them? The counsel chose: Yes: builder adds the verdicts it already parses (the reviewed head's short sha, and the spec and adversarial verdicts, each APPROVE or REQUEST_CHANGES) to the status record's pr field, and foreman wakes for opened, each new verdict pair, and merged. 7 of 7 members voted for it.
- Once foreman wakes the parent itself for a pull request opening, each new verdict pair and a merge, what should happen to the milestone exception in the "Noted." context line and in the wake skill's rule for desktop app notes, which today tell the parent to reply "Noted." unless a note reports a milestone (a pull request opened, a verdict or a merge) or asks a question? The counsel chose: Remove the milestone exception from both: a prompt of notes always gets "Noted." unless a note or message asks the person or the parent a question, because foreman's own line now reports milestones. 7 of 7 members voted for it.
- Builder's status file can also show a sub session's pull request as CLOSED (closed without merging). Should foreman wake the parent for that too, besides opened, each new verdict pair and merged? The counsel chose: Yes: a pull request that becomes CLOSED wakes the parent once with its own sentence, so the parent tells the person in one line. 7 of 7 members voted for it.
- Foreman will wake the parent once for each new verdict pair, telling repeats apart by the reviewed head's short sha. A verdict review can be carried over to a new head after a commit of cheap fixes, so the same pair (both approve) appears again at a new sha, usually just before the merge. Which verdict pairs should wake the parent? The counsel chose: Every pair at a new sha, except a pair in which both approve when the last pair announced for that pull request also had both approving. 7 of 7 members voted for it.
- When foreman starts tracking milestones, what should happen for a pairing whose record already shows milestones that foreman has not yet announced, such as a pairing made before this change whose pull request is already open or already has verdicts, or a foreman that was reloaded or upgraded mid-run? The counsel chose: A pairing that has no milestone memory yet (one made before this change) takes whatever its first read shows as already announced and wakes for nothing until something changes after that; a pairing made after this change starts with nothing announced, so its pull request opening wakes the parent. 7 of 7 members voted for it.
- After foreman wakes the parent because a sub session's pull request was closed without merging, the sub session stops on purpose and builder reports it idle, so foreman's idle rule would still nudge it twice and then wake the parent again with "is still idle after two nudges". Should this change also stop the idle rule for a record whose pull request is closed, or leave the idle rule as it is? The counsel chose: Stop it: the idle rule neither nudges nor wakes for a record whose pull request is CLOSED, as the gone rule already skips a merged one. 6 of 7 members voted for it.
