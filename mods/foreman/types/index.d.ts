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
// the epoch.
export type ForemanLogLine = { at: number; text: string }

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
    }
  }
}
