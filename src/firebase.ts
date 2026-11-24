// The Firebase web app, for Cloud Messaging (push notifications). The app loads the Firebase SDK
// only when a notification needs it, so other pages do not download it.
import type { FirebaseApp } from 'firebase/app'

/**
 * fcm registers this browser with Firebase Cloud Messaging, and fake registers a made-up token.
 * null, when VITE_PUSH_ADAPTER is not set, means the site has no push yet, and the rest of the app
 * works without it.
 */
export const PUSH_ADAPTER = adapter('VITE_PUSH_ADAPTER', import.meta.env.VITE_PUSH_ADAPTER, ['fcm', 'fake'])

let app: Promise<FirebaseApp> | null = null

export function firebaseApp() {
  app ??= import('firebase/app').then(({ initializeApp }) =>
    initializeApp({
      apiKey: required('VITE_FIREBASE_API_KEY', import.meta.env.VITE_FIREBASE_API_KEY),
      projectId: required('VITE_FIREBASE_PROJECT_ID', import.meta.env.VITE_FIREBASE_PROJECT_ID),
      messagingSenderId: required('VITE_FIREBASE_MESSAGING_SENDER_ID', import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
      appId: required('VITE_FIREBASE_APP_ID', import.meta.env.VITE_FIREBASE_APP_ID),
    }),
  )
  return app
}

/**
 * The public key of the project's own Web Push certificate, if it has one. Without it, the Firebase
 * SDK uses Firebase's default key, which FCM accepts too.
 */
export function firebaseVapidKey(): string | undefined {
  return import.meta.env.VITE_FIREBASE_VAPID_KEY || undefined
}

/** The value, or null when it is not set. A value that is set but not allowed is a typo, so it throws. */
function adapter<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T | null {
  if (!value) return null
  if (!allowed.includes(value as T)) throw new Error(`Set ${name} to ${allowed.join(' or ')} in .env (see .env.example), or leave it out.`)
  return value as T
}

function required(name: string, value: string | undefined) {
  if (!value) throw new Error(`Set ${name} in .env (see .env.example).`)
  return value
}
