// A stand-in for SharePoint on the local stack. It keeps items in the fake_storage schema, so seam 1
// tests can read what was stored and deleted.
// Its upload URLs point at the fake-storage Edge Function, which takes chunks the way Graph does.
import { rest, SERVICE } from './http.ts'
import type { Storage } from './storage.ts'

const SCHEMA = { 'Accept-Profile': 'fake_storage', 'Content-Profile': 'fake_storage' }

export function fakeStorage(uploadUrl: string): Storage {
  return {
    async createUploadSession(path) {
      const [session] = await rest<{ id: string; expires_at: string }[]>(
        'POST',
        '/upload_sessions?select=id,expires_at',
        { path },
        SERVICE,
        { ...SCHEMA, Prefer: 'return=representation' },
      )
      return { uploadUrl: `${uploadUrl}/${session.id}`, expiresAt: session.expires_at }
    },

    async getItem(path) {
      const [item] = await rest<{ id: string; size: number; mime_type: string }[]>(
        'GET',
        `/items?select=id,size,mime_type&path=eq.${encodeURIComponent(path)}`,
        undefined,
        SERVICE,
        SCHEMA,
      )
      return item ? { id: item.id, size: item.size, mimeType: item.mime_type } : null
    },

    async deleteItem(id) {
      await rest('DELETE', `/items?id=eq.${encodeURIComponent(id)}`, undefined, SERVICE, SCHEMA)
    },
  }
}
