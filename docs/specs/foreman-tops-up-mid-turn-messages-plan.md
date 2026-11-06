# Plan: foreman tops up its queue on a message typed while the parent's turn runs

Date: 2026-11-05. Spec: `docs/specs/foreman-tops-up-mid-turn-messages.md`.

## Chosen approach

The simplest plan won. All three planners proposed the same code change and
none of them adds state, so the plans differed only in their tests and in how
far they edit the wake skill. The simplest plan was the smallest and the
closest to the spec, and the judge found it accurate against the code.

- In `withForemanLines` in `mods/foreman/hooks/register.tsx`, delete
  `inRunningTurn`, so that only a typed `/start-foreman` skips the top-up
  line. Nothing in foreman then reads `turnId` on a typed prompt.
- The count stays where it is. `topUpFrom` and `topUpCount` already work it
  out afresh from the stored ledger on every prompt, and the `start_session`
  tool call hook writes each start's reservation before the start goes on, so
  a count taken mid-turn already leaves out the starts made on that turn.
- `topUpSentence` in `mods/foreman/hooks/held.ts` returns the new shared
  sentence. For one issue it reads:

  `the queue needs one more issue; start one now, counting every start you make from here on, the issues the person names first and then the next ones the project's Next issue: fact picks; this number replaces any earlier top-up line's number on this turn.`

  For more than one, the number is in words in both places and "issue"
  becomes "issues", as today. A semicolon joins the replace clause, so the
  text stays one sentence and still works as the wake skill's heading.
  `startForemanText` already embeds this sentence, so `commands.ts` needs no
  code change.

The change keeps no new state. A restart, a resumed or cleared session and a
hot reload need no handling, because the count reads the ledger, the status
rows and the clock as it does today. Two copies of the mod would each add an
identical line, which already happens on a prompt that starts a turn, and the
replace rule makes the duplicate harmless.

## Grafts from the other plans

- **A test that types a prompt while a start is still going through**, from
  the most-robust plan. `w.engine.onStart` in the fake app runs after
  foreman's hook has written the reservation, so a prompt typed from inside it
  shows directly that the count already leaves the start out. It is the only
  direct proof of the spec's Behavior 2.
- **A test of a failed count**, from the most-robust plan. The spec names this
  failure mode and nothing tests it yet. Other tests already refuse a chosen
  foreman key through the fake app's `state.get` handler, so refusing the
  `files` key makes the count fail and leaves the held line alone.
- **The cap of five and the held line first, on a prompt typed mid-turn**, as
  required tests rather than optional ones, because the spec's Verification
  section lists the cap.
- **The cap sentence in the earlier spec and the README**, from the
  most-robust and most-extensible plans. Behavior 2 of the earlier spec says
  the five counts every start "on that turn". It becomes "from that line on",
  and the README's cap sentence changes the same way, so both state the
  current rule.
- **One wake skill sentence about the texts that say to start nothing**, from
  the most-robust plan. The text foreman gives for `/start-foreman` when its
  count fails says to start no sub session on this turn. A later top-up line
  on the same turn would contradict it, so the wake skill says that such a
  text counts as an earlier line, which the newest top-up line replaces. The
  texts' own wording stays as it is.
- **A caution and a small refactor**, from the most-extensible plan. Do not
  replace "on this turn" everywhere, because other texts use it correctly.
  Move the `startOne` helper in `register.test.ts` to module level, so that
  the new tests share it.

## Rejected alternatives

- **Rewriting the wake skill's "Starting a session" section**, from the
  most-robust plan. Its first sentence says the app refuses a start on a turn
  the person did not type, which is now slightly incomplete. But the section
  is about foreman's own lines, and a sentence in the top-up section saying
  that the app allows starts on a turn once the person's message has joined
  it, even a turn foreman began, settles the question where the model acts on
  the line. The rewrite goes beyond what the spec's Behavior 4 lists.
- **Running the existing tests over a table of prompt kinds**, from the
  most-extensible plan. It adds structure for rules that might come later,
  which the spec does not ask for. Explicit mid-turn tests cover the same
  cases.
- **A record of which turns had a line, or a hook that limits starts per
  turn.** Both are out of scope under the spec's non-goals (a) and (b), and
  both would add state that a restart or a second copy of the mod could leave
  stale.
- **Rewording the texts that say to start nothing.** Outside the spec. The
  one wake skill sentence above removes the contradiction without changing
  them.

## Steps

1. **Tests first, and see them fail.**
   - In `mods/foreman/tests/held.test.ts`, pin `topUpLine(1)` and
     `topUpLine(3)` word for word to the new text, and make the loop check
     `start ${word} now, counting every start you make from here on`.
   - In `mods/foreman/tests/register.test.ts`, move `startOne` to module
     level and add these tests:
     - With two slots, a prompt typed mid-turn carries the line for four;
       after one start it carries the line for three. This is the test that
       must fail before the change, because today the context is empty.
     - With one slot, a prompt typed from `w.engine.onStart` while a start is
       out carries the line for one.
     - With four slots, a prompt typed mid-turn carries the line for five.
     - With a held key, a prompt typed mid-turn carries the held line and then
       the top-up line.
     - With a held key and the `files` read refused, both a prompt typed
       mid-turn and one that starts a turn carry the held line alone.
   - Change the existing test that a plugin's prompt and a typed
     `/start-foreman` get no line. Drop its plain mid-turn case, add mid-turn
     versions of the plugin and `/start-foreman` cases, and retitle it to say
     "whether or not a turn runs".
   - In `mods/foreman/tests/commands.test.ts`, add one word-for-word check
     that the `/start-foreman` text for two contains the new sentence.
2. **The code.** Delete `inRunningTurn` in `withForemanLines` and rewrite the
   comment above it: the line goes on every typed prompt while the queue is
   short, whether or not a turn runs; the count is fresh from the ledger; the
   app counts its ten starts from the person's last typed message. Change the
   sentence in `topUpSentence` and its comment. Correct the comment on
   `TOP_UP_MAX` in `act.ts` to say the permission card comes from the eleventh
   start since the person's last typed message.
3. **The wake skill**, `mods/foreman/skills/wake/SKILL.md`:
   - The top-up heading becomes the new sentence for one issue, without the
     `foreman: ` head, and the example for three says "start three now".
   - The sentence saying a message typed mid-turn gets no line goes. In its
     place: a message the person types while a turn runs carries the line too,
     and the app allows starts on that turn from then on, even on a turn
     foreman began. The newest top-up line on a turn replaces any earlier
     one's number, which is what is still to start; never add the numbers
     together. A text foreman gave in place of the start-foreman skill earlier
     on the turn counts as an earlier line.
   - Every start made from the line on counts against its number, held keys
     and the person's named issues included.
   - The quoted `/start-foreman` text uses the new sentence for two, and the
     rule about never starting more than the number says "the newest line".
4. **The README and the earlier spec.** Replace the quoted lines in the
   README's "Topping up the queue" section, change its cap sentence to "from
   that line on", and say that a prompt typed while a turn runs gets the line
   too. In Behavior 2 of `docs/specs/foreman-keeps-queue-topped-up.md`, make
   the same cap change and replace the last sentence with the current rule
   and a pointer to the new spec. Leave that spec's plan file as it is.
5. **Check the copies.** Search `mods` and the earlier spec for the old
   phrase "counting every start you make on it". Only the new spec, which
   quotes it, and the earlier spec's plan should still hold it.

## Test plan

| Verification clause | Test |
|---|---|
| A prompt with a turn id now carries the line, where before it carried none | The new two-slot mid-turn test, which fails before the change |
| Its count comes from the ledger and is smaller after a recorded start | The same test, and the test that types while a start is out |
| Capped at 5 | The four-slot mid-turn test |
| The new shared wording | The pins in `held.test.ts` and `commands.test.ts` |
| Still absent at the target, on a plugin's prompt and on a typed `/start-foreman` | The existing target test, and the changed plugin and `/start-foreman` test |
| The `/start-foreman` text and the wake skill's heading use the same sentence | The `commands.test.ts` check, and a search of the skill for the one-issue sentence, because no test can read the skill |
| The count fails | The refused `files` read test |

Then run every gate in the project's `CLAUDE.md` for both mods. No gate reads
the wake skill, the README or the specs, so the report says so. The live
check in the desktop app, where the person types into a running parent turn
with a short queue and the parent starts the issues on that turn, is
reported plainly as seen or not seen, and does not hold the merge.
