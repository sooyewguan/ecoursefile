// Push notifications on this browser. Turning them on asks the browser's permission, registers the
// service worker public/push-sw.js, gets the browser's FCM registration token, and stores it for
// the signed-in user with register_push_token. The audit-requests function then sends audit
// request steps to it. The token is also kept in localStorage, so the app knows that this browser
// is on, and takes it off the account at sign-out.
import type { SupabaseClient } from '@supabase/supabase-js'
import { firebaseApp, firebaseVapidKey, PUSH_ADAPTER } from './firebase.ts'

const TOKEN_KEY = 'ecoursefile.pushToken'
const SERVICE_WORKER = '/push-sw.js'

/**
 * unsupported: the browser cannot take push, such as Safari on an iPhone outside a Home Screen app.
 * blocked: the user refused notifications for the site in the browser's settings.
 */
export type PushStatus = 'unsupported' | 'blocked' | 'off' | 'on'

export async function pushStatus(): Promise<PushStatus> {
  if (PUSH_ADAPTER === 'fake') return storedToken() ? 'on' : 'off'
  if (!(await browserSupportsPush())) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  return Notification.permission === 'granted' && storedToken() ? 'on' : 'off'
}

/** Turns notifications on for the signed-in user on this browser. Throws when the user refuses permission. */
export async function turnOnPush(client: SupabaseClient) {
  const token = PUSH_ADAPTER === 'fake' ? (storedToken() ?? `fake-${crypto.randomUUID()}`) : await fcmToken(true)
  const { error } = await client.rpc('register_push_token', { token })
  if (error) throw error
  storeToken(token)
}

/** Takes this browser's token off the signed-in user, when they turn notifications off or sign out. */
export async function turnOffPush(client: SupabaseClient) {
  const token = storedToken()
  if (!token) return
  storeToken(null)
  const { error } = await client.rpc('unregister_push_token', { token })
  if (error) console.error('Could not remove the push token', error)
}

/**
 * Registers this browser's token again, if notifications are on, for when the app opens. FCM may
 * give the browser a new token from time to time, and the old one then stops working.
 */
export async function refreshPush(client: SupabaseClient) {
  if ((await pushStatus()) !== 'on') return
  const old = storedToken()
  const token = PUSH_ADAPTER === 'fake' ? old! : await fcmToken(false)
  if (token !== old) await client.rpc('unregister_push_token', { token: old })
  const { error } = await client.rpc('register_push_token', { token })
  if (error) throw error
  storeToken(token)
}

async function browserSupportsPush() {
  if (!('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) return false
  const { isSupported } = await import('firebase/messaging')
  return isSupported()
}

async function fcmToken(askPermission: boolean) {
  if (askPermission && (await Notification.requestPermission()) !== 'granted') {
    throw new Error('Allow notifications for this site in your browser, then try again.')
  }
  const registration = await navigator.serviceWorker.register(SERVICE_WORKER)
  const { getMessaging, getToken } = await import('firebase/messaging')
  return getToken(getMessaging(await firebaseApp()), { vapidKey: firebaseVapidKey(), serviceWorkerRegistration: registration })
}

// localStorage can throw, such as in a private window with storage blocked. The app then treats
// notifications as off on this browser.

function storedToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Nothing to keep it in.
  }
}
