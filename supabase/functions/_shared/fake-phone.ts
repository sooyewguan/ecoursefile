// A stand-in for Firebase Phone Auth on the local stack. The fake-sms function records each TAC and
// swaps a right one for a token in fake_sms.tokens. This reads the phone back from that token.
import { rest, SERVICE } from './http.ts'
import { TOKEN_MAX_AGE_SECONDS, type PhoneVerifier } from './phone.ts'

const FAKE_SMS = { 'Accept-Profile': 'fake_sms', 'Content-Profile': 'fake_sms' }

export function fakePhoneVerifier(): PhoneVerifier {
  return {
    async phoneOf(idToken) {
      const since = new Date(Date.now() - TOKEN_MAX_AGE_SECONDS * 1000).toISOString()
      const [found] = await rest<{ phone: string }[]>(
        'GET',
        `/tokens?select=phone&token=eq.${encodeURIComponent(idToken)}&issued_at=gt.${encodeURIComponent(since)}`,
        undefined,
        SERVICE,
        FAKE_SMS,
      )
      return found?.phone ?? null
    },
    async forget(phone) {
      await rest('DELETE', `/accounts?phone=eq.${encodeURIComponent(phone)}`, undefined, SERVICE, FAKE_SMS)
    },
  }
}
