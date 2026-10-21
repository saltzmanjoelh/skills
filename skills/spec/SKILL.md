---
name: spec
description: Short pre-feature interview (5-10 questions) that produces a verifiable spec in the project's spec directory. Use before building any nontrivial feature, when the user describes a feature they want built, or as the required input to /plan-tournament.
---

# Spec

Interview the user for 5 to 10 questions, then write a spec the implementation
can be verified against. The point is to capture decisions that would
otherwise be made silently in the middle of coding.

## Project facts

Read these facts from the project's `CLAUDE.md`. Each is either one
`Label: value` line anywhere in the file or a section under its own heading.
When a fact is missing, or there is no `CLAUDE.md`, use its default.

| Fact | Default |
|---|---|
| `Spec directory:` | `docs/specs/` |

In the text below, a directory fact stands for the directory without its
trailing slash, so that no path contains `//`.

## Interview rules

1. **One question at a time, and the counsel hears it first.** Put each
   question, with two to four concrete options, to the builder mod's counsel:
   call `mcp__builder__counsel`, then launch all seven counsel members (the
   six builder reviewers and `builder:owners-advocate`) in one message, each
   with "Counsel brief: <folder>.", wait for all seven, and call
   `mcp__builder__counsel_tally` with their votes. Follow what the tally
   answers. Apart from a question about how the person works, below, which
   never goes to the counsel, only a question the counsel does not decide
   reaches the person, through AskUserQuestion with a single question per
   call and the vote attached as the tool's answer gives it. If the counsel
   tool says the counsel cannot sit, or the builder mod is not loaded, so that
   `mcp__builder__counsel` or the `builder:` agent types do not exist, ask the
   person directly and say so. The tool may be deferred, so look for it with
   ToolSearch before deciding it is missing. The interview
   never passes `pull_request` to the counsel tool, so its decisions always
   go in the spec, even while an earlier pull request is still watched. A
   question about how the person works is one whose answer is a habit or a
   choice of theirs, such as whether they ever clear a session, run two
   copies of a tool at once or work offline, rather than a fact the code,
   the specs or the issue can settle. When nothing the person has written
   down settles it (their global `~/.claude/CLAUDE.md`, the project's
   `CLAUDE.md`, the specs and the issue), ask the person directly through
   AskUserQuestion, because the counsel's members can read only what the
   person wrote down. Never guess the answer, and never write the spec to
   cover the case to be safe. The 5 to 10 questions count every question
   put, whoever answered it.
2. **Follow the thread, not a checklist.** When an answer is vague or
   surprising, dig into it before moving on. Ask for the concrete case behind
   an abstraction, and do not accept "it depends" without asking "on what?".
3. **Push back on contradictions** ("you said X earlier, but this implies Y").
4. **Do not re-ask what is already written down.** Before the first question,
   read the existing specs in `<spec directory>`, and run `git worktree list`
   and read the spec directory of each sibling worktree too: the feature may
   already be specced or built on another branch.
5. **Seed from a ticket when given one.** If the argument is an issue id or
   URL, read the ticket and its comments through the connected tracker, treat
   them as already answered, and ask only about the gaps. Name the issue in the
   spec header.
6. Convert relative dates to absolute ones.

## What to cover (pick the 5 to 10 that matter)

- Who hits this path and what they are trying to do.
- The worst input or weirdest state it must survive.
- What is explicitly out of scope. The interview always covers this one and
  never skips it.
- What failure looks like to the user (error behavior, partial completion).
- What is stored, what is derived, and any migration implications.
- How we will know it works: observable behavior, not impressions.

## Output

Write `<spec directory>/<feature-slug>.md` in the project with these sections: Goal,
Users/Trigger, Behavior, Edge cases, Non-goals, Failure modes, Verification.
Date it. Non-goals is required and never empty: it lists the edge cases and
follow-ups the change deliberately leaves out, so that reviewers have a
written reason to stop. When the counsel decided any question, add a section
headed "Decided by the counsel" with one line per decision: the question, the
option chosen and the count, such as "5 of 6". If the person overturns a
decision by telling the session, their answer is final: change the spec to
match and drop that line. When the person answered a question about how they
work, add a section headed "Decided by the person" with one line per answer,
giving the question and the answer. Then offer the person one line, in
generic words that name no project, to add to their personal global
`~/.claude/CLAUDE.md`, and write it there only when they say yes. Keep it short: do not write sentences that merely count the
document's own parts, and when a statement turns out wrong, edit it rather than
adding a paragraph that narrates the correction. End by offering the next
step: implement directly, or `/plan-tournament` for a nontrivial feature.
