// Signed download URLs, for the storage adapters whose store gives the browser no URL of its own.
// A URL names an Edge Function, the item and an expiry, with an HMAC of the item and expiry keyed
// with the service role key, so it needs no stored session. The function serves the item's bytes
// while the signature matches and the expiry is in the future.
import { SERVICE } from './http.ts'

/** How long a download URL works. */
const LIFETIME_MS = 60 * 60 * 1000

const signingKey = crypto.subtle.importKey('raw', new TextEncoder().encode(SERVICE), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])

/** A URL at functionUrl that gets the item for the next hour. */
export async function signedDownloadUrl(functionUrl: string, itemId: string) {
  const expires = String(Date.now() + LIFETIME_MS)
  return `${functionUrl}/${encodeURIComponent(itemId)}?expires=${expires}&signature=${await signature(itemId, expires)}`
}

/** The item that a signed download URL names, or null when its signature is wrong or it has expired. */
export async function signedItemId(url: URL) {
  const itemId = decodeURIComponent(url.pathname.split('/').pop() ?? '')
  const expires = url.searchParams.get('expires') ?? ''
  if (!itemId || !(Number(expires) > Date.now())) return null
  return url.searchParams.get('signature') === (await signature(itemId, expires)) ? itemId : null
}

/** An HMAC of the item and expires, in milliseconds since 1970, in hex. */
async function signature(itemId: string, expires: string) {
  const mac = await crypto.subtle.sign('HMAC', await signingKey, new TextEncoder().encode(`${itemId}/${expires}`))
  return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
