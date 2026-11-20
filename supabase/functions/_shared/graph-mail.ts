// Email from the platform's Exchange Online shared mailbox through Microsoft Graph. The Entra app
// may send as that mailbox only, through an RBAC for Applications grant of Mail.Send scoped to it.
import { GRAPH_URL, graphClient, graphFailure, type GraphCredentials } from './graph.ts'
import type { Mailer } from './mail.ts'

/** mailbox is the shared mailbox's address, which every email comes from. */
export type GraphMailConfig = GraphCredentials & { mailbox: string }

export function graphMailer(config: GraphMailConfig): Mailer {
  const { graph } = graphClient(config)
  return {
    // Graph answers 202 once it has accepted the email, and keeps a copy in the mailbox's Sent Items.
    async send({ to, subject, html }) {
      const response = await graph('POST', `${GRAPH_URL}/users/${encodeURIComponent(config.mailbox)}/sendMail`, {
        message: {
          subject,
          body: { contentType: 'HTML', content: html },
          toRecipients: to.map((address) => ({ emailAddress: { address } })),
        },
      })
      if (response.status !== 202) throw await graphFailure(response, 'sendMail')
      await response.body?.cancel()
    },
  }
}
