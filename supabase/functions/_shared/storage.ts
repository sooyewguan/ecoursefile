// The storage library behind the files Edge Function. The STORAGE_ADAPTER secret picks SharePoint
// through Microsoft Graph (graph) or the local fake (fake). Paths are relative to the library's
// root, with / between folders.
import { fakeStorage } from './fake-storage.ts'
import { graphStorage } from './graph-storage.ts'
import type { Storage } from './storage-types.ts'

export type { Storage, StoredItem, UploadSession } from './storage-types.ts'

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
