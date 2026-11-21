// Email from the Google account in google.ts, through the Gmail API with the gmail.send scope. Gmail
// sends from the account's own address and keeps a copy in its Sent folder.
import { type GoogleCredentials, googleClient, googleFailure } from './google.ts'
import type { Mail, Mailer } from './mail.ts'

const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'

export function gmailMailer(credentials: GoogleCredentials): Mailer {
  const { google } = googleClient(credentials)
  return {
    async send(mail) {
      const response = await google('POST', SEND_URL, { raw: base64Url(new TextEncoder().encode(message(mail))) })
      if (!response.ok) throw await googleFailure(response, 'Gmail send')
      await response.body?.cancel()
    },
  }
}

/**
 * The email as an RFC 2822 message, without a From header, which Gmail fills in. The subject and
 * body go as UTF-8 in base64, so no text a user wrote can end a header or start another.
 */
export function message({ to, subject, html }: Mail) {
  if (to.some((address) => /[\r\n,]/.test(address))) throw new Error('A recipient address holds a line break or a comma.')
  return [
    `To: ${to.join(', ')}`,
    `Subject: ${encodedWords(subject).join('\r\n ')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    // RFC 2045 limits a base64 line to 76 characters.
    ...(base64(new TextEncoder().encode(html)).match(/.{1,76}/g) ?? []),
  ].join('\r\n')
}

/**
 * text as RFC 2047 encoded words, one to a line. Each holds at most 39 bytes of UTF-8, so even the
 * first line, after "Subject: ", stays within the 78 characters that RFC 5322 asks for. A character
 * never splits across two words.
 */
function encodedWords(text: string) {
  const words: string[] = []
  let part = ''
  for (const character of text) {
    if (new TextEncoder().encode(part + character).length > 39) {
      words.push(part)
      part = ''
    }
    part += character
  }
  return [...words, part].map((word) => `=?UTF-8?B?${base64(new TextEncoder().encode(word))}?=`)
}

function base64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64Url(bytes: Uint8Array) {
  return base64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
