// The Firebase web app, for Phone Auth (TACs) and Cloud Messaging (push notifications). The app
// loads the Firebase SDK only when a TAC or a notification needs it, so other pages do not download it.
import type { FirebaseApp } from 'firebase/app'

/** firebase texts real TACs through Firebase Phone Auth, and fake asks the local fake-sms function. */
export const PHONE_VERIFIER = adapter('VITE_PHONE_VERIFIER', import.meta.env.VITE_PHONE_VERIFIER, ['firebase', 'fake'])

/** fcm registers this browser with Firebase Cloud Messaging, and fake registers a made-up token. */
export const PUSH_ADAPTER = adapter('VITE_PUSH_ADAPTER', import.meta.env.VITE_PUSH_ADAPTER, ['fcm', 'fake'])

let app: Promise<FirebaseApp> | null = null

export function firebaseApp() {
  app ??= import('firebase/app').then(({ initializeApp }) =>
    initializeApp({
      apiKey: required('VITE_FIREBASE_API_KEY', import.meta.env.VITE_FIREBASE_API_KEY),
      authDomain: required('VITE_FIREBASE_AUTH_DOMAIN', import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
      projectId: required('VITE_FIREBASE_PROJECT_ID', import.meta.env.VITE_FIREBASE_PROJECT_ID),
      messagingSenderId: required('VITE_FIREBASE_MESSAGING_SENDER_ID', import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
      appId: required('VITE_FIREBASE_APP_ID', import.meta.env.VITE_FIREBASE_APP_ID),
    }),
  )
  return app
}

export function firebaseVapidKey() {
  return required('VITE_FIREBASE_VAPID_KEY', import.meta.env.VITE_FIREBASE_VAPID_KEY)
}

function adapter<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) throw new Error(`Set ${name} to ${allowed.join(' or ')} in .env (see .env.example).`)
  return value as T
}

function required(name: string, value: string | undefined) {
  if (!value) throw new Error(`Set ${name} in .env (see .env.example).`)
  return value
}
