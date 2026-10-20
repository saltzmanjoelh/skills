# foreman

A Claude Code mod that lets one parent session see every `/implement` sub session at a glance. Builder writes a status file for each session that runs `/implement`, and foreman shows those files in a band above the prompt and in a pane. Pressing a sub session's issue opens that session beside the parent. In this version foreman only shows and opens sub sessions; it takes no action on them.

Install it from this repository's marketplace, together with builder, which it depends on:

```
/plugin install foreman --marketplace saltzmanjoelh/skills
```

To work on the mod itself, link this folder into the skills folder instead, with the path to your clone of this repository in place of the placeholder:

```bash
ln -s <path to this repository>/mods/foreman ~/.claude/skills/foreman
```

As with builder, use one way or the other, not both, because an installed copy takes precedence over a linked folder.

## Becoming the parent

Foreman does nothing in a session until that session runs `/foreman`. Every session that never ran it, sub sessions included, looks and behaves exactly as it does without the mod: the band is the host's own, no timer runs and no file is read.

| Command | What it does |
|---|---|
| `/foreman` | Makes this session the parent, reads the status folder at once and opens the pane. |
| `/foreman slots <n>` | Sets how many sub sessions this parent runs at once, a whole number from 1 to 20. Any other count is refused with the range and changes nothing. |
| `/foreman pause` | Pauses this parent. In this version it only adds `paused` to the band. |
| `/foreman resume` | Clears the pause. |

The role, the slot count and the pause are kept in the session's state and in the mod's store under the session's id, so a resumed session or a reload of the mod finds them again. Without `/foreman slots`, the count is the `slots` option in the mod's settings, which defaults to two. A slots, pause or resume command given before `/foreman` is kept and takes effect once the session becomes the parent.

## The status folder

Foreman reads `$CLAUDE_CONFIG_DIR/foreman/builds/` when that variable is set, and `$HOME/.claude/foreman/builds/` otherwise. It reads every file in that folder whose name ends in `.json`, keyed by the file name. It reads once when the role turns on, then 30 seconds after a read in which some sub session was working and its file was fresh, and 2 minutes after any other read. After a reload of the mod, the next session start, command, prompt or end of a turn arms the timer again from the saved time of the next read.

A file that does not parse as a status record, as one caught half written does, keeps the last good read of it from this session. A record counts as not parsing when it has no session id, no issue key field, or a state other than `working`, `waiting-on-builder`, `idle`, `needs-you`, `in-cleanup` and `done`. An issue key of null is valid: the session has not reported its first progress yet, and its row says `no issue yet` where the key would go. A file that leaves the folder leaves the list, and a missing folder reads as no sub sessions. Any other failure to list the folder keeps the rows from the last read and writes the reason to the log.

A file whose modification time is more than three minutes older than the read that found it is stale. A stale sub session is drawn dimmed and uncolored, with its last state and how long it has gone without an update, such as `working · no update for 5m`, and it still counts as busy.

## The band

The band is one row, in the parent only, such as `foreman: 2 of 2 slots busy · ABC-123 build · ABC-124 needs you · next read in 30s`. It counts every listed sub session whose state is not done as busy, adds `paused` while paused, and shows a chip for each sub session: its issue key with its stage while it works or waits on builder, or its state in words otherwise. Only `needs you` is red, and only `idle` and `in cleanup` are amber. When the chips do not all fit, the band ends with `+N more`. Pressing a chip opens that sub session.

## The pane

The pane has one row for each sub session, in issue-key order with the sub sessions that have no issue yet last. Each row has the issue key and its pull request as one button, such as `→ ABC-123 · #N open · checks passed`; the stage bar, drawn as builder draws its own, an image on the desktop and cells of text on the terminal; the state in words with its reason; and a Nudge and a Release button, which in this version only write a line to the log saying the action comes in a later step. Under the rows is the log, the last 20 lines of what foreman did, each with its UTC time. Every string a record holds is drawn as plain text, with control characters and escape sequences removed.

## Opening a sub session

Pressing a sub session's issue in the pane, or its chip in the band, shows that session beside the parent as a split, so the parent's band and pane stay on screen. Foreman uses the record's desktop session id when it has one. Otherwise it asks the desktop app for its sessions and takes the one whose folder is the record's folder. An open that worked writes a line to the log. One that did not shows a toast saying why, and writes the same line to the log: the record names no desktop session and no folder, no desktop session works in that folder, the desktop app's tools are not connected (as in a terminal session), the list of sessions could not be read, or the desktop app refused to open the session, which it does for a session this one did not start or while this session is not on screen. The desktop app's own error text is never repeated.
