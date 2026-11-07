# A counsel rerun leaves refused paths out of the round-2 brief

Date: 2026-11-06.

## Goal

When the counsel tally reruns a question, the round-2 brief it writes never
lists a path that the containment rule refuses as a file to read. It names
each such path in a separate section with the reason it was refused, and the
tally's answer tells the session which paths were left out.

## Users/Trigger

The change that made the containment checks refuse parts made only of dots
and spaces (see `docs/specs/builder-containment-refuses-dot-and-space-parts.md`)
left this gap, and the counsel filed it as a follow-up.

The counsel tool refuses a whole call when any of its paths is refused, so a
question is never stored with a refused path. A stored path can still become
refused before the tally reruns the question, in two ways:

- the mod was reloaded during the session and loaded a newer rule that
  refuses the path, such as one with a part made only of dots and spaces;
- the path is a link inside the checkout that has since come to point outside
  it, which can already happen on the base branch.

Today `serveTally` in `mods/builder/hooks/register.tsx` asks `unwrittenPaths`
which stored paths are not written yet, ignores the refused path it also
reports, and passes every stored path to `briefText`. The seven members then
see the refused path under "## Files the question touches" as an ordinary file
to read, and nothing in the brief marks it.

## Behavior

1. `unwrittenPaths` reports every refused path, in the order the question
   named them, not only the first. The counsel tool still refuses a call with
   the message for the first refused path, exactly as today.
2. The reason for a refusal is worded once, in one function that both the
   counsel tool's refusal message and the round-2 brief use. It picks the
   reason in today's order:
   - a path written in a Windows form: `written in a Windows form`;
   - otherwise, a path with a part made only of dots and spaces that neither
     starts with `/` nor has a part that is exactly `..`: `has a part made only
     of dots and spaces, which Windows may read as ..`;
   - every other refused path, including a link that resolves outside the
     checkout: `leads outside the checkout`.

   The counsel tool's three refusal messages keep their exact wording today.
3. On a rerun, the round-2 brief lists under "## Files the question touches"
   only the stored paths that are not refused, each with its "(not written
   yet)" note as today. When at least one path is refused, the brief adds a
   section headed `## Paths left out` right after that list, with one line
   per refused path, `- <path>: <reason>`, using the reason from behaviour 2.
   The section carries none of the advice to name a different path that the
   counsel tool's refusal message gives.
4. When every stored path is refused, the files list says `None left; every
   path the question named is listed under Paths left out.` The line `None
   named.` stays only for a question that named no paths.
5. When the rerun's brief leaves out at least one path, the tally's answer
   adds one sentence before the rest of its text that names every left-out
   path and says they are listed under "Paths left out" in the round-2 brief.
6. A brief with no refused path, whether a first round, a rerun or a
   follow-ups question, reads exactly as it does today.

## Edge cases

- A question whose stored paths are all fine reruns exactly as today, with no
  new section and no new sentence in the tally's answer.
- A path both refused and not written yet, such as `docs/.. /new.md`, is
  listed only under "Paths left out", because a refused path never reaches
  the file system check.
- When the round-2 brief cannot be written, the question goes to the person
  as today, and the answer says only that the brief could not be rewritten,
  because no brief left anything out.
- Two refused paths are both listed, in the order the question named them.

## Non-goals

- The first round's refusal keeps its behaviour and its messages.
- The stored question keeps its paths exactly as the session named them; the
  rerun filters only the brief it writes.
- Nothing re-checks the stored paths when the tally decides a question or
  sends it to the person, because those answers write no brief and no member
  runs after them.
- A follow-ups question has one round and is never rewritten, so it is not
  touched.
- No other path check in the builder or foreman mods changes.
- Nobody runs this on Windows before the merge.

## Failure modes

- A left-out path costs the members one file of context in round 2. The
  session learns which one from the tally's answer and can weigh the votes
  with that in mind.
- If the reason function and the refusal message ever disagreed, a person
  could read two different reasons for one path; sharing one function is what
  prevents it.

## Verification

- The existing register test "a rerun of a question stored with a dot and
  space part keeps the notes of the paths after that part" changes to expect
  `docs/.. /x.md` absent from the files list, listed under `## Paths left out`
  with the dots-and-spaces reason, the `(not written yet)` note on
  `docs/specs/poll.md` kept, and the tally's answer naming `docs/.. /x.md`.
- A register test with a stored path that is a link now leading outside the
  checkout expects it under `## Paths left out` with `leads outside the
  checkout`, and not in the files list.
- A register test where every stored path is refused expects the `None
  left; …` line and no `None named.`.
- A register test with two refused paths expects both listed in order.
- A unit test of `briefText` in `mods/builder/tests/counsel.test.ts`: with no
  refused paths the text is unchanged, and with refused paths it has the new
  section and lines.
- The existing register tests of the counsel tool's refusal messages pass
  unchanged, and so does "a rerun rewrites the brief as round two with the
  proposed option added", which has no refused path and must show no new
  section or sentence.
- Each test of new behaviour is seen to fail before the change and pass
  after it.
- The four gates pass.

## Decided by the counsel

- When the round-2 rewrite of a counsel brief meets a stored path that the containment rule now refuses, what should the rewritten brief do with that path? The counsel chose: Leave the path out of the list of files, and add a short separate section naming the left-out paths and why, so a person reading the brief can see what was dropped. 5 of 7 members voted for it.
- The round-2 brief now leaves refused paths out of "## Files the question touches" and names them in a separate section. How should that section word each left-out path and its reason? The counsel chose: A section headed "## Paths left out" with one line per path, "- <path>: <reason>", where the reason is the specific one the first round's refusal gives (written in a Windows form, a part made only of dots and spaces, or leads outside the checkout), worded once in shared code so the two cannot drift, and without the first round's advice to the session to rename the path. 7 of 7 members voted for it.
- When the round-2 rewrite leaves one or more refused paths out of the brief, should the counsel tally tool's answer to the session also say so? The counsel chose: Yes: the tally's answer adds one sentence naming the left-out paths and saying they are listed under "Paths left out" in the round-2 brief, so the session knows before it launches the seven members again. 7 of 7 members voted for it.
- What should this change cover, and what should it leave out as a Non-goal? The counsel chose: Only the round-2 rewrite in serveTally, plus the shared reason wording and the tally note already decided. The first round's refusal keeps its behaviour and messages, the stored question keeps its paths unchanged, and nothing else re-checks stored paths. 7 of 7 members voted for it.
- On a round-2 rewrite where every stored path is refused, what should "## Files the question touches" say? The counsel chose: "None left; every path the question named is listed under Paths left out." 7 of 7 members voted for it.
