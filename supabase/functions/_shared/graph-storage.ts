// SharePoint storage through Microsoft Graph. The Entra app has the Sites.Selected application
// permission and the write role on one site, and the items live in that site's default document
// library.
import { firstBytes, GRAPH_URL, graphClient, graphFailure, type GraphCredentials } from './graph.ts'
import type { Storage } from './storage.ts'

export type GraphStorageConfig = GraphCredentials & { siteId: string }

export function graphStorage(config: GraphStorageConfig): Storage {
  const drive = `${GRAPH_URL}/sites/${config.siteId}/drive`
  const { accessToken, graph } = graphClient(config)

  const itemAt = (path: string) => `${drive}/root:/${path.split('/').map(encodeURIComponent).join('/')}`

  async function getItem(path: string) {
    const response = await graph('GET', `${itemAt(path)}?$select=id,size,file`)
    if (response.status === 404) return null
    if (!response.ok) throw await graphFailure(response, 'get item')
    const item: { id: string; size: number; file?: { mimeType: string } } = await response.json()
    return { id: item.id, size: item.size, mimeType: item.file?.mimeType ?? '' }
  }

  /**
   * The folder at path, as the parentReference of a copy, made with any missing parents first. An
   * upload session makes its folders, but a copy needs its folder to exist.
   */
  async function folderAt(path: string): Promise<{ driveId: string; id: string }> {
    const found = await graph('GET', `${itemAt(path)}?$select=id,parentReference`)
    if (found.ok) return reference(await found.json())
    if (found.status !== 404) throw await graphFailure(found, 'get folder')
    await found.body?.cancel()
    const slash = path.lastIndexOf('/')
    const parent = slash === -1 ? `${drive}/root` : `${drive}/items/${(await folderAt(path.slice(0, slash))).id}`
    const made = await graph('POST', `${parent}/children`, {
      name: path.slice(slash + 1),
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    })
    // A request at the same time may have made it first.
    if (made.status === 409) {
      await made.body?.cancel()
      return folderAt(path)
    }
    if (!made.ok) throw await graphFailure(made, 'create folder')
    return reference(await made.json())
  }

  return {
    async createUploadSession(path) {
      const response = await graph('POST', `${itemAt(path)}:/createUploadSession`, {
        item: { '@microsoft.graph.conflictBehavior': 'fail' },
      })
      if (!response.ok) throw await graphFailure(response, 'createUploadSession')
      const session: { uploadUrl: string; expirationDateTime: string } = await response.json()
      return { uploadUrl: session.uploadUrl, expiresAt: session.expirationDateTime }
    },

    getItem,

    // /content usually redirects to a pre-authenticated download URL. Graph takes the Range header
    // only on that URL, so the redirect is followed by hand. When /content sends the bytes itself,
    // or the download URL ignores Range, only the first bytes are read.
    async readStart(id, length) {
      const content = await fetch(`${drive}/items/${encodeURIComponent(id)}/content`, {
        headers: { Authorization: `Bearer ${await accessToken()}` },
        redirect: 'manual',
      })
      const downloadUrl = content.headers.get('Location')
      if (content.ok && !downloadUrl) return firstBytes(content, length)
      if (!downloadUrl) throw await graphFailure(content, 'get content')
      await content.body?.cancel()
      const response = await fetch(downloadUrl, { headers: { Range: `bytes=0-${length - 1}` } })
      if (!response.ok) throw await graphFailure(response, 'download')
      return firstBytes(response, length)
    },

    // Graph copies in the background. It answers 202 with a monitor URL, which reports the copy's
    // status until it completes, and the copy is then at its path.
    async copyItem(id, path) {
      const slash = path.lastIndexOf('/')
      const response = await graph('POST', `${drive}/items/${encodeURIComponent(id)}/copy?@microsoft.graph.conflictBehavior=fail`, {
        parentReference: await folderAt(path.slice(0, slash)),
        name: path.slice(slash + 1),
      })
      if (response.status === 404) return null
      const monitorUrl = response.headers.get('Location')
      if (response.status !== 202 || !monitorUrl) throw await graphFailure(response, 'copy')
      await response.body?.cancel()
      await copyFinished(monitorUrl)
      const copy = await getItem(path)
      if (!copy) throw new Error(`Graph copy finished, but no item is at ${path}.`)
      return copy
    },

    // The item's @microsoft.graph.downloadUrl is pre-authenticated for about an hour, and a browser
    // gets it without a CORS preflight.
    async downloadUrl(id) {
      const response = await graph('GET', `${drive}/items/${encodeURIComponent(id)}?$select=id,@microsoft.graph.downloadUrl`)
      if (!response.ok) throw await graphFailure(response, 'get download URL')
      const item: { '@microsoft.graph.downloadUrl'?: string } = await response.json()
      const url = item['@microsoft.graph.downloadUrl']
      if (!url) throw new Error(`Graph item ${id} has no download URL.`)
      return url
    },

    async deleteItem(id) {
      const response = await graph('POST', `${drive}/items/${encodeURIComponent(id)}/permanentDelete`)
      if (!response.ok && response.status !== 404) throw await graphFailure(response, 'permanentDelete')
    },
  }
}

/** How long a copy may take. The Edge Function must answer within its 150 second wall clock limit. */
const COPY_WAIT_MS = 100_000

/**
 * Waits until the copy that the monitor URL reports on has completed, asking again after a pause
 * that doubles up to 4 seconds. The monitor URL is pre-authenticated, so it gets no Authorization
 * header. A copy that is still running after COPY_WAIT_MS fails here, and may still land later.
 */
async function copyFinished(monitorUrl: string) {
  const deadline = Date.now() + COPY_WAIT_MS
  for (let pause = 250; ; pause = Math.min(pause * 2, 4000)) {
    const response = await fetch(monitorUrl, { redirect: 'manual' })
    // A monitor may answer a completed copy with a redirect to the new item.
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      return
    }
    if (!response.ok) throw await graphFailure(response, 'copy monitor')
    const monitor: { status: string; error?: { message?: string } } = await response.json()
    if (monitor.status === 'completed') return
    if (monitor.status === 'failed') throw new Error(`Graph copy failed: ${monitor.error?.message ?? 'no reason given'}`)
    if (Date.now() + pause > deadline) throw new Error('Graph copy did not finish in time.')
    await new Promise((resolve) => setTimeout(resolve, pause))
  }
}

/** A drive item as the parentReference of a new item inside it. */
function reference(item: { id: string; parentReference: { driveId: string } }) {
  return { driveId: item.parentReference.driveId, id: item.id }
}
