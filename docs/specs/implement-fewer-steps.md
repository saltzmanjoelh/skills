# An implement session takes fewer, larger steps

Written 2026-10-30.

## The incident

The builder mod's pane showed an `/implement` session that had spent 53.5
million cache-read tokens and 2.9 million cache-write tokens, about $35, while
its context sat at 186,000 tokens. The session's transcript covered 55 minutes
and 218 model calls. Those calls read 39.1 million tokens from the cache and
wrote 0.76 million.

The cache itself was working well. Writes were about 2 percent of reads, and
the four largest writes came right after the four compactions, where the
summary has to be cached fresh. The cost came from arithmetic instead: every
tool call ends with the whole conversation sent to the model again, and the
average context per call was 183,000 tokens. 218 calls times 183,000 tokens is
about 40 million, which matches the total.

Most of those calls were small. The median call wrote 365 tokens of output.
The main session ran 37 `grep`, 29 `sed`, 29 `cd`, 16 `ls` and 16 `cat`
commands, mostly one at a time, and each one paid for a re-read of roughly
200,000 tokens. A run of four dependent-looking lookups that could have been
asked for together, such as listing a folder, reading a file, searching it and
reading the lines around the match, cost about 800,000 tokens of cache reads
for a few hundred tokens of information.

## Goal

The session spends fewer model calls on lookups in its own large context,
without being asked to write more complicated commands, and without building
code on an agent's summary that nobody checked.

## Behavior

1. **Independent lookups go out together.** When the session already knows
   several things it needs to look at and none depends on another's result,
   it requests them as separate tool calls in one response, preferring Read
   and Grep over shell commands. The calls come back together, so the
   conversation is re-read once instead of once per lookup.
2. **A longer investigation goes to an agent.** An investigation that needs
   more than a few lookups runs in an agent, whose small context makes each
   search and each retry cheap, and the session keeps only the answer. A
   single lookup stays in the session, because starting an agent costs more
   than one step. The brief asks for file paths, line numbers and the exact
   text that matters, so that the session does not repeat the search to
   recover a detail the report left out.
3. **The session checks an agent's answer before acting on it.** The report
   is a map of where to look, not proof of what is there. Before the session
   changes code, or settles a finding, a test failure or a claim such as
   "nothing else calls this" because of an agent's answer, it reads the lines
   that answer names, in one batched step. When the answer leaves out
   something the decision depends on, the session reads it directly rather
   than guessing.

Both rules go at the end of the Rules list in `skills/implement/SKILL.md`.

## Non-goals

- Joining shell commands with `&&` or `;`. The rules neither ask for it nor
  forbid it; see "Decided by the person".
- The compaction ceiling, which sets how large the context gets before it is
  compacted. That is the larger lever on the same cost, and it has its own
  spec (`docs/specs/implement-session-context-cap.md`).
- Why a compaction can return without compacting, which the pane reported
  for the same session. That is a separate change.
- The cost of the agents themselves, each of which caches its own setup once.

## Failure modes

- **The session acts on a wrong summary.** Claude Code already refuses an
  edit to a file the session has not read, but nothing else stopped a
  decision made from a summary alone, and a test or a reviewer would catch
  the result only by luck. Rule 3 exists for this.
- **The session delegates a single lookup.** Starting the agent costs more
  than the step it saves. Rule 2 says a single lookup stays in the session.
- **The session skips a lookup it needed.** The rules change how lookups are
  grouped and where they run, not whether they happen.

## Verification

Reading `skills/implement/SKILL.md`: the end of the Rules list has the two
rules, the second rule tells the session to read the lines an agent's answer
names before acting on it, and neither rule mentions joining shell commands.

A later measurement of a real `/implement` session's transcript, counting its
model calls and their average context, shows whether the number of small
lookups in the main session went down.

## Not verified by the gates

The gates do not read the `skills` folder or `docs/specs`, so this change is
checked only by its reviewers.

## Decided by the counsel

- Should the two draft rules at the end of the Rules list in skills/implement/SKILL.md (batch independent lookups as separate tool calls in one response and never join shell commands with && or ;, and hand any investigation needing more than a few lookups to an agent) be adopted as written, and could they cause problems or lead to worse code being built? The counsel chose: Adopt both rules with changes that guard against acting on a subagent's summary without checking the code it names. 6 of 7 members voted for it.

## Decided by the person

- After the counsel's decision, the owner removed the draft's ban on joining
  shell commands with `&&` or `;`, because sessions use joined commands and
  find them useful. The clarification that a command the project gives runs
  exactly as written went with it, because it existed only to keep the ban
  from splitting the gate command.
