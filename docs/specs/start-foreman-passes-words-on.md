# /start-foreman passes the words after it to the parent's model

Written 2026-10-21. It changes the third behavior of
`start-foreman-command.md`, which refused any argument other than a slot
count.

## The incident

The owner typed `/start-foreman 2` followed, on the same line, by what they
wanted the new parent to do first: clean up the old worktrees and local
branches, then start the next two issues. Foreman answered with its usage line
and did nothing. The session did not become the parent, the slot count was not
set, and the instructions never reached the model, because foreman answers the
command itself and a command's output goes to the person, not to the model.
The owner had to ask what had happened before trying again in two steps.

## Behavior

1. **A count, then words.** When the first word after `/start-foreman` is a
   whole number from 1 to 20, the command does what `/start-foreman <n>` does,
   and every word after the count is the person's prompt.
2. **Words without a count.** When the first word does not start with a digit
   or a minus sign, the command does what a bare `/start-foreman` does, and
   every word is the person's prompt. The forms that used to be refused with
   the usage line, such as `/start-foreman pause`, now take this path, so the
   usage line is gone.
3. **A refused count sends nothing.** When the first word starts with a digit
   or a minus sign but is not a whole number from 1 to 20, the command is
   refused with the range as before, nothing changes, and the words after it
   are not sent.
4. **The prompt goes in after the role is on.** The words go to the parent's
   model as the person's own prompt, with no plugin frame, only after the
   session is the parent, so the model reads them as the parent and loads the
   wake skill for any start they ask for. They are submitted from a timer,
   because the engine refuses a prompt submitted from inside a command's hook.
   A refusal of that prompt leaves a line in foreman's log, and so does a
   session that did not become the parent, in which case the words are not
   sent.
5. **The person's words come before foreman's.** The first read of the status
   folder can find work, such as a free slot, that wakes the model with a line
   of foreman's own. The person's words reach the model before any such line,
   so that a parent told to clean up first does not start an issue before it
   has read that.
6. **The answer says so.** The command's answer ends with a sentence saying
   that it passes the rest of the line on as the person's prompt.
7. **Without the mod.** The skill's text tells the model not to act on words
   after the command when the mod is not loaded, and to ask the person to send
   them again once it is.

## Not verified by the gates

The gates do not read the `skills` folder. Whether the desktop app delivers
the prompt to the parent's model after the command's answer is checked by the
owner in a new session after the change merges. The engine says that a
plugin's prompt does not expand `@file` mentions or pasted images, and it does
not say whether it runs a slash command at the start of the words, so words
such as `/implement ABC-123` may reach the model as text rather than run.
