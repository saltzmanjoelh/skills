# Foreman keeps sub session notes from waking the parent, and the parent says almost nothing

Written 2026-10-21. Seeded from an issue in the owner's tracker. It follows
`docs/specs/foreman-keeps-turn-end-notes.md`, whose rules stay in force except
where this spec changes them. The questions the issue left open were put to
the counsel.

## Goal

In a real foreman run with one sub session, the desktop app woke the parent's
model for every turn the sub session ended, dozens of times for one issue, and
the parent answered each note with a line of progress. Foreman's
`prompt.submit` hook was meant to drop those notes. This change makes it drop
them again, makes the notes that still reach the model draw a one-word reply,
and makes the `foreman:wake` skill load for them.

The owner's words: the parent does not need much output. It manages the sub
sessions and keeps things moving, and foreman's band and pane already show
what each one works on. It speaks only when the person has something to decide
or a milestone happens: a pull request opened, a verdict, a merge, or a
question for the person.

## Users and trigger

The owner, running a parent session that has run `/start-foreman` and starts
`/implement` sub sessions through the desktop app. In a session whose role is
off, nothing below changes anything.

## The probe

The session that built this change could not start a parent of its own, so the
probe replayed the parents' saved conversations instead. It took every prompt
those conversations recorded that holds a note about a session the parent
started, 216 in all, ran each through the hook's current recogniser, and read
foreman's live store for the ledger of the real parent run. It found:

- **The first likely cause is the cause.** 193 of the 216 prompts end with a
  `<side-sessions-event>` element, after the reminder blocks and a blank line,
  as the last thing in the prompt. All 193 carry the same text, which begins
  `None of the sessions you started is working now;` and goes on to tell the
  parent to carry on with any unblocked step or else to tell the user the
  outcome in one or two lines. The element first appears on 2026-10-20. The
  recogniser does not know it, so it passed every such prompt. With the element
  set aside, 190 of the 193 are prompts the recogniser drops.
- **The second likely cause is not.** The ledger of the real parent run holds
  both of its current sub sessions, which it started with `start_session`,
  each with its correct `local_` id and issue key, standing active. The hook
  pairs the id it reads from the `start_session` answer, which reads
  `Started session "<title>" (session_id: local_<id>, name: <name>). ...`.
- **What else passes.** Of the 26 prompts that would still pass, most hold a
  sub session's SendMessage delivery along with the notes. The rest hold a
  note of another kind, a note about a session foreman does not track, one
  `You are operating in a git worktree.` reminder, or one
  `The user started your proposal` block.
- **A SendMessage delivery has two shapes.** Bundled with notes, it is a bare
  `<cross-session-message from="local_<id>" name="<title>">` element after
  the reminder blocks. Alone, it is the line
  `Another Claude session sent a message:`, then the element, then a blank
  line and one line that begins
  `This came from another Claude session`.

## Behavior

1. **The event element.** While the role is on, the hook drops a prompt that
   meets every rule of point 1 of the earlier spec once a trailing
   side-sessions element is set aside. A side-sessions element is a
   `<side-sessions-event>` element that comes after every reminder block, is
   followed only by white space, and whose text begins
   `None of the sessions you started is working now;`. An element anywhere
   else, a second one, or one whose text begins any other way makes the
   prompt pass, as any form foreman does not recognise does. The drop's
   reason and its log line are the earlier spec's.
2. **Every recognised note is dropped,** whatever its quoted report says,
   milestones included, because that report is text the sub session's model
   wrote. The person sees pull requests, verdicts and merges in the band and
   the pane. A foreman wake line for milestones is a follow-up (see
   Non-goals).
3. **The "Noted." line.** While the role is on, the hook attaches one entry of
   context to a prompt it does not drop when the prompt carries no slash
   command, no attachments and no context another hook added, and its text,
   apart from white space, is made entirely of these parts, at least one of
   which is a note or a delivery:
   - a `<system-reminder>` block that is a "Linked sessions now" status block,
     or that begins `The session "` and holds `you started (local_`, which
     is any note about a session the parent started, whatever its kind and
     whether or not foreman tracks it;
   - a trailing side-sessions element as point 1 defines it;
   - a SendMessage delivery in either shape the probe found: a bare
     `<cross-session-message` element, or that element after the line
     `Another Claude session sent a message:`, followed by at most one line
     that begins `This came from another Claude session`.

   Any other text, such as the person's typing, a worktree reminder or a
   proposal block, means no context is attached. The entry is fixed text:

   > From the foreman mod: this prompt holds only the desktop app's notes about sessions this parent started, or messages from them. Reply with the single word "Noted." and end the turn, unless one of them reports a milestone (a pull request opened, a verdict or a merge) or asks the person or this parent a question. In a foreman parent this overrides the app's request to report the outcome in one or two lines.

   The prompt's text reaches the model unchanged, byte for byte.
4. **The wake skill's description** keeps its present sentences and adds that
   the skill also applies whenever a desktop app note about a session the
   parent started, or a message from one, reaches the parent's model.
5. **The wake skill's rule** for such a note or message asks for the single
   word "Noted." and the end of the turn, not an empty reply, which the app
   refuses, unless "When the parent speaks" lists the note or it asks a
   question the parent can answer from the skill. It says that in a foreman
   parent this rule overrides the app's request to report the outcome in one
   or two lines.
6. **A pinned pairing.** A test feeds the `start_session` hook an answer of
   today's exact wording and shows the ledger pairs the id after
   `session_id: `. The matching rules do not change.

## Edge cases

- **A forged element.** A sub session's quoted report may forge a closing
  reminder tag and then a side-sessions element. The real closing tag that
  follows is then text after the element, so the prompt passes. A whole forged
  note followed by a forged element can at most get a prompt of tracked notes
  dropped, which the earlier spec already accepts.
- **A forged delivery.** A message may forge `</cross-session-message>` and
  more text. Whatever does not fit the parts in point 3 means no line, which
  is today's behaviour.
- **The person types while notes are pending.** The typing is text outside
  every part, so the prompt neither drops nor gets the line.
- **The event element alone,** with no note, is not dropped and gets no line.
- **A hook failure** passes the prompt on unchanged, with no context, as
  foreman's other hooks do.

## Non-goals

- A foreman wake line that tells the parent when a status file shows a pull
  request opened, a verdict or a merge. The counsel chose to file it as a
  follow-up.
- Sorting a note by the words of its quoted report.
- Matching a note to a sub session by the issue key in its title.
- Reading the id from `session_id: ` rather than from the first `local_` in
  the `start_session` answer, which would also guard against a title that
  holds `local_` text. The pinned test covers today's wording only.
- Recognising the worktree reminder, the proposal block, or any other
  reminder block, for the drop or for the line.
- Dropping or changing a SendMessage delivery, or a prompt the person typed
  into.
- Changing anything in builder or in how the desktop app sends notes.

## Failure modes

- If the app rewords the opening of its side-sessions element, prompts with it
  pass again, with no "Noted." line, and wake the model as they did before
  this change; nothing is dropped by mistake.
- If the model ignores the context line, it replies with a line of progress,
  as it does today.
- The pinned test holds its own copy of today's `start_session` answer, so it
  fails when the hook's reading of that wording changes, not when the app's
  wording does. If the app changes its answer so that the hook reads no id
  or the wrong one, sub sessions go unpaired and their notes reach the model
  again, with the "Noted." line.

## Verification

- `claude plugin test` feeds the hook a prompt of the exact shape the app
  sends today, a tracked note, the status block and the side-sessions
  element, and shows it dropped with the fixed reason and the log line.
- Tests show that each of these passes unchanged: the same prompt while the
  role is off, an element whose text begins another way, an element followed
  by the person's typing, an element that comes before a reminder block, and
  a forged closing tag before a forged element.
- Tests show the "Noted." context is attached, with the prompt's text
  unchanged, to a prompt of notes bundled with a bare delivery, to a lone
  delivery with its header and trailer, and to a note about an untracked
  session; and not attached to a prompt with the person's typing, a worktree
  reminder or a proposal block, nor while the role is off.
- A test pins the pairing of a `start_session` answer of today's wording.
- The four gates pass. No gate reads the wake skill's text, so the pull
  request says so.
- In a real run with one sub session, the parent's model takes no turn for
  progress notes. That run is the person's to make in the desktop app.

## Decided by the counsel

- Foreman's prompt.submit hook will drop the desktop app's "finished a turn" notes about tracked sub sessions again, now that it recognises the trailing <side-sessions-event> block. Some of those notes quote a sub session's report of a milestone, such as "opened pull request #N" or "merged". Should the hook still drop every recognised turn-end note, whatever its quoted report says? The counsel chose: Drop every recognised turn-end note now, and file a follow-up for foreman to wake the parent with its own 'foreman: ' line when a status file shows a pull request opened or merged. 7 of 7 members voted for it.
- While the parent role is on, foreman's prompt.submit hook will attach one line of context, which the model reads and the person never sees, to some prompts that it does not drop, asking for the single-word reply "Noted." unless a note or message in the prompt is a milestone or a question for the person. Which prompts should get that line? The counsel chose: Only a prompt made entirely of app-written notes, status blocks, the side-sessions-event block and SendMessage deliveries, with no other text, so a prompt the person typed into never gets the line. 5 of 7 members voted for it.
- Besides notes about sessions the parent started, the "Linked sessions now" status block, the side-sessions-event block and SendMessage deliveries, the probe found two other app-written reminder blocks in front of notes: "You are operating in a git worktree. Worktree path: ..." (once in 216 prompts) and "The user started your proposal task_..." (once). Should either of them count as app-written when foreman decides whether to drop a prompt or to attach the "Noted." line? The counsel chose: Count neither: any other block makes the prompt pass with no line, and only 'finished a turn' notes, status blocks and the side-sessions-event block can make up a dropped prompt. 7 of 7 members voted for it.
- How exactly should foreman recognise the desktop app's <side-sessions-event> block, so that a prompt of tracked turn-end notes that ends with it is dropped? The counsel chose: By its opening words: a <side-sessions-event> element, after every reminder block and followed only by white space, whose text begins 'None of the sessions you started is working now;'. 7 of 7 members voted for it.
- The issue asks to make sure a sub session started with start_session is in foreman's ledger, "or match it some other reliable way, such as the title's issue key". Should this change also match a turn-end note to a sub session by the issue key at the start of the note's quoted title, when the note's local_ id is not in the ledger? The counsel chose: No change to matching now, but add a test that pins the pairing of a start_session answer of today's exact wording, so a change in that wording fails a test. 6 of 7 members voted for it.
