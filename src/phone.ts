// Texting a TAC to a phone and checking it, which every password change needs. With Firebase, the
// browser asks Firebase Phone Auth to text the TAC behind an invisible reCAPTCHA, and a right TAC
// signs the browser in to Firebase for a moment, which gives an ID token that proves the phone.
// The password Edge Function checks that token. The local fake does the same through the fake-sms
// function. Either way the app keeps no Firebase session.
import { FunctionsHttpError } from '@supabase/supabase-js'
import { firebaseApp, PHONE_VERIFIER } from './firebase.ts'
import { supabase } from './supabase.ts'

/** A TAC on its way to a phone. confirm checks the TAC the user typed, and gives the ID token. */
export type TacChallenge = { phone: string; confirm(code: string): Promise<string> }

/** A refusal the user can act on, such as a wrong TAC or too many tries. */
export class TacError extends Error {}

/**
 * A phone number in E.164 form, or null when it is not one. A Malaysian number may start with 0,
 * as people write it, such as 012-345 6789, which becomes +60123456789. Spaces, dashes and
 * brackets are ignored.
 */
export function toE164(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, '')
  const phone = digits.startsWith('+') ? digits : digits.startsWith('0') ? `+60${digits.slice(1)}` : `+${digits}`
  return /^\+[1-9][0-9]{7,14}$/.test(phone) ? phone : null
}

/**
 * Texts a TAC to the phone. Firebase's reCAPTCHA renders in recaptchaHost, which must stay in the
 * page until the TAC is confirmed.
 */
export function sendTac(phone: string, recaptchaHost: HTMLElement): Promise<TacChallenge> {
  return PHONE_VERIFIER === 'firebase' ? sendFirebaseTac(phone, recaptchaHost) : sendFakeTac(phone)
}

async function sendFirebaseTac(phone: string, recaptchaHost: HTMLElement): Promise<TacChallenge> {
  const { getAuth, RecaptchaVerifier, signInWithPhoneNumber, signOut } = await import('firebase/auth')
  const auth = getAuth(await firebaseApp())
  auth.useDeviceLanguage()
  // A verifier renders once, so each send gets a new element.
  const holder = document.createElement('div')
  recaptchaHost.replaceChildren(holder)
  const verifier = new RecaptchaVerifier(auth, holder, { size: 'invisible' })
  try {
    const result = await signInWithPhoneNumber(auth, phone, verifier)
    return {
      phone,
      async confirm(code) {
        try {
          const credential = await result.confirm(code)
          const idToken = await credential.user.getIdToken()
          await signOut(auth)
          return idToken
        } catch (error) {
          throw firebaseError(error)
        }
      },
    }
  } catch (error) {
    verifier.clear()
    throw firebaseError(error)
  }
}

/** Firebase's error codes as the user should read them. */
function firebaseError(error: unknown) {
  const code = (error as { code?: string }).code
  switch (code) {
    case 'auth/invalid-phone-number':
      return new TacError('This phone number is not valid.')
    case 'auth/invalid-verification-code':
    case 'auth/missing-verification-code':
      return new TacError('The TAC is wrong. Check it and try again.')
    case 'auth/code-expired':
      return new TacError('The TAC has expired. Ask for a new TAC.')
    case 'auth/too-many-requests':
    case 'auth/quota-exceeded':
      return new TacError('Too many TACs were asked for. Try again later.')
    case 'auth/captcha-check-failed':
      return new TacError('The reCAPTCHA check failed. Reload the page and try again.')
    default:
      console.error(error)
      return new TacError('The TAC could not be sent or checked. Try again later.')
  }
}

async function sendFakeTac(phone: string): Promise<TacChallenge> {
  const { verificationId } = await callFakeSms<{ verificationId: string }>({ action: 'send', phone })
  return {
    phone,
    async confirm(code) {
      return (await callFakeSms<{ idToken: string }>({ action: 'confirm', verificationId, code })).idToken
    },
  }
}

async function callFakeSms<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('fake-sms', { body })
  if (!error) return data as T
  if (error instanceof FunctionsHttpError) {
    const payload = (await (error.context as Response).json().catch(() => null)) as { message?: string } | null
    throw new TacError(payload?.message ?? 'The TAC could not be sent or checked.')
  }
  throw error
}
