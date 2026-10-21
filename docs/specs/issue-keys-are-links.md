# Issue keys in foreman's and builder's band and pane are links

Date: 2026-10-21. It changes the drawing code of both mods
(`mods/foreman/hooks/pane.tsx` and `mods/builder/hooks/pane.tsx`), the
places where each mod starts a session (`hooks/register.tsx` in each), adds a
module that both mods hold a copy of (`hooks/links.ts`), and changes the
tests, the three READMEs and this repository's `.gitignore`.

## Goal

A parent session's job is to show what each sub session is working on, and
foreman's band and pane do that by issue key. Builder's band and pane show
the issue a session is working on too, as the start of its progress bar's
title. The person wants to go from "what is running" to the issue in one
click, so every issue key that the two mods draw in a band or a pane becomes
a link that opens the issue in its tracker. The mods are generic and know no
tracker, so the address comes from the project.

## Users and trigger

A person looking at foreman's band or pane in a parent session, or at
builder's band or pane in any session, in a project that names its issue
address. A project that names none sees everything exactly as it does today.

## Behavior

### The address

1. The address is a project fact, one line `Issue link: <address>`. Its
   value is the rest of the first line that starts with `Issue link:`,
   trimmed, with surrounding backticks removed, as builder reads its other
   facts with `factIn` in `mods/builder/hooks/review.ts`, with one
   difference: the value never runs past the end of its own line, so a bare
   `Issue link:` has an empty value rather than taking the next line or
   counting as missing. The address holds the placeholder `{key}`, for
   example `Issue link: https://tracker.example.com/issue/{key}`.
2. The fact is looked for in this order, and the first file that has it
   wins:
   - `CLAUDE.md` in the session's working folder;
   - `CLAUDE.local.md` in the session's working folder;
   - `CLAUDE.local.md` in the repository's main checkout, when the working
     folder is a git worktree of it.
3. The main checkout is found from the working folder's `.git`. When `.git`
   is a file of the form `gitdir: <path>`, the mod reads `<path>/commondir`,
   resolves it against `<path>` (it is usually `../..`), and takes the
   folder holding that common git folder as the main checkout. When `.git` is
   a folder, the working folder is the main checkout itself and the third
   place is the second. When `.git` is missing or cannot be read, or
   `commondir` is missing, there is no third place.
4. A fact is usable only when its address begins with `https://`, contains
   `{key}` at least once, and contains no white space and no control
   characters. The three are checked in that order, and the first that fails
   is the reason the fact is ignored. A usable fact in an earlier file wins even over a later one;
   an unusable fact in an earlier file also stops the search, so that a
   mistake in `CLAUDE.md` is not hidden by an older `CLAUDE.local.md`.
5. Builder reads the fact when its session starts (the `session.start`
   hook, from the session's working folder, as it reads its merge command),
   and keeps it in memory. Foreman does nothing in a session that is not a
   parent, so it reads the fact only at the start of a session that is a
   parent again from the store, and when a session becomes a parent through
   `/start-foreman`. `session.start` runs again after a hot reload, so a
   reload reads the fact again. The third place is read only when neither of
   the first two has the line. Drawing never reads a file.
6. An unusable fact is ignored, and the keys stay plain. What the person is
   told is under **Failure modes**.

This repository's own `CLAUDE.md` names no tracker, because its hard rules
forbid naming a project. Its address goes in a `CLAUDE.local.md` in the main
checkout, which this change adds to `.gitignore` first, so that the file can
never be committed by accident.

### Which keys become links

7. A key is put into a link only when it matches the issue-key shape
   exactly: an upper-case letter, then upper-case letters or digits, a
   hyphen, and digits (`^[A-Z][A-Z0-9]*-[0-9]+$`), the same shape foreman's
   wake line and builder's title split already use. A key of that shape holds
   only characters that are safe in an address as they are, so no encoding
   is needed. Every `{key}` in the address is replaced by the key.
8. Anything else is never put into a link and is drawn exactly as today,
   such as a sub session with no issue yet, or a builder title that does not
   begin with a key.
9. The link's text is the key, and the link's address is the built address.
   The engine's `Link` element draws it: an OSC 8 hyperlink on the terminal,
   or the text followed by the address in dim type on a terminal that cannot
   draw one, and an anchor on the desktop and the phone.

### Where the links are drawn

A `Button` may hold only strings and `Text`, and a drawing (`Svg`) cannot
hold a working link, so each key that sits inside a button or a drawing is
split out and drawn as its own `Link` directly before it. The button keeps
the rest of its text and its press.

10. **Foreman's band.** Each chip that has a link is the `Link` with the key,
    followed by a space as its own text, so that no surface can trim it,
    then the chip's button holding the rest of the chip's text (the stage or
    the state, and for a stale chip its age). The
    button keeps its press, which opens the sub session, and its color or
    dimness. The chips are fitted to the band's width exactly as today, by
    the length of the whole chip's text, key included.
11. **Foreman's pane.** Each sub session's row that has a link begins with
    the `Link` with the key, followed by the primary button labelled
    `→ #N state · checks …` (or `→ no pull request yet`), which still opens
    the sub session. A released row is drawn the same way.
12. **Builder's band and pane.** Builder's bar is drawn by the same code in
    both. When the bar's title begins with a key, as `issueOf` in
    `mods/builder/hooks/status.ts` finds it:
    - On the terminal, when the fitted text row still holds the title, the
      row is the `Link` with the key followed by the rest of the row as text.
      When `fitBar` has dropped the title because the width is short, the key
      is dropped with it and the row is plain, as today.
    - On a surface that draws the bar as a picture (the desktop, the phone
      and the editor), the `Link` is drawn on its own row directly above the
      picture, and the picture keeps its whole title.
13. **Without a usable fact,** every chip, row and bar is drawn exactly as it
    is today: the key stays inside its button or drawing, and no element is
    added or moved.

## Edge cases

- `abc-123`, `ABC-`, `ABC-12a`, `ABC 123` and a key with a space or an escape
  sequence in it are not keys, so they are drawn as today, with no link.
- A key longer than foreman's 40-character cut is cut by `printable` before
  it is checked, so the cut text, which ends with `…`, is not a key and is
  not linked.
- An address with `{key}` twice has both replaced.
- `Issue link:` with nothing after it is unusable, as is
  `http://…`, `javascript:…` or an address without `{key}`.
- `CLAUDE.md` with an unusable fact and `CLAUDE.local.md` with a usable one:
  the unusable one wins, so the keys stay plain and the person is told why.
- The working folder is a subfolder of a worktree rather than its top: there
  is no `.git` there, so only the first two places are read, as builder
  already reads `CLAUDE.md` from the working folder alone.
- A sub session in the parent's band works in another repository: foreman
  uses the parent's fact for every row, so its link may point at the wrong
  tracker (see **Non-goals**).

## Non-goals

- The log lines in foreman's pane stay plain text. The key already has a
  link in the sub session's own row of the same pane, and a log line can
  quote text from a record that is not the key of any issue.
- Toasts, desktop notifications, the wake lines foreman sends to the
  parent's model, and builder's second band row are strings or show no key,
  so nothing changes there.
- On a terminal that cannot draw OSC 8 hyperlinks, a band chip draws the
  address after its key, so the band may wrap or be cut by the terminal. The
  mod cannot tell which kind of terminal it is drawing on, so it fits the
  chips by the key's text, as today. This is a known limit.
- The fact is read once per session; a change to it shows in the next
  session, or after the mod reloads. A hot reload also shows the toast for
  an unusable fact again, and foreman's log then counts the line twice.
- An address longer than the engine's 2048 characters is drawn by the
  engine as plain text, without a toast from the mod.
- Foreman reads the fact from the parent's own working folder. It does not
  read a fact per sub session, so sub sessions in another repository share
  the parent's address.
- No tracker other than one whose issue address can be written with a single
  `{key}` placeholder, and no lookup of whether the issue exists.
- The bar's drawing on picture surfaces does not become clickable itself.

## Failure modes

- A fact that is present but unusable leaves the keys plain, and the mod
  says so once with a toast that names the reason and never the value, which
  can hold escape sequences and comes from a private file:
  `<mod>: the Issue link fact was ignored because <reason>`, where the reason
  is one of `it does not begin with https://`, `it has no {key}`, and
  `it holds spaces or control characters`. Builder shows its toast at
  session start. Foreman does nothing in a session that is not a parent, so
  it shows its toast, and writes the same line to its pane's log, when a
  session becomes a parent through `/start-foreman`, and at the start of a
  session that is a parent again from the store. A missing fact, or a usable
  one, shows no toast.

- The fact's file cannot be read (missing, too large, or refused): it counts
  as having no fact, and the search goes on to the next place.
- The main checkout cannot be found: only the working folder is read.
- Nothing in this change can stop a session from starting or a band or pane
  from drawing: every read is caught, and a failure means plain keys.

## Verification

- Unit tests of `links.ts`, in both mods: a usable address with one and with
  two `{key}`; each unusable address above; each non-key above; the order of
  the three places, including an unusable fact that stops the search; and
  finding the main checkout from a worktree's `.git` file and `commondir`,
  from a main checkout's `.git` folder, and with `.git` or `commondir`
  missing.
- A test holds foreman's copy of `links.ts` to builder's, as
  `mods/foreman/tests/art.test.ts` already does for `text.ts` and `art.ts`.
- Foreman's pane tests: the band and the pane drawn with and without a
  usable fact, checking that with it each chip and each row begins with a
  `Link` whose address is the built one and whose text is the key, followed
  by a button whose text no longer begins with the key and whose press still
  opens the sub session; that without it the trees equal today's; and that a
  row with no issue yet has no link.
- Builder's pane tests: the band and the pane on the terminal and on a
  picture surface, with and without a usable fact, with a title that begins
  with a key and one that does not, and with a width short enough that
  `fitBar` drops the title.
- Session-start tests in each mod that a fact in `CLAUDE.md`, in the
  working folder's `CLAUDE.local.md`, and in the main checkout's
  `CLAUDE.local.md` each reach the drawing.
- Toast tests in each mod: one toast with the right reason for each kind of
  unusable fact, and none for a missing or a usable fact; in foreman, the
  same line as the newest log line, and no toast in a session that is not a
  parent.
- The facts table in `README.md` and the facts sections of both mods'
  READMEs list `Issue link:` with its default, keys stay plain.
- The four gates in this repository's `CLAUDE.md` pass.

## Decided by the counsel

- Where should the issue-link address come from, so that this repository can have working links without its checked-in CLAUDE.md naming the tracker's workspace? The counsel chose: A project fact in the project's CLAUDE.md, and, when it has none, the same fact in a CLAUDE.local.md beside it, which this repository adds to .gitignore. The mods find CLAUDE.local.md in the repository's main checkout, because a worktree does not carry ignored files. 7 of 7 members voted for it.
- The engine refuses a Link inside a Button, and a drawing (Svg) cannot hold a working link. How should a key that today sits inside a button or a drawing become a link? The counsel chose: Split the key out: draw the key as its own Link element directly before the button, and the button keeps the rest of its text and its press. Foreman's band chip becomes the Link `ABC-123` followed by a button with the stage or state; the pane's issue button becomes the Link followed by a button `→ #N state · checks …` that still opens the sub session. Builder's bar on the terminal becomes the Link followed by the rest of the bar as text; on a surface that draws the bar as a picture, the Link is drawn on its own row just above the picture, and the picture keeps its title. 7 of 7 members voted for it.
- Foreman's pane log lines are plain text that often name a sub session by its issue key (for example "ABC-123 needs you"). Should the keys inside log lines become links too? The counsel chose: No: log lines stay plain text. The spec lists them under non-goals, because the key already has a link in the sub session's own row of the same pane, and a log line can quote text from a record that is not the key of any issue. 4 of 7 members voted for it.
- On a terminal that cannot draw OSC 8 hyperlinks, the engine draws a Link as its text followed by the address in dim type, so a band chip grows by the length of the address. How should foreman's band fit its chips? The counsel chose: Fit by the key's text only, as today. On a terminal with hyperlinks, which is the common case, the band looks exactly as it does now; on one without, a row may wrap or be cut by the terminal. The spec names this as a known limit, because the mod cannot tell which kind of terminal it is drawing on. 4 of 7 members voted for it.
- When the `Issue link:` fact is present but unusable (it does not begin with `https://`, has no `{key}` in it, or holds spaces or control characters), what should the person see? The counsel chose: Keys stay plain, and each mod shows one toast at session start saying the `Issue link:` fact was ignored and why (for example `builder: the Issue link fact was ignored because it has no {key}`). Foreman also writes the same line to its pane's log. 7 of 7 members voted for it.
