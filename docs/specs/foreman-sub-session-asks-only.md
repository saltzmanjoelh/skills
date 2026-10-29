# A sub session messages its foreman parent only to ask what the parent alone can answer

Issue: SAL-403. Date: 2026-10-28.

## Goal

A foreman parent's transcript should show foreman's own milestone and
decision lines and the real questions its sub sessions ask, and nothing that
merely repeats progress. Foreman's lines already report every pull request
opened, every verdict pair, every merge and every close, so a message from a
sub session that says the same thing is noise.

SAL-403 has two parts. This change ships the second: a rule in the
/implement skill about when a sub session messages its foreman parent, and
the matching wording on the parent's side in the foreman wake skill. The
first part, dropping foreman's "Kept <issue>'s turn-end note from the
parent's model." prompts, does not ship, for the reason given under
Non-goals.

## Users/Trigger

- A session running /implement whose brief came from a foreman parent. It
  knows that from its first message, which carries a `foreman-ticket:` line;
  foreman's `briefFor` adds that line to every brief it starts.
- The foreman parent's model, which reads a note or message that a sub
  session sent despite the rule.

## Behavior

1. skills/implement/SKILL.md gains a short paragraph saying that a session started
   by a foreman parent messages that parent only to ask a question that the
   parent alone can answer, such as one about the brief it was started with
   (which repository, which issue, what is in scope), because foreman's own
   lines already report progress.
2. The same paragraph names the one exception by referring to the paragraph
   "The line to the starting session", rather than restating it. That
   paragraph, the line about a streak of 3 or a limit, stays word for word
   as it is.
3. The same paragraph says that a question for the person never goes to the
   parent: it goes as the skill's Questions section says, to the counsel and
   then to the person, or straight to the person where that section says so,
   inside the sub session itself.
4. In mods/foreman/skills/wake/SKILL.md, under "When the parent speaks", the
   bullet "A question to the person that this skill asks for, or one a sub
   session asks the person, which the parent relays" is reworded so that, for
   a sub session's question to the person, the parent points the person at
   the sub session's own open question, which is where the answer takes
   effect, and does nothing with the answer itself. A question to the person
   that the wake skill itself asks for is unchanged.
5. The rule in "A note about a sub session, or a message from one" still
   lets the parent reply with more than "Noted." when a note asks the person
   a question, so a person-directed message that arrives anyway is still
   handled, now by pointing the person at the sub session's question.
6. The same rule answers a sub session's question to the parent. A sub
   session is reached only through the desktop app's `send_message`, so a
   reply in the parent's own turn never reaches it. When the parent can
   answer the question from the brief it started that sub session with, or
   from the wake skill, it sends the answer to that sub session in one
   `send_message`. When neither settles it, it sends one `send_message`
   saying so, and the sub session then treats it as a question for the
   person.

## Edge cases

- A session whose first message has no `foreman-ticket:` line, such as one
  started by a parent that is not running foreman, or started without a
  brief: the new rule does not apply, and nothing about it changes.
- A sub session on an older copy of the skill, or one not running
  /implement, that still sends the parent a question for the person: the
  wake skill's fallback in Behavior 5 handles it.
- A sub session that cannot tell whether a question is one only the parent
  can answer: it is a question for the person, and goes through the
  Questions section.

## Non-goals

- Part 1 of SAL-403 is not done. A probe on engine 2.1.308 found that every
  way a hook can discard a prompt shows something to the person: dropping it
  in `prompt.submit` emits a visible warning, answering without `next` emits
  another, and `session.receive` never sees prompts the host writes in. The
  issue asks for a drop only if it can be done quietly, so the "Kept…" lines
  stay, the evidence is on the issue, and nothing in foreman's hooks changes.
  The issue's "Done when" is therefore met only in part, because those lines
  remain in the parent's transcript.
- No change to foreman's code, to its notes or to how it notifies the person
  that a sub session needs them.
- No change to the paragraph "The line to the starting session", or to how
  /implement asks the person or the counsel.
- No change for sessions started by a parent that is not running foreman.

## Failure modes

- A sub session ignores the rule and sends a progress message: the parent
  replies "Noted." as it already does, which is the noise this change aims to
  prevent but no worse than today.
- A sub session sends a question for the person to the parent: the parent
  points the person at the sub session's open question, and the answer still
  lands where it takes effect.

## Verification

- skills/implement/SKILL.md contains the new paragraph of Behavior 1 to 3,
  and the paragraph "The line to the starting session" is byte for byte
  unchanged, checked with `git diff` against the base.
- mods/foreman/skills/wake/SKILL.md no longer says the parent relays a
  question a sub session asks the person, and says instead that it points the
  person at the sub session's open question; the rest of "When the parent
  speaks" is unchanged apart from that, and the "Noted." rule changes only
  as Behavior 6 says.
- The repository's four gates pass. None of them reads skills/, and the wake
  skill is read only as part of the foreman mod's plugin checks, so the
  gates do not check this wording.
- On a trial run with a foreman parent, the parent's transcript shows no
  progress message from the sub session, only foreman's milestone and
  decision lines, any real question, and the "Kept…" lines that part 1 could
  not remove.

## Decided by the counsel

- The /implement skill is gaining a rule that a session started by a foreman parent messages that parent only to ask a question it cannot answer itself, because foreman's own lines already report progress. The skill already has a paragraph, "The line to the starting session", that sends the starting session one short line when a streak of 3 goes to the counsel or the person is asked about a limit, saying either that the session waits on the person or what the counsel decided. How should the new rule treat that line? The counsel chose: Keep the streak-and-limit line unchanged, as the one named exception to the new rule, because the foreman wake skill already acts on it by telling the owner. 7 of 7 members voted for it.
- Under the new rule, a session started by a foreman parent messages that parent only to ask a question it cannot answer itself. Which questions should that cover? The counsel chose: Only a question that the parent alone can answer, such as one about the brief it was started with (which repository, which issue, what is in scope); a question for the person still goes through the skill's Questions section, to the counsel and then to the person in the sub session itself, never to the parent. 7 of 7 members voted for it.
- Should this change also reword the foreman wake skill's "When the parent speaks" bullet that reads "A question to the person that this skill asks for, or one a sub session asks the person, which the parent relays", now that the /implement skill will say a session started by a foreman parent never sends the parent a question meant for the person? The counsel chose: Reword the wake skill bullet in this change so it says the parent points the person at the sub session's own open question, and keep the parent's handling of a person-directed message that arrives anyway as a fallback. 4 of 7 members voted for it.
