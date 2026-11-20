// The mail adapter behind the Edge Functions that send email. The MAIL_ADAPTER secret picks the
// platform's Exchange Online shared mailbox through Microsoft Graph (graph) or the local fake (fake).
import { fakeMailer } from './fake-mail.ts'
import { graphMailer } from './graph-mail.ts'
import { requiredEnv } from './http.ts'

/** One email: its recipients, its subject and its body as HTML. */
export type Mail = { to: string[]; subject: string; html: string }

export interface Mailer {
  /** Sends the email to every recipient, or throws when it could not be sent. */
  send(mail: Mail): Promise<void>
}

export function mailerFromEnv(): Mailer {
  switch (Deno.env.get('MAIL_ADAPTER')) {
    case 'graph':
      return graphMailer({
        tenantId: requiredEnv('GRAPH_TENANT_ID'),
        clientId: requiredEnv('GRAPH_CLIENT_ID'),
        clientSecret: requiredEnv('GRAPH_CLIENT_SECRET'),
        mailbox: requiredEnv('GRAPH_MAILBOX'),
      })
    case 'fake':
      return fakeMailer()
    default:
      throw new Error('Set the MAIL_ADAPTER secret to graph or fake.')
  }
}
