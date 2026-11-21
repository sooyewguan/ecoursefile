// The mail adapter behind the Edge Functions that send email. The MAIL_ADAPTER secret picks the
// platform's Google account through Gmail (gmail) or the local fake (fake).
import { fakeMailer } from './fake-mail.ts'
import { gmailMailer } from './gmail-mail.ts'
import { googleCredentialsFromEnv } from './google.ts'

/** One email: its recipients, its subject and its body as HTML. */
export type Mail = { to: string[]; subject: string; html: string }

export interface Mailer {
  /** Sends the email to every recipient, or throws when it could not be sent. */
  send(mail: Mail): Promise<void>
}

export function mailerFromEnv(): Mailer {
  switch (Deno.env.get('MAIL_ADAPTER')) {
    case 'gmail':
      return gmailMailer(googleCredentialsFromEnv())
    case 'fake':
      return fakeMailer()
    default:
      throw new Error('Set the MAIL_ADAPTER secret to gmail or fake.')
  }
}
