// The push adapter behind the audit-requests function. PUSH_ADAPTER picks Firebase Cloud Messaging
// (fcm) or the local fake (fake). With PUSH_ADAPTER unset, the site has no push yet, and every
// notification counts as sent to no browser, so audit requests still work.
import { fakePusher } from './fake-push.ts'
import { fcmPusher } from './fcm-push.ts'
import { serviceAccountFromEnv } from './google.ts'

/** One notification: its title and text, and the app's path that a tap on it opens. */
export type PushMessage = { title: string; body: string; link: string }

export interface Pusher {
  /**
   * Sends the notification to each browser token, and returns the tokens that the push service no
   * longer knows, such as of a browser that turned notifications off, so the caller removes them.
   * Throws when a token could not be sent to for any other reason.
   */
  send(tokens: string[], message: PushMessage): Promise<{ stale: string[] }>
}

export function pusherFromEnv(): Pusher {
  switch (Deno.env.get('PUSH_ADAPTER')) {
    case 'fcm':
      return fcmPusher(serviceAccountFromEnv())
    case 'fake':
      return fakePusher()
    case undefined:
    case '':
      return { send: async () => ({ stale: [] }) }
    default:
      throw new Error('Set the PUSH_ADAPTER secret to fcm or fake, or leave it unset.')
  }
}
