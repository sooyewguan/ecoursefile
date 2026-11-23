// The fake phone verifier's two steps, which stand in for Firebase Phone Auth's. It answers only
// while PHONE_VERIFIER is fake.
//
// send, with phone, records a TAC for the phone in fake_sms.codes instead of texting it, and returns
// its verificationId. confirm, with verificationId and code, checks the TAC as Firebase's
// confirmationResult.confirm does. A right TAC within five minutes, not used before, adds the phone
// to fake_sms.accounts and returns an idToken that the password function accepts.
import { invalid, isRecord, isUuid, Refusal, rest, SERVICE, servePublicJson } from '../_shared/http.ts'

const FAKE_SMS = { 'Accept-Profile': 'fake_sms', 'Content-Profile': 'fake_sms', Prefer: 'return=representation' }

/** How long a TAC works, as Firebase's does. */
const CODE_MAX_AGE_MS = 5 * 60_000

servePublicJson(async (body) => {
  if (Deno.env.get('PHONE_VERIFIER') !== 'fake') throw new Refusal(404, 'not_found', 'The fake phone verifier is off.')
  const input = isRecord(body) ? body : {}
  if (input.action === 'send' && typeof input.phone === 'string' && /^\+[1-9][0-9]{7,14}$/.test(input.phone)) {
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')
    const [sent] = await rest<{ id: string }[]>('POST', '/codes', { phone: input.phone, code }, SERVICE, FAKE_SMS)
    return { verificationId: sent.id }
  }
  if (input.action === 'confirm' && isUuid(input.verificationId) && typeof input.code === 'string') {
    const since = new Date(Date.now() - CODE_MAX_AGE_MS).toISOString()
    const [used] = await rest<{ phone: string }[]>(
      'PATCH',
      `/codes?id=eq.${input.verificationId}&code=eq.${encodeURIComponent(input.code)}&used_at=is.null&sent_at=gt.${encodeURIComponent(since)}`,
      { used_at: new Date().toISOString() },
      SERVICE,
      FAKE_SMS,
    )
    if (!used) throw new Refusal(400, 'invalid_code', 'The TAC is wrong or has expired.')
    await rest('POST', '/accounts', { phone: used.phone }, SERVICE, { ...FAKE_SMS, Prefer: 'resolution=ignore-duplicates' })
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
    await rest('POST', '/tokens', { token, phone: used.phone }, SERVICE, FAKE_SMS)
    return { idToken: token }
  }
  throw invalid('action must be send, with a phone in E.164 form, or confirm, with verificationId and code.')
})
