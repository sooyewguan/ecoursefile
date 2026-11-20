// The storage adapter's types, apart from storage.ts so that Node code can import them without Deno.
export type StoredItem = { id: string; size: number; mimeType: string }

export type UploadSession = { uploadUrl: string; expiresAt: string }

export interface Storage {
  /** A pre-authenticated URL that takes the chunks of a new item at path. It never replaces an item. */
  createUploadSession(path: string): Promise<UploadSession>
  /** The item at path, or null when there is none. */
  getItem(path: string): Promise<StoredItem | null>
  /** The first length bytes of the item, or all of them when the item is shorter. */
  readStart(id: string, length: number): Promise<Uint8Array>
  /** Deletes the item for good. Deleting an item that is already gone succeeds. */
  deleteItem(id: string): Promise<void>
}
