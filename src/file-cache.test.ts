import { afterEach, beforeEach, expect, test, vi } from 'vitest'

type FileCache = typeof import('./file-cache.ts')

const DAY_MS = 24 * 60 * 60 * 1000

/** Cache Storage held in memory, as much of it as a browser's that the file cache uses. */
function memoryCaches() {
  const stores = new Map<string, Map<string, Response>>()
  const keyOf = (request: RequestInfo | URL) => (request instanceof Request ? request.url : String(request))
  const cache = (store: Map<string, Response>) =>
    ({
      match: async (request: RequestInfo | URL) => store.get(keyOf(request))?.clone(),
      put: async (request: RequestInfo | URL, response: Response) => void store.set(keyOf(request), response),
      delete: async (request: RequestInfo | URL) => store.delete(keyOf(request)),
      keys: async () => [...store.keys()],
    }) as unknown as Cache
  return {
    open: async (name: string) => cache(stores.get(name) ?? stores.set(name, new Map()).get(name)!),
    delete: async (name: string) => stores.delete(name),
  } as unknown as CacheStorage
}

/** The file cache as a new page load sees it, and a download that counts its calls and gives fresh bytes each time. */
async function pageLoad() {
  vi.resetModules()
  const fileCache: FileCache = await import('./file-cache.ts')
  const downloads: string[] = []
  const download = (fileId: string) => async () => {
    downloads.push(fileId)
    return new Blob([`${fileId} ${downloads.length}`], { type: 'application/pdf' })
  }
  const open = async (fileId: string) => (await fileCache.cachedFile(fileId, download(fileId))).text()
  return { ...fileCache, downloads, open }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-26T09:00:00Z'))
  vi.stubGlobal('caches', memoryCaches())
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('a file opened again gives the same bytes without downloading them again', async () => {
  const { open, downloads } = await pageLoad()

  expect(await open('a')).toBe('a 1')
  expect(await open('a')).toBe('a 1')

  expect(downloads).toEqual(['a'])
})

test('the bytes kept survive a new page load', async () => {
  await (await pageLoad()).open('a')
  const later = await pageLoad()

  expect(await later.open('a')).toBe('a 1')

  expect(later.downloads).toEqual([])
})

test('a different file id downloads its own bytes', async () => {
  const { open, downloads } = await pageLoad()

  await open('a')
  expect(await open('b')).toBe('b 2')

  expect(downloads).toEqual(['a', 'b'])
})

test('bytes kept for 30 days are downloaded again', async () => {
  const { open, downloads } = await pageLoad()
  await open('a')

  vi.setSystemTime(Date.now() + 30 * DAY_MS - 1)
  expect(await open('a')).toBe('a 1')
  vi.setSystemTime(Date.now() + 1)
  expect(await open('a')).toBe('a 2')

  expect(downloads).toEqual(['a', 'a'])
})

test('a new page load deletes the bytes kept for 30 days, even of files it does not open', async () => {
  await (await pageLoad()).open('old')
  vi.setSystemTime(Date.now() + 20 * DAY_MS)
  await (await pageLoad()).open('recent')
  vi.setSystemTime(Date.now() + 10 * DAY_MS)

  await (await pageLoad()).open('other')

  await vi.waitFor(async () => expect(await (await caches.open('files')).keys()).toHaveLength(2))
  const later = await pageLoad()
  expect(await later.open('recent')).toBe('recent 1')
  expect(later.downloads).toEqual([])
})

test('after clearFileCache every file downloads again', async () => {
  const { open, downloads, clearFileCache } = await pageLoad()
  await open('a')
  await open('b')

  await clearFileCache()
  await open('a')
  await open('b')

  expect(downloads).toEqual(['a', 'b', 'a', 'b'])
})

test('without Cache Storage every open downloads, and clearFileCache does nothing', async () => {
  vi.stubGlobal('caches', undefined)
  const { open, downloads, clearFileCache } = await pageLoad()

  expect(await open('a')).toBe('a 1')
  expect(await open('a')).toBe('a 2')
  await clearFileCache()

  expect(downloads).toEqual(['a', 'a'])
})

test.each([
  { failure: 'cannot be opened', broken: { open: () => Promise.reject(new DOMException('No storage', 'SecurityError')) } },
  { failure: 'is full', broken: { put: () => Promise.reject(new DOMException('Full', 'QuotaExceededError')) } },
  { failure: 'cannot be read', broken: { match: () => Promise.reject(new DOMException('Lost', 'UnknownError')) } },
])('when Cache Storage $failure, the file still opens with its downloaded bytes', async ({ broken }) => {
  const working = memoryCaches()
  vi.stubGlobal('caches', {
    open: 'open' in broken ? broken.open : async (name: string) => Object.assign(await working.open(name), broken),
    delete: () => Promise.reject(new DOMException('No storage', 'SecurityError')),
  })
  const { open, downloads, clearFileCache } = await pageLoad()

  expect(await open('a')).toBe('a 1')
  expect(await open('a')).toBe('a 2')
  await clearFileCache()

  expect(downloads).toEqual(['a', 'a'])
})

test('a download that fails fails the open, and keeps nothing', async () => {
  const { cachedFile, open, downloads } = await pageLoad()

  await expect(cachedFile('a', () => Promise.reject(new Error('HTTP 500')))).rejects.toThrow('HTTP 500')

  expect(await open('a')).toBe('a 1')
  expect(downloads).toEqual(['a'])
})
