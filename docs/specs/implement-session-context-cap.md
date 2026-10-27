# An implement session's context stays under a cap

Written 2026-10-27.

## The incident

On 2026-10-26 one working day used most of a week's plan allowance. When the
day's transcripts were added up, the largest share was not the reviewer
agents. It was the `/implement` sessions themselves. Two of them, four days
old, had been running at 600,000 to 900,000 tokens of context, and every call
in them re-read that whole prefix as a cache read. Every wake the builder mod
started, including the ones that only acknowledged one reviewer's report,
began a turn at that size. Those two sessions alone were about two fifths of
the day. A third session of the same kind had been handed to a background
agent; it grew to about 860,000 tokens and rewrote its cache on every wake.

The sessions never compacted because the engine compacts on its own only
near the model's window, which for the models in use is one million tokens,
so the threshold sat near 967,000. The sessions never got there. The engine's
idle compaction, which prepares a summary about an hour after a session's
last call when the context is above 200,000 tokens, only helps a session
that sits idle that long with the machine awake, which a working session
does not.

Measurements on 2026-10-27 with Claude Code 2.1.308 settled what the mod can
and cannot do about it:

- A `autoCompactWindow` key in the person's user settings is honored by
  sessions started from the command line and by the desktop app: the engine
  then measures against that window and compacts on its own at the window
  minus its 20,000-token buffer. A session that was already running when the
  key was written keeps its old window.
- The engine's direct compaction call for mods is refused in any headless
  session, which the desktop app's sessions are. The mod cannot compact that
  way.
- The mod can run the `/compact` command through the engine's command call
  from its turn-end hook, with its own instructions as the command's
  arguments. The compaction then runs at once as its own turn, the
  compaction event fires with those instructions, and a hook on that event
  can rewrite them. In a desktop session it took 8 seconds and read the
  conversation mostly from the cache.
- After a compaction the engine attaches the skill text again only in part,
  so a session that carries on from the summary alone works from a truncated
  skill.

## Goal

An `/implement` session's context never grows past a ceiling. Compaction
happens at the end of a turn, while the conversation is still in the cache,
never in the middle of a review round, and the summary keeps the facts the
session needs. After a compaction the session reloads its skill and carries
on without asking the person anything.

## Users and trigger

A person running `/implement` sessions in the desktop app, several at a time,
for days. The trigger is any session whose context reaches the ceiling, which
on the day measured was every session that lived longer than a few review
rounds.

## Behavior

1. **The ceiling is the engine's compaction window.** The mod reads the window
   the engine compacts against, and its source, from the engine's usage
   figures; it never hardcodes the model's window. When the person has set
   the window, in settings or through the environment, that is the ceiling.
   When the engine reports the model's default, the ceiling is 300,000
   tokens, so the cap works before anyone edits a settings file. 300,000
   leaves about 170,000 tokens of working room above the fixed prefix, which
   is about 130,000 tokens in a session that has the mod, the skills and a
   large project instruction file loaded. A lower ceiling would compact every
   few turns, and each compaction costs a summary call plus one cache write
   of the whole new prefix.
2. **The mod compacts at the end of a turn.** When one of the session's own
   turns ends with an answer or a refusal, and the context measured after it
   is at or above 85 percent of the ceiling, the mod runs the `/compact`
   command through the engine's command call, with the instructions of
   point 4, before it hands over any change it held during the turn and
   before any other turn starts. 85 percent of 300,000 is 255,000, which is
   under the engine's own threshold of 280,000, so the mod's compaction, at a
   clean boundary, happens first, and the engine's threshold stays as the
   backstop for a single turn that grows past it. A turn that ended in an
   error never compacts, because a usage-limit hold is one such error and
   the summary itself needs a model call. Once the pull request is merged or
   closed the mod compacts no more, because the session is about to clean up
   and archive.
3. **Nothing is handed over while the mod compacts.** From the moment the mod
   runs the command until it returns, a held change, a poll's change, a stuck
   prompt and a CI event wait, as they wait for a running turn today. The
   command returns only when the compaction has finished, so the next turn
   starts on the compacted conversation.
4. **The summary keeps the mod's facts.** A hook on the compaction event
   rewrites the instructions of every compaction of the main conversation,
   whoever started it: the mod, the engine at its threshold, the engine's
   idle compaction, or the person with `/compact`. It leaves a subagent's
   compaction alone. The instructions begin with the engine's own or the
   person's, when there are any, and add, from the mod's state: the issue's
   title and stage as last reported to the mod; the pull request's number,
   head, state, verdicts and labels; the worktree path and branch; the heads
   reviewed in the current round and which reviewers ran at the current head;
   the counsel question open, if any, and the decisions still owed; the
   agents running and what each was launched for; and the instruction that
   the summary keeps every rule the person gave the session in conversation
   and the list of what is left to do. The spec and plan paths are not in the
   mod's state, so the instructions say to keep them and, failing that, that
   they are read from the spec directory on the branch.
5. **The next prompt says to reload the skill.** The mod remembers that the
   main conversation was compacted since the last prompt it submitted,
   whoever compacted it, and the next prompt it submits, whether a change
   prompt, a stuck prompt, a resume prompt or a CI event's context, begins
   with a line saying so, telling the session to load the `implement` skill
   again with the Skill tool before it acts, to read the pull request's state
   with `mcp__builder__watch`, and to read the spec and plan paths from the
   spec directory on the branch when the summary lost them. In that prompt
   the change prompt's closing line no longer says not to reread what the
   session already knows; it says to reread what the summary does not hold.
   A compaction the engine prepared ahead of time counts as one that will
   stand at the next turn, so the line is added for it too.
6. **The skill says what to do after a compaction.** `skills/implement/SKILL.md`
   gets a short section, next to "Resuming", for a session that finds a
   compaction summary at the top of its context, whether or not a prompt from
   the mod told it so: load the skill again, since the engine attached it only
   in part; the pane, Remote Control and the watch are still there, so do not
   repeat step 1; read the state with `mcp__builder__watch`; read the spec and
   plan from the spec directory on the branch; then enter the list from the
   top as "Resuming" says, counting the first half as run at a head only when
   a verdict review at that head names the focused reviewers that ran.
7. **The pane and the line above the prompt show the context.** Both show the
   context size after the last turn and the ceiling, as whole thousands,
   `context 212K of 300K`, and the pane adds where the ceiling came from:
   `settings`, `environment` or `default`. A session whose ceiling is the
   default also sees, once, in the pane, which settings key sets the engine's
   own threshold.

## Edge cases

- **The person compacts by hand.** The hook adds the facts, the next prompt
  carries the reload line, and the mod's own threshold is measured against
  the compacted size.
- **The engine compacts in the middle of a turn** (a single turn that grew
  past 280,000). The facts are kept by the hook; the turn continues as the
  engine makes it continue; the mod's next prompt carries the reload line.
- **Reviewers or the counsel are running when the mod compacts.** Their
  reports arrive as new messages after the compaction; the summary names
  them and what they were launched for, so the session knows what each
  report answers.
- **A change arrives during the compaction.** It is handed over when the
  command returns, as a change found during a turn is handed over at the
  turn's end.
- **The compaction leaves the session above the threshold** (a very large
  summary). The mod does not compact again until another turn has ended, so
  two compactions never run back to back.
- **A restart.** Nothing about compaction survives a restart; a resumed
  session starts from "Resuming" as today.
- **The usage figures are missing** right after a compaction, where the
  engine reports no token count until the next response. The mod then
  compares the breakdown's own total instead, and when neither is there it
  does nothing until the next turn ends.

## Non-goals

- The size of the fixed prefix every session and agent pays: the project
  instruction files, the skill listing and the tool schemas. A separate
  change measures and trims those.
- The reviewers' model, how many focused re-reviews a pull request gets
  after both verdicts approve, and the fence that stops `/implement` from
  running inside a subagent. Each is its own change.
- Compacting a subagent's own conversation.
- The foreman mod's parent session, which grows the same way. It gets the
  same rule in a follow-up once this change has run on a real pull request,
  because its facts are different and its hooks are in a different module.
- Changing when the engine's idle compaction runs.
- Writing the settings key for the person. The mod reads it and names it; the
  person sets it.

## Failure modes

- **The command call fails** (the engine refuses it, or the summary's model
  call fails). The mod records the failure in the pane, hands over whatever
  it held as if no compaction had been attempted, and tries again at the next
  turn end that is above the threshold, never more than once per turn end.
- **The usage figures cannot be read.** The ceiling falls back to 300,000 and
  the pane says so; a turn end whose size cannot be measured never compacts.
- **The prompt after a compaction is refused.** It is retried as the change
  prompt is retried today, and the reload line stays on it until one is
  accepted.
- **The skill is not reloaded** (the session ignores the line). The pane's
  context line still shows the compaction happened; the person can type
  `/implement --resume #N` in the same session, and "Resuming" covers it.

## Verification

- A test: a turn that ends with an answer at or above 85 percent of the
  ceiling runs the compact command once, with instructions that name the
  pull request's number and head, the stage, the worktree and the reviewers
  that ran; a turn below the threshold runs nothing; a turn that ended in an
  error runs nothing at any size; after a merge nothing runs. Each fails if
  its rule is removed.
- A test: the ceiling is the engine's window when its source is settings or
  the environment, and 300,000 when the source is the model's default.
- A test: a change held during the turn is handed over after the command
  returns, not before, and a poll during the compaction waits.
- A test: the compaction hook rewrites the instructions of a main-conversation
  compaction for each trigger and leaves a compaction that carries an agent
  id untouched.
- A test: the first prompt the mod submits after a compaction begins with the
  reload line and ends with the reread line, and the prompt after that does
  not.
- Tests on the pane's and the line's context text, including the source
  words and the once-only settings hint.
- The gates: load both mods, `tsc`, `claude plugin test`, `claude plugin
  validate`, from `mods/builder` and `mods/foreman`.
- Reading `skills/implement/SKILL.md`: the new section after "Resuming" says
  to load the skill again, not to repeat step 1, to read the state and the
  spec and plan paths, and to enter the list from the top.
- One real run before the change merges, reported in the pull request:
  an `/implement` session on a real issue with the change loaded, its
  transcript read afterwards for the largest input of any call, which stays
  under the ceiling, the number of compactions, and what the session did in
  the turn after each compaction. That run also confirms what the engine
  attaches of the skill after a compaction, which was observed once and not
  reproduced.

## Not verified by the gates

The gates do not read the `skills` folder, so the new section of the skill is
checked only by its reviewers and by the real run above.

## Decided by the person

The owner decided these three questions directly on 2026-10-27, without the
counsel, because the change is part of cutting the sessions' own usage.

- At what size the mod compacts: at 85 percent of the ceiling, at the end of a
  turn, rather than a lower fraction, so the mod's compaction at a clean
  boundary stays ahead of the engine's own threshold while compacting as
  rarely as the ceiling allows.
- What the mod does on a machine with no settings key: it caps at 300,000
  tokens on its own and names the key in the pane, rather than doing nothing
  until the key is set.
- Whether the foreman mod's parent session is part of this change: no, it is a
  follow-up once this change has run on a real pull request.
