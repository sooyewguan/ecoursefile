// The browser's copy of each file it opened, so that a file opened again does not download again.
// The bytes are kept in Cache Storage by the file's id, which never takes other bytes: replacing a
// file uploads a new file with a new id, and the database refuses any change to a file's id or
// storage item. The cache is a shortcut only. Without Cache Storage, such as on an insecure origin,
// or when it fails, such as when it is full, every file downloads as if nothing were kept.

/** How long the browser keeps a file's bytes: 30 days. */
export const KEEP_MS = 30 * 24 * 60 * 60 * 1000

const CACHE_NAME = 'files'
const CACHED_AT = 'X-Cached-At'

/**
 * The Cache Storage calls made here. They are typed here because the seam tests, which import this
 * module through uploads.ts, compile with Node's types, which have no Cache Storage.
 */
type Cache = {
  keys(): Promise<readonly Request[]>
  match(key: Request | string): Promise<Response | undefined>
  put(key: string, response: Response): Promise<void>
  delete(key: Request | string): Promise<boolean>
}
type CacheStorage = { open(name: string): Promise<Cache>; delete(name: string): Promise<boolean> }

/** The browser's Cache Storage, or undefined without it, such as in Node or on an insecure origin. */
const cacheStorage = () => (globalThis as { caches?: CacheStorage }).caches

/** Whether a sweep of the expired bytes has started since the page loaded. */
let swept = false

/** The key of a file's bytes: a same-origin path that the app never requests. */
function keyOf(fileId: string) {
  return `/cached-files/${encodeURIComponent(fileId)}`
}

/** Whether the bytes were kept KEEP_MS or longer ago. */
function expired(response: Response) {
  return !(Date.now() - Number(response.headers.get(CACHED_AT)) < KEEP_MS)
}

/** The cache, or null without Cache Storage. Once per page load, it starts deleting the expired bytes. */
async function openCache() {
  const storage = cacheStorage()
  if (!storage) return null
  const cache = await storage.open(CACHE_NAME)
  if (!swept) {
    swept = true
    void sweep(cache).catch(() => {})
  }
  return cache
}

async function sweep(cache: Cache) {
  for (const key of await cache.keys()) {
    const response = await cache.match(key)
    if (response && expired(response)) await cache.delete(key)
  }
}

/** The bytes kept for the file, or undefined when none are kept or they expired, which it deletes. */
async function read(fileId: string) {
  const cache = await openCache()
  const response = await cache?.match(keyOf(fileId))
  if (!cache || !response) return undefined
  if (!expired(response)) return response.blob()
  await cache.delete(keyOf(fileId))
  return undefined
}

async function write(fileId: string, blob: Blob) {
  const cache = await openCache()
  const headers = { 'Content-Type': blob.type, [CACHED_AT]: String(Date.now()) }
  await cache?.put(keyOf(fileId), new Response(blob, { headers }))
}

/**
 * The file's bytes: those kept from an earlier download if they are under KEEP_MS old, or else
 * those that download gets, which are kept for the next time. A cache that fails never fails the
 * file. A download that fails does, and keeps nothing.
 */
export async function cachedFile(fileId: string, download: () => Promise<Blob>): Promise<Blob> {
  const kept = await read(fileId).catch(() => undefined)
  if (kept) return kept
  const blob = await download()
  await write(fileId, blob).catch(() => {})
  return blob
}

/** Deletes every file's bytes the browser keeps, such as at sign-out, so the next user of the browser finds none. */
export async function clearFileCache() {
  await cacheStorage()?.delete(CACHE_NAME).catch(() => {})
}
