// The issue link rules: where a project names its tracker's issue address,
// whether that address can be used, and how an issue key becomes a link.
// This module imports nothing, so every other module can import it.
//
// Builder's hooks/links.ts and foreman's hooks/links.ts are the same file,
// byte for byte, because a mod cannot import another plugin's files, so change
// the two only together. No test compares the two files. Foreman's
// tests/art.test.ts holds the pure functions of foreman's copy to the answers
// that builder's copy gave, and readIssueLink is checked in each mod by its
// own tests/links.test.ts. The two test files are the same except that
// builder's also checks linkFactIn against factIn, which foreman lacks.

// The issue-key shape: an upper-case letter, then upper-case letters or
// digits, a hyphen, and digits. A key of this shape is safe in an address as
// it is.
export const ISSUE_KEY = /^[A-Z][A-Z0-9]*-[0-9]+$/

// The value of the first line that starts with `Issue link:`, trimmed, with
// one leading and one trailing backtick removed, or null when no line has it.
// The value never runs past the end of its own line, so a bare `Issue link:`
// answers an empty value.
export function linkFactIn(text: string): string | null {
  const match = /^Issue link:[ \t]*(.*)$/m.exec(text)
  return match ? (match[1] ?? '').trim().replace(/^`|`$/g, '') : null
}

// Why an address cannot be used, as the first of the three checks that fails,
// or null when it can be used.
export function whyUnusable(address: string): string | null {
  if (!address.startsWith('https://')) return 'it does not begin with https://'
  if (!address.includes('{key}')) return 'it has no {key}'
  if (/[\s\u0000-\u001f\u007f-\u009f]/.test(address)) return 'it holds spaces or control characters'
  return null
}

// What a project's fact says: the usable address, or the reason the fact was
// ignored. Both are null when the project names no address.
export type IssueLink = { address: string | null; ignored: string | null }

export const NO_LINK: IssueLink = { address: null, ignored: null }

// The fact in one file's text, or null when there is no text or it has no
// fact line, so that the search can go on to the next place.
export function issueLinkIn(text: string | null): IssueLink | null {
  if (text === null) return null
  const address = linkFactIn(text)
  if (address === null) return null
  const reason = whyUnusable(address)
  return reason === null ? { address, ignored: null } : { address: null, ignored: reason }
}

// The link for an issue key, with every `{key}` in the address replaced by
// the key, or null when there is no address or the key is not of the
// issue-key shape.
export function linkOf(address: string | null, key: string | null): string | null {
  if (address === null || typeof key !== 'string' || !ISSUE_KEY.test(key)) return null
  return address.split('{key}').join(key)
}

// A path resolved against a folder: an absolute path as it is, a relative one
// joined to the folder, and in both `.`, `..` and repeated slashes folded.
export function resolved(base: string, path: string): string {
  const parts: string[] = []
  for (const part of (path.startsWith('/') ? path : `${base}/${path}`).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

// The git folder that a worktree's `.git` file names on its first line as
// `gitdir: <path>`, resolved against the working folder, or null when the
// file says anything else.
export function gitDirOf(dir: string, dotGit: string): string | null {
  const match = /^gitdir:[ \t]*(\S.*)$/.exec((dotGit.split('\n')[0] ?? '').trim())
  return match ? resolved(dir, match[1]!.trim()) : null
}

// The main checkout, which is the folder holding the common git folder that
// `commondir` names relative to the worktree's git folder, or null when
// `commondir` is empty.
export function mainCheckoutOf(gitDir: string, commondir: string): string | null {
  const common = (commondir.split('\n')[0] ?? '').trim()
  return common === '' ? null : resolved(resolved(gitDir, common), '..')
}

// The line the person is told when the fact is ignored. It names the reason
// and never the value, which can hold escape sequences.
export function ignoredLine(mod: string, reason: string): string {
  return `${mod}: the Issue link fact was ignored because ${reason}`
}

// One file's text, or null when the read is refused or answers something
// other than a string.
async function textAt(read: (path: string) => Promise<unknown>, path: string): Promise<string | null> {
  try {
    const text = await read(path)
    return typeof text === 'string' ? text : null
  } catch {
    return null
  }
}

// The project's fact, looked for in the working folder's CLAUDE.md, then its
// CLAUDE.local.md, then the main checkout's CLAUDE.local.md, where the first
// file that has the line wins, even when its fact is unusable. The `.git`
// file and `commondir` are read only when neither of the first two has the
// line. A `.git` folder does not read as text, which leaves no third place.
// This never throws.
export async function readIssueLink(read: (path: string) => Promise<unknown>, dir: string): Promise<IssueLink> {
  for (const name of ['CLAUDE.md', 'CLAUDE.local.md']) {
    const found = issueLinkIn(await textAt(read, resolved(dir, name)))
    if (found) return found
  }
  const dotGit = await textAt(read, resolved(dir, '.git'))
  const gitDir = dotGit === null ? null : gitDirOf(dir, dotGit)
  if (gitDir === null) return NO_LINK
  const commondir = await textAt(read, resolved(gitDir, 'commondir'))
  const main = commondir === null ? null : mainCheckoutOf(gitDir, commondir)
  if (main === null || main === resolved(dir, '.')) return NO_LINK
  return issueLinkIn(await textAt(read, resolved(main, 'CLAUDE.local.md'))) ?? NO_LINK
}
