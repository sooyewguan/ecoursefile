// The Send Email Hook. Supabase Auth calls this function in place of SMTP with each email it would
// send: the user, and the email's type, token hash and redirect URL. The function sends password
// reset emails through the mail adapter, and refuses every other type, since the admin creates each
// account with a password and nobody signs up, signs in by link or changes their own email.
//
// Supabase Auth signs each call by the Standard Webhooks scheme with SEND_EMAIL_HOOK_SECRET, and
// the function answers only calls with a good signature.
import { escapeHtml } from '../_shared/html.ts'
import { isRecord, isUuid, requiredEnv, rest, SERVICE } from '../_shared/http.ts'
import { mailerFromEnv, type Mail } from '../_shared/mail.ts'

const mailer = mailerFromEnv()
const signingKey = hmacKey(requiredEnv('SEND_EMAIL_HOOK_SECRET'))

/** How far the time of a signed call may be from now, as the Standard Webhooks scheme suggests. */
const TOLERANCE_SECONDS = 5 * 60

/** The app's page that a reset link opens, with the token hash in its query. */
const RESET_PAGE = '/reset-password'

type HookEmail = { type: string; userId: string; to: string; tokenHash: string; redirectTo: string }

Deno.serve(async (req) => {
  const body = await req.text()
  if (!(await signedByAuth(req.headers, body))) {
    return Response.json({ error: { http_code: 401, message: 'The call is not signed by Supabase Auth.' } }, { status: 401 })
  }
  const email = parseHookEmail(body)
  if (!email) return refuse(400, 'The hook payload holds no email.')
  if (email.type !== 'recovery') return refuse(403, 'eCourseFile sends only password reset emails.')

  try {
    const [profile] = await rest<{ full_name: string; active: boolean }[]>(
      'GET',
      `/profiles?select=full_name,active&id=eq.${email.userId}`,
      undefined,
      SERVICE,
    )
    // A deactivated user gets no link. Supabase Auth answers the request as it does for an email
    // with no account, so the answer does not tell them apart.
    if (profile?.active) await mailer.send(resetEmail(email, profile.full_name))
    return Response.json({})
  } catch (error) {
    console.error(error)
    return refuse(500, 'The email could not be sent. Try again later.')
  }
})

/**
 * An answer that makes Supabase Auth fail the request that asked for the email, with this HTTP
 * status and message. Supabase Auth reads the error from a 200 answer, as with its other hooks.
 */
function refuse(httpCode: number, message: string) {
  return Response.json({ error: { http_code: httpCode, message } })
}

function parseHookEmail(body: string): HookEmail | null {
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return null
  }
  if (!isRecord(payload) || !isRecord(payload.user) || !isRecord(payload.email_data)) return null
  const { id, email } = payload.user
  const { email_action_type, token_hash, redirect_to } = payload.email_data
  if (
    !isUuid(id) ||
    typeof email !== 'string' ||
    typeof email_action_type !== 'string' ||
    typeof token_hash !== 'string' ||
    typeof redirect_to !== 'string' ||
    !URL.canParse(redirect_to)
  ) {
    return null
  }
  return { type: email_action_type, userId: id, to: email, tokenHash: token_hash, redirectTo: redirect_to }
}

/**
 * The reset email. Its link opens the reset page at the origin of redirect_to, which Supabase Auth
 * has already checked against the site URL and the allowed redirect URLs.
 */
function resetEmail(email: HookEmail, fullName: string): Mail {
  const link = new URL(RESET_PAGE, email.redirectTo)
  link.search = new URLSearchParams({ token_hash: email.tokenHash }).toString()
  return {
    to: [email.to],
    subject: 'Reset your eCourseFile password',
    html: [
      `<p>Hello ${escapeHtml(fullName)},</p>`,
      `<p>We received a request to reset the password of the eCourseFile account ${escapeHtml(email.to)}. To set a new password, open this link. It works once, within one hour.</p>`,
      `<p><a href="${escapeHtml(link.href)}">Set a new password</a></p>`,
      '<p>If you did not ask for this, ignore this email, and your password stays as it is.</p>',
    ].join('\n'),
  }
}

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
