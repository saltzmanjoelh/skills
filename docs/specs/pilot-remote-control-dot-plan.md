# Plan: the pilot line and Remote Control

Spec: [pilot-remote-control-dot.md](pilot-remote-control-dot.md). Issue:
SAL-287. Written 2026-10-14.

Two plans competed: the simplest change, and the most robust one. The judge
chose the most robust plan and took three ideas from the simplest.

## Chosen approach

The change adds three documents under `docs/specs/` and nothing else: the
spec, this plan, and the upstream request
[pilot-remote-control-dot-upstream-request.md](pilot-remote-control-dot-upstream-request.md).
The request is text that leaves the company, so the plan guards against three
risks in it: that it leaks private detail, that it makes a claim that is
false or holds only for one version, and that it is too vague for the engine
team to act on.

The request:

1. Opens with the one-sentence ask: let a plugin read, and be told about
   changes to, whether Remote Control is on for its own session.
2. Says why: a status line above the prompt should tell the person, before
   they leave the desk, whether a phone can reach the session, and a wrong
   "on" is the worst outcome because they leave and cannot reach it.
3. Says what exists "as of Claude Code 2.1.299", with each of the three
   nearest sources and why it is not the state: the `/config` row
   `remoteControl`, `$.session.surfaces()` with its attach and detach
   events, and the origin kind `bridge`. Each claim is checked before it is
   written: against the engine types, except the `remoteControl` row, which
   only the Claude Code program holds.
4. Asks for a read, giving each state a one-line meaning: on, connecting,
   off, and unavailable.
5. Asks for an event carrying the new state, fired when the toolbar switch
   or `/remote-control` changes it, and when the connection drops and comes
   back.
6. Raises the cases the engine team must decide: what a subagent, a headless
   `claude -p` run and a cloud session answer (suggesting "unavailable"
   rather than "off"), and whether the read is right straight after a mod is
   reloaded.
7. Says what it does not ask for: no count of phones and no account details.

It uses the engine's own word, "plugin", rather than "mod", and names no
project, client, person, issue or repository.

## Grafts from the simplest plan

- **The steps after the merge are written down here** (step 5 below),
  because the spec's Behavior 4 depends on them.
- **The leak search includes the project name and leaves out "implement"**, so it
  catches a real project name and does not match ordinary English.
- **The request says a wrong "on" is the worst outcome**, which tells the
  engine team why "unavailable" must never be reported as "on".

## Rejected alternatives

- **Keeping the draft's phrase "matching the states the desktop app already
  reports".** Nothing a mod can read confirms it, and it is the likeliest
  false claim in the draft.
- **Searching the request for "client".** The request has to say that
  `surfaces()` lists the clients drawing the session, so the search would
  always match and would be ignored.
- **Keeping the word "mod" and explaining it.** A reader at Anthropic knows
  "plugin", which is the word the engine types use.

## Steps

1. Write the request file from the outline above, checking each "today"
   claim against
   `mods/pilot/.claude-plugin/types/claude-code/index.d.ts` as Claude Code
   2.1.299 writes it. The first gate on `main` does not write that file until
   SAL-285's change lands, so the check uses the copy that version wrote in
   the SAL-285 worktree. The `/config` row `remoteControl` is not in the
   types, whose row key is a plain string, so that claim is checked against
   the Claude Code program instead.
2. Run `grep -niE 'SAL-|<owner>|<project>|pilot|linear' docs/specs/pilot-remote-control-dot-upstream-request.md`
   and expect no output, then read the file whole.
3. Run the four gates in order.
4. Rebase on `origin/main`, confirm `git diff --stat origin/main` lists only
   the three files under `docs/specs/`, and open the pull request.
5. After the merge, mark SAL-287 done and file one new issue for the dot
   itself. It says it waits on Claude Code exposing the session's Remote
   Control state, and it links the merged pull request and the request
   file.

## Test plan

- **Only documents change:** `git diff --stat origin/main` after the rebase.
- **Nothing private in the request:** the search in step 2 prints nothing,
  and a reviewer reads the whole file, because no gate reads `docs/`.
- **The request's claims are true:** each claim about Claude Code 2.1.299 is
  matched to a line in the engine types, and the `remoteControl` row to its
  definition in the Claude Code program.
- **The mod is unchanged:** the mod's tests and `claude plugin validate`
  pass. The load gate and the type check fail on `main` for the reason
  SAL-285 tracks, and the report says so. It also says that the gates did
  not read the documents.
