// A copy of builder's configDirOf in hooks/status.ts, because a mod cannot
// import another plugin's files. tests/art.test.ts holds it to the answers
// that builder's own function gave, as tests/builder-drawn.ts wrote them
// down, so a change to builder's rule has to be copied here as well.

// Whether a path is absolute, on a Unix-like system or with a Windows drive.
const isAbsolute = (path: string) => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)

// A path with the slashes at its end dropped.
const withoutTrailingSlashes = (path: string) => path.replace(/[\\/]+$/, '')

// Claude Code's configuration folder: CLAUDE_CONFIG_DIR when it is set and
// not empty, and otherwise `.claude` under the home folder. The home folder is
// HOME when it is set and absolute, else USERPROFILE when it is set and
// absolute, because Windows normally sets USERPROFILE and not HOME. A
// CLAUDE_CONFIG_DIR that is set but not absolute gives null, and so does a
// home folder that neither variable gives, so that nothing is read from a
// folder that depends on where the session runs. Trailing slashes are
// dropped.
export function configDirOf(configDir: string | undefined, home: string | undefined, userProfile: string | undefined): string | null {
  if (configDir !== undefined && configDir !== '') {
    if (!isAbsolute(configDir)) return null
    const trimmed = withoutTrailingSlashes(configDir)
    return trimmed === '' ? null : trimmed
  }
  for (const folder of [home, userProfile]) {
    if (folder !== undefined && folder !== '' && isAbsolute(folder)) return `${withoutTrailingSlashes(folder)}/.claude`
  }
  return null
}
