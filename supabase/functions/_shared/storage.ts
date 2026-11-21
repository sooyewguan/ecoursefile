// The storage library behind the files Edge Function. The STORAGE_ADAPTER secret picks Google Drive
// (drive) or the local fake (fake). Paths are relative to the library's root, with / between folders.
import { driveStorage } from './drive-storage.ts'
import { fakeStorage } from './fake-storage.ts'
import { googleCredentialsFromEnv } from './google.ts'
import { requiredEnv } from './http.ts'

export type StoredItem = { id: string; size: number; mimeType: string }

export type UploadSession = { uploadUrl: string; expiresAt: string }

export interface Storage {
  /**
   * A pre-authenticated URL that takes the chunks of a new item at path. It never replaces an item.
   * origin is the Origin header of the browser that will send the chunks, if it sent one.
   */
  createUploadSession(path: string, origin: string | null): Promise<UploadSession>
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
    case 'drive':
      return driveStorage(googleCredentialsFromEnv(), `${requiredEnv('SUPABASE_URL')}/functions/v1/drive-download`)
    case 'fake':
      return fakeStorage(requiredEnv('FAKE_STORAGE_URL'))
    default:
      throw new Error('Set the STORAGE_ADAPTER secret to drive or fake.')
  }
}
