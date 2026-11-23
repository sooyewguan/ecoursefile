// The phone verifier behind the password function. The browser texts a TAC to a phone and checks
// it, through Firebase Phone Auth or the local fake, and gets an ID token that proves the phone. The
// function asks the verifier which phone the token proves. PHONE_VERIFIER picks the implementation.
import { fakePhoneVerifier } from './fake-phone.ts'
import { firebasePhoneVerifier } from './firebase-phone.ts'
import { serviceAccountFromEnv } from './google.ts'

export interface PhoneVerifier {
  /**
   * The phone, in E.164 form, whose TAC the browser checked to get this token, or null when the
   * token is not good: forged, for another project, expired, or older than TOKEN_MAX_AGE_SECONDS.
   */
  phoneOf(idToken: string): Promise<string | null>
  /** Removes what the verifier keeps for the phone, such as its Firebase user, once no profile has it. */
  forget(phone: string): Promise<void>
}

/** How long after the TAC was checked a token still works, so a token found later changes nothing. */
export const TOKEN_MAX_AGE_SECONDS = 10 * 60

export function phoneVerifierFromEnv(): PhoneVerifier {
  switch (Deno.env.get('PHONE_VERIFIER')) {
    case 'firebase':
      return firebasePhoneVerifier(serviceAccountFromEnv())
    case 'fake':
      return fakePhoneVerifier()
    default:
      throw new Error('Set the PHONE_VERIFIER secret to firebase or fake.')
  }
}
