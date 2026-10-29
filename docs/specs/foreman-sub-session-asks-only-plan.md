# Plan: a sub session messages its foreman parent only to ask what the parent alone can answer

Spec: foreman-sub-session-asks-only.md. Issue: SAL-403. Date: 2026-10-28.

Three planners worked blind from different priors: the simplest change, the
most robust change, and the most extensible change. A judge compared them
against the spec, the repository's rules and the owner's writing
preferences.

## Chosen approach

The most-robust plan wins. The change is prose only: one paragraph added to
skills/implement/SKILL.md and one bullet reworded in
mods/foreman/skills/wake/SKILL.md. It keeps no state. Whether the rule applies
is read from the session's first message, which carries a `foreman-ticket:`
line whenever foreman started the session, including a restart through
foreman.

The new paragraph sits directly after the paragraph "The line to the
starting session", which is the skill's only other rule about messaging the
starting session and is the new rule's one exception. A model about to send
its starting session a line reads both. Because that spot is inside "A review
round", the paragraph says that it holds at every stage.

## Grafts from the runners-up

- From the most-extensible plan: the wake bullet's wording, which keeps its
  lead clause and adds an imperative that matches the streak-of-3 bullet
  beside it. It also contributes "goes as **Questions** says", which is
  accurate for questions about how the owner works; those go straight to the
  person without the counsel.
- From the simplest plan: "naming the issue" in the wake bullet's pointer
  line.

## Rejected alternatives

- Placing the paragraph in the Questions section (the simplest plan). The
  main noise this change targets is progress reports, which are not
  questions, so a model about to report progress would not look there, and
  the exception it names would be far away.
- One long sentence carrying the whole rule (the most-extensible plan). It
  ran to about 110 words and breaks the owner's rule against compressing at
  the cost of clarity. The spec now asks for a short paragraph instead.
- A sentence telling the session to answer foreman's "what's next?" nudge by
  taking its next step rather than writing back (the most-robust plan). It
  goes beyond the spec, and the nudge's reply stays in the sub session's own
  transcript unless the session chooses to message the parent, which the
  main rule already forbids as a progress report. It would also bring
  foreman's own terms into /implement.
- The wake bullet wording "that question in the sub session itself" (the
  most-robust plan). It moves away from "open question", which the spec's
  Verification checks, to cover a rare case that the person can handle by
  typing into the sub session.

## Text

**skills/implement/SKILL.md.** Insert after the paragraph "The line to the
starting session" and before "**First half, at a head where the focused
reviewers have not run**", with a blank line on each side, wrapped at the
file's width with `foreman-ticket:` never at the start of a line:

> **Messages to a foreman parent.** A session whose first message holds a
> line that begins `foreman-ticket:` was started by a foreman parent, and so
> was a session whose compaction summary says its first message held one.
> Such a session sends that parent a message only to ask a question that the
> parent alone can answer, such as one about the brief it was started with:
> which repository, which issue, or what is in scope. It never sends the
> parent a report of its progress, because foreman's own lines already tell
> the parent about every pull request opened, every pair of verdicts, every
> merge and every close. The one exception is the line that **The line to
> the starting session** describes, which the session still sends as that
> paragraph says. A question for the person never goes to the parent. It
> goes as **Questions** says, to the counsel and then to the person, or
> straight to the person where that section says so, inside this session
> itself. A question that the session cannot tell is one only the parent can
> answer counts as a question for the person, and so does one the parent
> answers that it cannot settle. This holds at
> every stage, from the spec to the merge. A session whose first message
> holds no such line is not affected by this paragraph.

**mods/foreman/skills/wake/SKILL.md**, under "When the parent speaks".
Replace the bullet "A question to the person that this skill asks for, or
one a sub session asks the person, which the parent relays." with:

> - A question to the person that this skill asks for, or one a sub session
>   asks the person. For a sub session's question, point the person in one
>   line, naming the issue, at the sub session's own open question, which is
>   where their answer takes effect, and do nothing with the answer itself.

## Edge cases from state

- A restart through foreman carries a new ticket line, so the rule applies.
- A compaction hides the first message; the summary clause covers it when
  the summary records the ticket, and otherwise the session behaves as it
  does today, which the spec's first failure mode accepts.
- A cleared session or one the person resumes by hand has no ticket line,
  so the rule does not apply, which is correct.
- A hot reload or two copies running at once change nothing, because no
  state is kept. A mix of old and new skill copies is the spec's second edge
  case, handled by the wake skill's fallback.

## Steps

1. Insert the paragraph in skills/implement/SKILL.md.
2. Reword the wake skill bullet.
3. Commit both, staged by path.
4. Run the verification below and the four gates.

## Test plan

1. `git diff -U0 origin/main -- skills/implement/SKILL.md` shows only added
   lines, and the paragraph "The line to the starting session" reads
   exactly as on the base.
2. `grep -n "which the parent relays" mods/foreman/skills/wake/SKILL.md`
   prints nothing, `grep -n "own open question" mods/foreman/skills/wake/SKILL.md`
   finds the new bullet, and the diff of that file touches only that bullet
   and the "Noted." rule, which changes as the spec's Behavior 6 says.
3. `grep -n "foreman-ticket:" skills/implement/SKILL.md` shows no hit at the
   start of a line.
4. The four gates from the repository's CLAUDE.md pass. The report says
   that no gate reads skills/ and that the gates do not check the wake
   skill's wording. The existing foreman tests, including the one that pins
   the "Noted." context line, still pass, since that line stays true.
5. The trial run with a foreman parent is a manual check, described as one
   in the pull request.
