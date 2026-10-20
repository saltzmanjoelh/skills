// The foreman mod's state contract: what $.state holds. Self-contained, as the
// engine requires.

// The parent's settings. `isOn` says this session ran /foreman and so is a
// parent. `slots` is the count /foreman slots set, or null when none was set,
// in which case the `slots` option applies. `isPaused` says /foreman pause is
// in force; in this step it only changes what the band says. Read through
// parentIn in hooks/parent.ts, which reads a value in any other shape as off.
export type ForemanParent = { isOn: boolean; slots: number | null; isPaused: boolean }

// The last good read of one status file: its name in the status folder, the
// text it held, and its modification time as the listing gave it then. The
// text is kept rather than the parsed record, so this contract stands alone
// and a hot reload keeps it; drawing parses it again through recordIn in
// hooks/record.ts.
export type ForemanFile = { file: string; text: string; mtimeMs: number }

// One line of what foreman did, with when it did it, in milliseconds since
// the epoch. `times` counts how often the same line came in a row, when it
// came more than once.
export type ForemanLogLine = { at: number; text: string; times?: number }

// Where a pairing stands: its slot is in use, freed because the sub session
// finished, or released by the person.
export type ForemanStanding = 'active' | 'freed' | 'released'

// What foreman has done for one pairing, so it does nothing twice.
export type ForemanActs = {
  // The owner record's current state and when it began, or null before the
  // owner was first read. `since` is the record's stateSince, or the read
  // that first saw the state when the record has none.
  episode: { state: string; since: number } | null
  // The idle stretch without progress: the progress it began with, written
  // as text, how many nudges went out, when the last one went, and whether
  // the parent was woken for it. Null outside such a stretch.
  stretch: { progress: string; nudges: number; lastNudgeAt: number | null; woke: boolean } | null
  // The episode, as `<state>@<since>`, that the needs-you notification and
  // the cleanup wake were last given for, or null.
  notifiedFor: string | null
  cleanupWokeFor: string | null
  // The file modification time that the gone wake was last given for, or
  // null.
  goneWokeFor: number | null
}

// One ticket this parent issued and the sub session paired with it.
export type ForemanPairing = {
  // `ft-` and a random UUID, added to the start_session brief.
  ticket: string
  // The desktop app's session id that start_session answered, or that the
  // owner record carried, or null while neither is known.
  localId: string | null
  // When start_session answered.
  pairedAt: number
  // The engine session id and the file name of the record that owns the
  // ticket, or null before one was joined.
  owner: string | null
  ownerFile: string | null
  // The owner record's issue key as last read, cleaned, so a log line can
  // name the sub session after its file has left. Null before one was read.
  issueKey: string | null
  standing: ForemanStanding
  // The session ids of other records with the same ticket, already logged.
  forks: string[]
  acts: ForemanActs
}

// Something to do outside the ledger: a nudge to a desktop session, naming
// the sub session for the log, or a notification with its text.
export type ForemanEffect = { kind: 'nudge'; ticket: string; to: string; name: string } | { kind: 'notify'; text: string }

// What foreman decided and has not yet carried out: log lines, effects, and
// lines that wake the parent. A read puts its decision here in the same
// update that records it, and carrying it out takes it back out, so a hot
// reload that drops the timer in between loses nothing.
export type ForemanOutbox = { logs: string[]; effects: ForemanEffect[]; lines: string[] }

// Every pairing of this parent, whether a slot freed while it was paused, so
// /foreman resume can wake the parent for it, and what is still to be
// carried out. `folderMissing` says the last read found no status folder, so
// the log says so once.
export type ForemanTickets = { pairings: ForemanPairing[]; freedWhilePaused: boolean; folderMissing: boolean; outbox: ForemanOutbox }

declare module 'claude-code' {
  interface PluginState {
    foreman: {
      // The parent's settings, kept in the store as well under the session's
      // id, so a resume finds them again.
      parent: ForemanParent
      // The last good read of each file the folder listed at the last read
      // that could list it, in file name order.
      files: ForemanFile[]
      // When the last read that could list the folder ran, or null before
      // the first. Whether a file is stale is judged against it.
      readAt: number | null
      // When the next read is due, or null when none is scheduled because the
      // role is off.
      nextReadAt: number | null
      // The newest lines of what foreman did, oldest first. Only the newest
      // 20 are kept.
      log: ForemanLogLine[]
      // The tickets this parent issued, kept in the store as well under
      // `tickets:<session id>`. Read through ticketsIn in hooks/tickets.ts.
      tickets: ForemanTickets
      // Whether a turn of the session's own loop is running, so a wake is
      // appended to it rather than submitted.
      turnRuns: boolean
    }
  }
}
