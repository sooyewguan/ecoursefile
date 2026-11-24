// A stand-in for FCM on the local stack. It records each notification in fake_push.outbox instead of
// sending it, so seam 1 tests can read what was sent to which browser. A token in
// fake_push.undeliverable fails the send, and a token in fake_push.unregistered comes back as stale.
import { inList, rest, SERVICE } from './http.ts'
import type { Pusher } from './push.ts'

const FAKE_PUSH = { 'Accept-Profile': 'fake_push', 'Content-Profile': 'fake_push' }

export function fakePusher(): Pusher {
  return {
    async send(tokens, message) {
      if (tokens.length === 0) return { stale: [] }
      const listed = (table: string) => rest<{ token: string }[]>('GET', `/${table}?select=token&token=${inList(tokens)}`, undefined, SERVICE, FAKE_PUSH)
      if ((await listed('undeliverable')).length > 0) throw new Error('The fake push service refuses an undeliverable token.')
      const stale = (await listed('unregistered')).map(({ token }) => token)
      const live = tokens.filter((token) => !stale.includes(token))
      if (live.length > 0) await rest('POST', '/outbox', live.map((token) => ({ token, ...message })), SERVICE, FAKE_PUSH)
      return { stale }
    },
  }
}
