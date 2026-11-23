// Phones verified by Firebase Phone Auth. Firebase texts the TAC and checks it in the browser, then
// signs the browser in to Firebase with an ID token whose phone_number claim is the phone. This
// checks the token as Firebase's docs say a server must: an RS256 signature by one of Google's
// securetoken keys, the project's audience and issuer, and its times. It also asks that the user
// signed in by phone within TOKEN_MAX_AGE_SECONDS.
import { fromBase64Url, googleClient, type ServiceAccount } from './google.ts'
import { isRecord } from './http.ts'
import { TOKEN_MAX_AGE_SECONDS, type PhoneVerifier } from './phone.ts'

const KEYS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'

/** How far the token's times may be from the function's clock. */
const CLOCK_SKEW_SECONDS = 60

type Jwk = JsonWebKey & { kid: string }

export function firebasePhoneVerifier(account: ServiceAccount): PhoneVerifier {
  const google = googleClient(account)
  const identityToolkit = `https://identitytoolkit.googleapis.com/v1/projects/${account.projectId}`
  // Google rotates its keys, and its Cache-Control says how long the set holds.
  let keys: { byId: Map<string, Promise<CryptoKey>>; expiresAt: number } | null = null

  async function key(kid: string) {
    if (!keys || keys.expiresAt < Date.now()) {
      const response = await fetch(KEYS_URL)
      if (!response.ok) throw new Error(`Google's securetoken keys answered ${response.status}.`)
      const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('Cache-Control') ?? '')?.[1] ?? 3600)
      const { keys: jwks }: { keys: Jwk[] } = await response.json()
      keys = {
        byId: new Map(jwks.map((jwk) => [jwk.kid, crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])])),
        expiresAt: Date.now() + maxAge * 1000,
      }
    }
    return keys.byId.get(kid) ?? null
  }

  return {
    async phoneOf(idToken) {
      const [header, payload, signature] = idToken.split('.')
      if (!header || !payload || !signature) return null
      const head = decodeJson(header)
      const claims = decodeJson(payload)
      if (!head || !claims || head.alg !== 'RS256' || typeof head.kid !== 'string') return null
      const verifyKey = await key(head.kid)
      if (!verifyKey) return null
      const signed = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', await verifyKey, fromBase64Url(signature), new TextEncoder().encode(`${header}.${payload}`))
      if (!signed) return null

      const now = Date.now() / 1000
      const firebase = isRecord(claims.firebase) ? claims.firebase : {}
      const good =
        claims.aud === account.projectId &&
        claims.iss === `https://securetoken.google.com/${account.projectId}` &&
        typeof claims.sub === 'string' &&
        claims.sub !== '' &&
        typeof claims.exp === 'number' &&
        claims.exp > now - CLOCK_SKEW_SECONDS &&
        typeof claims.iat === 'number' &&
        claims.iat < now + CLOCK_SKEW_SECONDS &&
        typeof claims.auth_time === 'number' &&
        claims.auth_time < now + CLOCK_SKEW_SECONDS &&
        claims.auth_time > now - TOKEN_MAX_AGE_SECONDS &&
        firebase.sign_in_provider === 'phone' &&
        typeof claims.phone_number === 'string'
      return good ? (claims.phone_number as string) : null
    },

    async forget(phone) {
      const lookup = await google.fetch(`${identityToolkit}/accounts:lookup`, { phoneNumber: [phone] })
      if (!lookup.ok) throw new Error(`Identity Toolkit accounts:lookup answered ${lookup.status}: ${await lookup.text()}`)
      const { users = [] }: { users?: { localId: string }[] } = await lookup.json()
      for (const { localId } of users) {
        const deleted = await google.fetch(`${identityToolkit}/accounts:delete`, { localId })
        if (!deleted.ok) throw new Error(`Identity Toolkit accounts:delete answered ${deleted.status}: ${await deleted.text()}`)
        await deleted.body?.cancel()
      }
    },
  }
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(part)))
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}
