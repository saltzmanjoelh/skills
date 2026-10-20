# The counsel keeps every decision on record and words it cleanly

Date: 2026-10-14

## Goal

Three things the counsel shows a person are wrong today.

- **A decision can be written down nowhere.** A question put with
  `pull_request` owes its decision to that pull request's next review. When the
  pull request merges or closes while the counsel is still voting, or after the
  tally but before the next review, no review ever lists it. The session was
  told the mod would list it, so it did not write it in the spec either, and
  the store prunes it ninety days later. Nobody can later find why that option
  was chosen.
- **The decision sentence reads as broken.** The sentence is "The counsel chose
  X, 4 of 7." with the option's text as X. Options are usually whole sentences,
  so the line reads "…as today., 6 of 6." or "The counsel chose The approval…",
  in specs, in reviews and in what the person is told.
- **The pane and the question use two labels for one thing.** The pane lists
  members without a vote under "Abstained:", while the question put to the
  person lists them under "Without a vote:". A person reading the pane may
  think abstaining is still allowed.

## Users and trigger

- An `/implement` session that puts a question to the counsel with
  `pull_request`, while the owner merges or closes that pull request by hand.
- A session resumed after a restart, whose pull request merged or closed while
  it was down.
- Every person who reads a decision line in a spec, a review or a question, and
  every person who reads the counsel section of the pilot pane.

## Behavior

### Where a decision is recorded

1. **The tally reads the pull request again.** When a round decides a
   question that owes its decision to a pull request, the tally asks GitHub
   for that pull request's state with
   `gh pr view <number> --repo <repo> --json state`, naming the repository and
   number the question stored, not whatever the watch follows now. It asks
   only for a decided round of such a question.
2. **Open: owed as today.** When GitHub answers `OPEN`, the decision is owed
   to that pull request's next review, as before, and the answer says so.
3. **Not open: recorded in the spec.** When GitHub answers `MERGED` or
   `CLOSED`, nothing is owed and nothing is stored for the pull request. The
   answer says the pull request merged, or closed, before the tally, and tells
   the session to record the decision in the spec under "Decided by the
   counsel", with the same line a question put without `pull_request` gets.
4. **Unknown: recorded in the spec.** When `gh` fails, is cut off, or answers
   anything other than those three states, the tally treats the pull request
   as not open, as in point 3, but the answer says the pull request's state
   could not be read at the tally rather than that it merged or closed.
5. **Owed, then the pull request ends.** A decision owed to a pull request
   that then merges or closes before the next review is posted is handed to
   the session in two ways, and deleted once either has handed it over:
   - **The turn for the change.** When the mod hands the session a change
     whose state is merged or closed, the prompt lists the decisions still
     owed to that pull request, and tells the session to record them in the
     spec under "Decided by the counsel", because no review will list them.
     The decisions are read before the last check that precedes the submit,
     so nothing is awaited between choosing the read and the submit. The keys
     listed are deleted only once the prompt is accepted; a refused prompt
     keeps them.
   - **The watch tool's answer.** When the watch tool reads the pull request
     as merged or closed, its answer lists the decisions still owed to it, in
     the same words, and deletes the keys it listed. This reaches a session
     resumed after a restart, for which the turn for the change never came.
     The watch tool looks for owed decisions only when the pull request is not
     open.

   Either way only the keys listed are deleted, never every key under the
   pull request, so a decision stored after the list was read is listed the
   next time. Every decision owed to that pull request is listed, whichever
   session's question it came from.
6. **The record, restated.** Point 6 of `pilot-counsel.md` says a decision is
   written where it took effect. It now says: during `/spec`, in the spec;
   during `/implement`, in the next review on the pull request the question
   named, while that pull request is open; and in the spec when that pull
   request merged or closed before the decision reached a review, as the
   tally's answer, the turn for the change or the watch tool's answer tells
   the session.

### The decision sentence

7. **The new shape.** The sentence is "The counsel chose: <option> <n> of
   <m> members voted for it." The option follows a colon exactly as the
   session wrote it, capital letters and inner punctuation included, and the
   count is a sentence of its own. For example: "The counsel chose: Ignore
   the proposal. 6 of 7 members voted for it."
8. **One terminal mark.** The option keeps its own last mark when it ends in
   a full stop, a question mark, an exclamation mark or an ellipsis, or in
   one of those followed by closing quotation marks or brackets. Otherwise a
   full stop is added. So no option ends "?.", ".." or "….", and none runs
   into the count.
9. **The same sentence everywhere.** The line in a spec's "Decided by the
   counsel" section and in a review's decision paragraph is "- <question>
   <sentence>". The answer to the session is "Decided: <sentence>" and tells
   the session to tell the person in those words.
10. **Old lines stay.** The decision lines already written in the specs keep
    the old shape, as the record of what was written at the time. Only the
    passages of `pilot-counsel.md` that define the sentence (rule 7 of
    "Abstentions" and rule 4 of "The owner's advocate") change to the new
    shape, and the spec says that lines written before 2026-10-14 use the old
    one.

### One label

11. **"Without a vote:" in the pane.** The pane lists members without a vote
    under "Without a vote:", with each reason or "no readable vote", for every
    tally that has them: tallies stored before abstaining was removed, rounds
    sent to the person because a member asked again still had no vote, and
    tallies recorded before the owner's advocate joined. Rule 7 of "Every
    member votes" in `pilot-counsel.md` says so.

### Documents

12. The pilot README and the Questions section of `skills/implement/SKILL.md`
    say where a decision goes when its pull request merged or closed first,
    give the new sentence, and name the pane's label "Without a vote:".

## Edge cases

- **The watch moved to another pull request before the tally.** The tally
  reads the pull request the question stored, so a decision on an open pull
  request that is no longer watched is still owed to it.
- **A merged pull request with nothing owed.** The change prompt and the watch
  answer say nothing about decisions.
- **The same decision listed twice.** If deleting a listed key fails, the next
  merged or closed read lists it again. The session finds the line already in
  its spec and does not add it a second time. A failed delete never stops the
  prompt or the answer.
- **A tally in the instant after the change prompt read the store.** Its own
  read of GitHub sees the pull request merged and sends the decision to the
  spec; if GitHub still said open, the decision is stored and the next watch
  answer on that pull request lists it.
- **An option that is a question**, such as "Should it rerun?", ends in its
  own question mark: "The counsel chose: Should it rerun? 4 of 7 members voted
  for it."
- **An option that ends in a quoted sentence**, such as `…reads "The counsel
  chose X."`, keeps the quotation as it is and gets no extra full stop.
- **An option that starts with a code word or a name**, such as `gh` or
  GitHub, is never changed.

## Non-goals

- Posting a decision as a comment on a merged or closed pull request. The
  counsel chose the spec instead; nothing in the mod posts plain comments.
- Rewriting the decision lines already in `docs/specs`.
- Changing what the pane shows as the chosen option ("Chosen: <option>").
- Changing how a follow-ups question (`counsel-decides-follow-ups.md`)
  records its decisions.
- Closing every window a decision could fall through when the mod is not
  running at all: a decision owed to a pull request that nobody watches again
  is still pruned after ninety days.

## Failure modes

- `gh` cannot read the pull request at the tally: the decision goes to the
  spec, and the answer says the state could not be read.
- The store refuses to save an owed decision: as today, nothing is recorded
  and the session tallies the round again.
- The change prompt is refused: the owed decisions are not deleted, and the
  next handover or watch answer lists them.
- A spec edit made after the merge lives only in the worktree. `/implement`'s
  Merged step names the commits the pull request lacks, so the person sees it.

## Verification

Each of these is a mod test that fails if its change is removed:

- A decided round owed to a pull request that `gh` reads as `OPEN` stores the
  owed decision and answers that the next review lists it.
- The same round with `gh` reading `MERGED`, and with `CLOSED`, stores
  nothing, and answers that the pull request merged, or closed, before the
  tally, with the spec line.
- The same round with `gh` failing, and with an unreadable answer, stores
  nothing, and answers that the state could not be read, with the spec line.
- The tally reads the pull request the question stored even when the watch
  has moved to another one.
- A change handed over with the pull request merged lists every decision owed
  to it and deletes exactly those keys once the prompt is accepted; a refused
  prompt deletes nothing; a key stored after the list was read survives.
- The watch tool's answer on a merged or closed pull request lists the owed
  decisions and deletes those keys; on an open pull request it lists nothing.
- The decision sentence for an option ending in a full stop, in a question
  mark, in a full stop inside closing quotation marks, and in no mark, and for
  one starting with a capital letter, each reads as point 7 and point 8 say.
- The pane lists members without a vote under "Without a vote:", for a round
  sent to the person and for an old tally holding `abstain` votes, and never
  under "Abstained:".

`pilot-counsel.md`, the pilot README and `skills/implement/SKILL.md` describe
the change. No gate reads them, so the reviewers check them.

## Decided by the counsel

These lines use the shape this spec defines.

- When a counsel question was put with pull_request naming the watched, open pull request, and that pull request has merged or closed by the time the round decides, where should the decision be recorded? The counsel chose: Owe it to nothing and tell the session to record it in the spec, under "Decided by the counsel", as for a question put without pull_request; the answer also says the pull request merged or closed before the tally. 4 of 7 members voted for it.
- At tally time, how should the mod learn whether the pull request a decision is owed to is still open? The counsel chose: Ask GitHub at tally time with gh pr view for that pull request's state; when gh fails or answers something unreadable, treat it as not open and send the decision to the spec. 6 of 7 members voted for it.
- A decision can still be owed to a pull request that was open at the tally but merges or closes before the next review is posted there. What should happen to such a decision? The counsel chose: Same as the second option, but the mod also lists those decisions in the watch tool's answer whenever it reads that pull request as merged or closed, so a session resumed after a restart sees them too; they are deleted only once one of the two has been handed to the session. 6 of 7 members voted for it.
- How should the counsel's decision sentence read, so that an option ending in a full stop or starting with a capital letter reads cleanly? The counsel chose: Put the option after a colon, as written, and give the count its own sentence: "The counsel chose: <option, ending in exactly one full stop> 4 of 7 members voted for it." 6 of 7 members voted for it.
- The specs already hold about 80 decision lines in the old shape, 77 of them with the doubled punctuation (for example "...as today., 6 of 6."). What should this change do with them? The counsel chose: Leave the existing lines as they are, as the record of what was written at the time; only new decisions use the new shape, and the counsel spec says the old lines predate it. 7 of 7 members voted for it.

The members also asked that a question mark or an exclamation mark at the
end of an option be kept rather than followed by a full stop, which point 8
does.
