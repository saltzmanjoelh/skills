// The foreman mod's state contract: what $.state holds. Self-contained, as the
// engine requires.

// The parent's settings. `isOn` says this session ran /start-foreman and so
// is a parent. `slots` is the count /start-foreman <n> set, or null when none
// was set, in which case the `slots` option applies. Read through parentIn in
// hooks/parent.ts, which reads a value in any other shape as off.
export type ForemanParent = { isOn: boolean; slots: number | null }

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
  // the parent was woken for it. Null outside such a stretch. `wait` is null
  // for a stretch of an idle record, and the `since` of the record's
  // background-only wait for a stretch of a working record that waits only
  // on background work, so a change from one wait to another starts a fresh
  // stretch. `countFrom` is the read that progress started a background
  // stretch afresh at, inside the same wait, whether that read found the
  // wait or a turn of the sub session's own, so the count runs from that read
  // rather than from the wait's start; it is null for an idle stretch and for
  // a stretch that began with its wait, and the end of a sub session's turn
  // moves it later too (see `turnProgress`). `turnProgress` is true when the
  // stretch last started from progress that foreman saw in a turn of the sub
  // session's own, so the end of that turn restarts it even when a nudge
  // started the turn; a stretch stored before foreman kept it reads as false.
  stretch: { progress: string; nudges: number; lastNudgeAt: number | null; countFrom: number | null; woke: boolean; wait: number | null; turnProgress: boolean } | null
  // The episode, as `<state>@<since>`, that the needs-you notification and
  // the cleanup wake were last given for, or null.
  notifiedFor: string | null
  cleanupWokeFor: string | null
  // The file modification time that the gone wake was last given for, or
  // null.
  goneWokeFor: number | null
  // Whether the parent was woken because the pairing, started with a desktop
  // session id, still had no status file it could join five minutes after
  // it was paired. It is given once per pairing.
  unseenWoke: boolean
  // The pull request milestones the parent was told about: the pull
  // request's number and state, and the last verdict pair, each null until
  // there is one. `sha` is the reviewed head's full commit id, and each
  // verdict is APPROVE or REQUEST_CHANGES. The whole field is null for a
  // pairing stored before foreman kept it, which takes its next read as
  // already announced.
  announced: {
    number: number | null
    state: 'OPEN' | 'MERGED' | 'CLOSED' | null
    verdicts: { sha: string; spec: 'APPROVE' | 'REQUEST_CHANGES'; adversarial: 'APPROVE' | 'REQUEST_CHANGES' } | null
  } | null
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
  // Null for a pairing that does not wait. A pairing whose start went on with
  // the wait line waits in the queue at `place`, lower places first, until
  // foreman begins it. `claim` is null until foreman claims it for a free
  // slot, and then says when foreman last tried to send it the begin message
  // and whether the person was told that a try failed. A begin that went
  // clears the whole field.
  queue: { place: number; claim: { attemptAt: number; notified: boolean } | null } | null
}

// Something to do outside the ledger: a nudge to a desktop session, naming
// the sub session for the log, a notification with its text, or the begin
// message to the waiting sub session of `ticket`, whose desktop session is
// `to`. A notification is `quiet` when the log already holds its text, so
// only a failure to raise it is logged. A nudge's `about` is 'background' for a sub session that waits only
// on background work, which gets its own text, and is absent for an idle one.
// A begin's `key` is its issue key, or null, and `by` names the sub session
// whose slot it takes, or is null when the slot was free already.
export type ForemanEffect =
  | { kind: 'nudge'; to: string; name: string; about?: 'background' }
  | { kind: 'notify'; text: string; quiet?: true }
  | { kind: 'begin'; to: string; ticket: string; key: string | null; by: string | null }

// What foreman decided and has not yet carried out: log lines, effects,
// lines that wake the parent, and report sentences that foreman shows itself
// in its band, its pane and a notification without waking anyone. A read
// puts its decision here in the same update that records it, and carrying it
// out takes it back out, so a hot reload that drops the timer in between
// loses nothing.
export type ForemanOutbox = { logs: string[]; effects: ForemanEffect[]; lines: string[]; reports: string[] }

// A sub session foreman holds no record of, which foreman checks by itself
// after a turn-end note about it. `id` is its `local_…` id, `notedAt` when
// foreman read the last note about it, and `dueAt` when foreman next reads
// its events. `nudged` says foreman sent it the nudge text, and `answered`
// that the first note after the nudge has come, which counts as the answer
// to the nudge. Only a nudged record is answered. `sending` says foreman
// marked the record nudged but the nudge has not gone yet, so a record that a
// hot reload left with it set was never nudged. Only a nudged record is
// sending.
export type ForemanCheck = { id: string; notedAt: number; dueAt: number; nudged: boolean; answered: boolean; sending: boolean }

// Tokens in the four kinds the API reports: uncached input, output, input
// read from the prompt cache and input written to it. Each is a whole number
// of zero or more. hooks/record.ts stops the type check when it differs from
// builder's TokenCounts.
export type ForemanCounts = { input: number; output: number; cacheRead: number; cacheWrite: number }

// What some sessions spent: their tokens summed over every model, and their
// dollar total, or null when no dollar figure is known.
export type ForemanSpend = { counts: ForemanCounts; usd: number | null }

// The last spending foreman read from the status file of the sub session that
// owns `ticket`.
export type ForemanSpent = ForemanSpend & { ticket: string }

// Every pairing of this parent, and what is still to be carried out. `folderMissing` says the last read found no status folder, so
// the log says so once. `held` lists the issue keys whose start the desktop
// app refused, or whose waiting sub session closed before foreman could begin
// it, which foreman offers again on the person's next prompt until a sign
// that they started.
// `offRefusedFor` is the session id for which foreman refused the first
// /implement start while the role was off, or null, so the refusal counts
// only in the conversation that saw it. `unwatched` lists the `local_…` ids
// of sub sessions started while the role was off, which foreman does not
// watch, oldest first. `spent` holds, for each ticket whose owner's file
// foreman has read spending from, the last spending it read, oldest ticket
// first. It outlives the pairing, so a sub session whose file is gone still
// counts in the sum. `earlier` is the total of the entries folded out of
// `spent` once it grew past its bound, or null while none was folded.
// `keptSlots` names, oldest first, each slot that freed on a read which could
// not read the desktop app's list while a sub session waited unclaimed, kept
// for the queue until a later read decides it as if it had freed then.
// `checks` holds the sub sessions foreman holds no record of that it checks
// by itself, oldest note first.
export type ForemanTickets = {
  pairings: ForemanPairing[]
  folderMissing: boolean
  outbox: ForemanOutbox
  held: string[]
  offRefusedFor: string | null
  unwatched: string[]
  spent: ForemanSpent[]
  earlier: ForemanSpend | null
  keptSlots: string[]
  checks: ForemanCheck[]
}

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
      // The line a rewritten turn-end note's prompt went on as, until the next
      // first step of the session's own loop clears it, or null. That step is
      // answered without the model only when the conversation ends with this
      // line alone.
      quietLine: string | null
      // The newest report sentence foreman showed and when it showed it, so
      // the band can show it for a while, or null before the first. It is
      // kept in $.state only, so it outlives a hot reload but not a restart.
      report: { text: string; at: number } | null
    }
  }
}
