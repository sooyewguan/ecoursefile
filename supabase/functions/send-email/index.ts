// The Send Email Hook. Supabase Auth calls this function in place of SMTP with each email it would
// send, and the function refuses every one. eCourseFile sends no email: the admin creates each
// account with a password, nobody signs up, signs in by link or changes their own email, and a
// forgotten password is reset with an SMS TAC through the password function. Without the hook,
// Supabase Auth would send its recovery and magic link emails through SMTP, and such a link signs
// the user in without their password.
//
// Supabase Auth signs each call by the Standard Webhooks scheme with SEND_EMAIL_HOOK_SECRET, and
// the function answers only calls with a good signature.
import { requiredEnv } from '../_shared/http.ts'

const signingKey = hmacKey(requiredEnv('SEND_EMAIL_HOOK_SECRET'))

/** How far the time of a signed call may be from now, as the Standard Webhooks scheme suggests. */
const TOLERANCE_SECONDS = 5 * 60

Deno.serve(async (req) => {
  const body = await req.text()
  if (!(await signedByAuth(req.headers, body))) {
    return Response.json({ error: { http_code: 401, message: 'The call is not signed by Supabase Auth.' } }, { status: 401 })
  }
  // Supabase Auth reads the error from a 200 answer, as with its other hooks, and fails the request
  // that asked for the email with this status and message.
  return Response.json({ error: { http_code: 403, message: 'eCourseFile sends no email. Reset your password with a TAC to your phone.' } })
})

/** The HMAC key of a Standard Webhooks secret, which Supabase writes as v1,whsec_<the key in base64>. */
function hmacKey(secret: string) {
  const key = fromBase64(secret.replace(/^v1,whsec_/, ''))
  if (!key) throw new Error('Set the SEND_EMAIL_HOOK_SECRET secret to v1,whsec_ and a base64 key.')
  return crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
}

/**
 * Whether Supabase Auth signed the call. The webhook-signature header holds one or more v1,<base64>
 * signatures, each an HMAC-SHA256 of the webhook-id header, the webhook-timestamp header and the
 * body, joined by dots. The timestamp, in seconds, must be within TOLERANCE_SECONDS of now.
 */
async function signedByAuth(headers: Headers, body: string) {
  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signatures = headers.get('webhook-signature')
  if (!id || !timestamp || !signatures) return false
  if (!(Math.abs(Date.now() / 1000 - Number(timestamp)) <= TOLERANCE_SECONDS)) return false
  const content = new TextEncoder().encode(`${id}.${timestamp}.${body}`)
  for (const signature of signatures.split(' ')) {
    const [version, value] = signature.split(',')
    if (version !== 'v1' || !value) continue
    const mac = fromBase64(value)
    if (mac && (await crypto.subtle.verify('HMAC', await signingKey, mac, content))) return true
  }
  return false
}

/** The bytes of base64 text, or null when it is not base64. */
function fromBase64(text: string) {
  try {
    return Uint8Array.from(atob(text), (character) => character.charCodeAt(0))
  } catch {
    return null
  }
}
