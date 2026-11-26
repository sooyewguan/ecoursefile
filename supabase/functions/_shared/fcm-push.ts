// Push notifications through the FCM HTTP v1 API, as the Firebase project's service account. Each
// message is data only, so the app's service worker, public/push-sw.js, shows it the same way in
// every browser. FCM answers 404 for a token it no longer knows, and 403 for one of another project.
import { googleClient, type ServiceAccount, serviceAccountGrant } from './google.ts'
import type { Pusher } from './push.ts'

export function fcmPusher(account: ServiceAccount): Pusher {
  const google = googleClient(serviceAccountGrant(account))
  const url = `https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`
  return {
    async send(tokens, { title, body, link }) {
      const stale: string[] = []
      for (const token of tokens) {
        const response = await google('POST', url, { message: { token, data: { title, body, link }, webpush: { headers: { Urgency: 'high' } } } })
        if (response.ok || response.status === 404 || response.status === 403) {
          await response.body?.cancel()
          if (!response.ok) stale.push(token)
          continue
        }
        throw new Error(`FCM messages:send answered ${response.status}: ${await response.text()}`)
      }
      return { stale }
    },
  }
}
