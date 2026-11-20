// The storage library behind the files Edge Function. The STORAGE_ADAPTER secret picks SharePoint
// through Microsoft Graph (graph) or the local fake (fake). Paths are relative to the library's
// root, with / between folders.
import { fakeStorage } from './fake-storage.ts'
import { graphStorage } from './graph-storage.ts'

export type StoredItem = { id: string; size: number; mimeType: string }

export type UploadSession = { uploadUrl: string; expiresAt: string }

export interface Storage {
  /** A pre-authenticated URL that takes the chunks of a new item at path. It never replaces an item. */
  createUploadSession(path: string): Promise<UploadSession>
  /** The item at path, or null when there is none. */
  getItem(path: string): Promise<StoredItem | null>
  /** The first length bytes of the item, or all of them when the item is shorter. */
  readStart(id: string, length: number): Promise<Uint8Array>
  /**
   * Copies the item to a new item at path and returns the copy, or null when there is no item with
   * id. It never replaces an item. The copy has its own bytes, so deleting either item leaves the other.
   */
  copyItem(id: string, path: string): Promise<StoredItem | null>
  /**
   * A pre-authenticated URL that gets the item's bytes with GET, without an Authorization header,
   * for about an hour. The browser compiles course files from these URLs.
   */
  downloadUrl(id: string): Promise<string>
  /** Deletes the item for good. Deleting an item that is already gone succeeds. */
  deleteItem(id: string): Promise<void>
}

export function storageFromEnv(): Storage {
  switch (Deno.env.get('STORAGE_ADAPTER')) {
    case 'graph':
      return graphStorage({
        tenantId: requiredEnv('GRAPH_TENANT_ID'),
        clientId: requiredEnv('GRAPH_CLIENT_ID'),
        clientSecret: requiredEnv('GRAPH_CLIENT_SECRET'),
        siteId: requiredEnv('GRAPH_SITE_ID'),
      })
    case 'fake':
      return fakeStorage(requiredEnv('FAKE_STORAGE_URL'))
    default:
      throw new Error('Set the STORAGE_ADAPTER secret to graph or fake.')
  }
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Set the ${name} secret.`)
  return value
}
