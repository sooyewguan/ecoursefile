// A stand-in for Gmail on the local stack. It records each email in the fake_mail
// schema instead of sending it, so seam 1 tests can read what was sent to whom.
import { rest, SERVICE } from './http.ts'
import type { Mailer } from './mail.ts'

export function fakeMailer(): Mailer {
  return {
    async send({ to, subject, html }) {
      await rest('POST', '/outbox', { recipients: to, subject, html }, SERVICE, { 'Content-Profile': 'fake_mail' })
    },
  }
}
