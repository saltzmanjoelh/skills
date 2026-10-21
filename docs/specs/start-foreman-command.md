# Foreman starts with /start-foreman

Written 2026-10-20. It replaces the `/foreman` command, and its `slots`,
`pause` and `resume` forms, that `foreman-shows-sub-sessions.md` and
`foreman-acts.md` describe. Where those specs name `/foreman`, read
`/start-foreman`. Where they describe the pause, it no longer exists.

## The incident

The owner opened a new session in the Claude Code desktop app and typed
`/foreman`. The prompt box warned that `/foreman` was not a command. The only
foreman entry it offered was the `foreman:wake` skill, which is meant for the
parent's model rather than for typing. The owner chose it once, which loaded
the wake instructions and did not make the session the parent.

The command did run when it was sent despite the warning. The mod declared it
from its `session.start` hook, and the prompt box of a session that has not
started yet lists only commands and skills that it can read from files. A
command that a mod declares at the start of a session is not among them.

## Behavior

1. **One command, from a file.** `skills/start-foreman/SKILL.md` is a skill in
   this repository's `skills` folder. It is linked into the person's skills
   folder, as the other skills are, so it carries no plugin prefix and the
   prompt box lists it before a session starts. Its description says what
   foreman does, how to give a slot count, and that sub sessions should start
   only after it. It sets `disable-model-invocation: true`, so only the person
   starts it.
2. **The mod answers it.** Foreman's `command.run` hook on `start-foreman`
   answers without calling `next`, so the command never reaches the model
   while the mod runs. The mod no longer declares any command of its own.
3. **The arguments.** No argument makes the session the parent. One argument
   that is a whole number from 1 to 20 does the same and sets the slot count;
   in a session that is already the parent it only sets the count. Another
   argument that starts with a digit or a minus sign is refused with the range.
   Any other argument is refused with the usage. A refusal changes nothing.
   `start-foreman-passes-words-on.md` later replaced the refusal with the
   usage: other words now go to the parent's model as the person's prompt.
4. **Without the mod.** When the mod is not loaded, the model reads the
   skill's text. That text says the mod is not loaded, that nothing happened,
   and how to load it, and it tells the model to do nothing else.
5. **The wake skill is hidden.** `foreman:wake` sets `user-invocable: false`,
   so it no longer shows in the prompt box. The model still loads it when a
   wake line arrives.
6. **No pause.** The pause and the resume are removed: the commands, the
   `paused` word in the band, the stored flag, the remembered slot and their
   tests. A slot that frees always wakes the parent when a slot is free. A
   pause stored by the earlier version is ignored when it is read.

## Not verified by the gates

The gates do not read the `skills` folder. Whether the desktop app lists
`/start-foreman` without a warning, and whether the model still loads a skill
marked `user-invocable: false`, are checked by the owner in a new session
before the change merges.
