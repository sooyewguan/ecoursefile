// Every password change, and every change of a user's phone, after a TAC to that phone. The browser
// texts the TAC and checks it through the phone verifier, and sends the ID token it got. The JSON
// body has an action field.
//
// set-password: a signed-in user sets a new password. A user with no phone, such as at the first
//   sign-in or after an admin cleared it, registers the token's phone with it. A user with a phone
//   needs the TAC on that phone.
// change-phone: a signed-in user moves to the token's phone, with their current password.
// reset-password: a signed-out user who forgot their password sets a new one, with a TAC on the
//   phone of their account. The function answers with the account's email, to sign in with.
//
// Supabase Auth's own updateUser cannot change a password: the trigger require_password_change_grant
// refuses a change that allow_password_change did not grant just before.
import { authFetch, callerUser, invalid, isRecord, Refusal, rest, SERVICE, servePublicJson } from '../_shared/http.ts'
import { phoneVerifierFromEnv } from '../_shared/phone.ts'

type PasswordRequest =
  | { action: 'set-password'; idToken: string; password: string }
  | { action: 'change-phone'; idToken: string; password: string }
  | { action: 'reset-password'; idToken: string; password: string }

type Profile = { id: string; email: string; phone: string | null; active: boolean }

const verifier = phoneVerifierFromEnv()

servePublicJson(async (body, caller) => {
  const request = parseRequest(body)
  const phone = await verifier.phoneOf(request.idToken)
  if (!phone) throw new Refusal(401, 'invalid_token', 'The TAC check has expired. Ask for a new TAC.')
  switch (request.action) {
    case 'set-password':
      return setPassword(await signedInProfile(caller), phone, request.password)
    case 'change-phone':
      return changePhone(await signedInProfile(caller), phone, request.password)
    case 'reset-password':
      return resetPassword(phone, request.password)
  }
})

function parseRequest(body: unknown): PasswordRequest {
  const { action, idToken, password } = isRecord(body) ? body : {}
  if (
    (action === 'set-password' || action === 'change-phone' || action === 'reset-password') &&
    typeof idToken === 'string' &&
    idToken !== '' &&
    typeof password === 'string'
  ) {
    return { action, idToken, password }
  }
  throw invalid('action must be set-password, change-phone or reset-password, with idToken and password.')
}

async function signedInProfile(caller: string | null) {
  if (!caller) throw new Refusal(401, 'unauthorized', 'Sign in first.')
  const { id } = await callerUser(caller)
  const [profile] = await profilesWhere(`id=eq.${id}`)
  if (!profile?.active) throw new Refusal(403, 'forbidden', 'This account is deactivated.')
  return profile
}

async function setPassword(profile: Profile, phone: string, password: string) {
  if (profile.phone === null) {
    await refuseTakenPhone(profile, phone)
    await changePassword(profile.id, password)
    await rest('PATCH', `/profiles?id=eq.${profile.id}`, { phone }, SERVICE)
  } else {
    if (profile.phone !== phone) throw new Refusal(403, 'wrong_phone', 'Use the TAC sent to the phone number on your profile.')
    await changePassword(profile.id, password)
  }
  return { phone }
}

async function changePhone(profile: Profile, phone: string, password: string) {
  if (!(await passwordMatches(profile.email, password))) throw new Refusal(403, 'wrong_password', 'The current password is wrong.')
  if (profile.phone === phone) return { phone }
  await refuseTakenPhone(profile, phone)
  await rest('PATCH', `/profiles?id=eq.${profile.id}`, { phone }, SERVICE)
  if (profile.phone) await forget(profile.phone)
  return { phone }
}

/**
 * Only the phone's owner gets a TAC, so telling them that no account has it tells nobody else. A
 * deactivated account cannot sign in, so it gets no new password.
 */
async function resetPassword(phone: string, password: string) {
  const [profile] = await profilesWhere(`phone=eq.${encodeURIComponent(phone)}`)
  if (!profile?.active) throw new Refusal(404, 'no_account', 'No active account has this phone number. Ask an admin to reset your password.')
  await changePassword(profile.id, password)
  return { email: profile.email }
}

function profilesWhere(filter: string) {
  return rest<Profile[]>('GET', `/profiles?select=id,email,phone,active&${filter}`, undefined, SERVICE)
}

async function refuseTakenPhone(profile: Profile, phone: string) {
  const [owner] = await profilesWhere(`phone=eq.${encodeURIComponent(phone)}`)
  if (owner && owner.id !== profile.id) throw new Refusal(409, 'phone_in_use', 'Another account has this phone number.')
}

/** Sets the password, which clears the must-change-password flag. Supabase Auth refuses one that is too short. */
async function changePassword(userId: string, password: string) {
  await rest('POST', '/rpc/allow_password_change', { user_id: userId }, SERVICE)
  const response = await authFetch('PUT', `/admin/users/${userId}`, { password }, SERVICE)
  const payload = await response.json().catch(() => null)
  if (response.ok) return
  if (response.status < 500) throw invalid(payload?.msg ?? 'The password was refused.')
  throw new Error(`Setting the password failed with ${response.status}: ${JSON.stringify(payload)}`)
}

/** Whether the password signs the user in. The session it makes is signed out again at once. */
async function passwordMatches(email: string, password: string) {
  const response = await authFetch('POST', '/token?grant_type=password', { email, password }, `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`)
  if (!response.ok) {
    await response.body?.cancel()
    if (response.status < 500) return false
    throw new Error(`Checking the password failed with ${response.status}.`)
  }
  const { access_token }: { access_token: string } = await response.json()
  await (await authFetch('POST', '/logout?scope=local', undefined, `Bearer ${access_token}`)).body?.cancel()
  return true
}

/** Removes the old phone from the verifier. The phone has already changed, so a failure here only leaves a stale Firebase user. */
async function forget(phone: string) {
  try {
    await verifier.forget(phone)
  } catch (error) {
    console.error(error)
  }
}
