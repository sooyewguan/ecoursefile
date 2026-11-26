// Phrases that the app's words never use. Each narrates the screen, explains who does what
// instead of stating what is so, or leaks how the app works inside. copy-rules.test.ts fails on
// any of them in the source, and a page check can look for them in what a page shows. A phrase
// with pageOnly is a raw error that only a page can show, since the source reads such text to
// replace it.

export const BANNED_PHRASES: readonly { phrase: RegExp; why: string; pageOnly?: true }[] = [
  { phrase: /\bSharePoint\b/i, why: 'Where files are stored is not for users to know.' },
  { phrase: /\bGoogle Drive\b/i, why: 'Where files are stored is not for users to know.' },
  { phrase: /\b(?:the|an) admin\b(?! role)/i, why: 'State what is so, not who does it.' },
  { phrase: /\b(?:is|are) set by\b/i, why: 'State what is so, not who does it.' },
  { phrase: /\bStaff see\b/i, why: 'State what is so, not who sees it.' },
  { phrase: /\bwithin (?:an|one) hour\b/i, why: 'Internal timing.' },
  { phrase: /\bRPC\b/, why: 'Internal name.' },
  { phrase: /\bthe database\b/i, why: 'Internal name.' },
  { phrase: /\bEdge Function\b/i, why: 'Internal name.' },
  { phrase: /\b(?:this|the|a) slot\b/i, why: 'Internal name.' },
  { phrase: /\bcourse type setting\b/i, why: 'Internal name.' },
  { phrase: /\b(?:appears?|shows?) here\b/i, why: 'Narrates the screen.' },
  { phrase: /\b(?:is|are) listed on the\b/i, why: 'Narrates the screen.' },
  { phrase: /\bClick (?:here|the|on)\b/i, why: 'Narrates the screen.' },
  { phrase: /\bYou stay signed in\b/i, why: 'Narrates the obvious.' },
  { phrase: /\bOnly active users\b/i, why: 'Explains the query, not the state.' },
  { phrase: /\bNot linked\b/, why: 'Jargon.' },
  { phrase: /\bplease\b/i, why: 'Plain words do not plead.' },
  { phrase: /\b(?:sorry|oops)\b/i, why: 'Plain words do not apologise.' },
  { phrase: /\bsuccessfully\b/i, why: 'Say what happened.' },
  { phrase: /\bUploaded 0\b|\bwas not uploaded\b/i, why: 'Robotic upload result.' },
  { phrase: /\bcould not read your\b/i, why: 'Raw error prefix.' },
  { phrase: /\bpermission denied\b|\bviolates\b|\bduplicate key\b|\bPGRST\d|\bTypeError\b|\bfetch failed\b/i, why: 'A raw error leaked.', pageOnly: true },
]

/** One banned phrase in a source file: its line, from 1, the text that matched, and why it is banned. */
export type CopyViolation = { line: number; text: string; why: string }

/**
 * The banned phrases in a source file's code and strings. Comments are skipped, since they talk
 * to developers. A // after a colon, as in a URL, starts no comment.
 */
export function findBannedPhrases(source: string): CopyViolation[] {
  const code = source.replace(/\/\*[\s\S]*?\*\/|(?<![:\w'"`])\/\/[^\n]*/g, (comment) => comment.replace(/[^\n]/g, ' '))
  return code.split('\n').flatMap((text, index) =>
    BANNED_PHRASES.flatMap(({ phrase, why, pageOnly }) => {
      const match = !pageOnly && text.match(phrase)
      return match ? [{ line: index + 1, text: match[0], why }] : []
    }),
  )
}
