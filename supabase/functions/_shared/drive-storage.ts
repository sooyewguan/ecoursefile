// Google Drive storage. The app signs in as the Google account in google.ts, with the drive.file
// scope, so it sees only the folders and files it made. Items live in folders under that
// account's My Drive, named as the path says.
//
// Drive finds items by id, not by path, and lets a folder hold two items of the same name. So the
// adapter walks the path one folder at a time from the root, and when two requests make the same
// folder at once, both use the older one. An empty newer folder may stay behind.
import { signedDownloadUrl } from './download-url.ts'
import { type DriveAccount, googleClient, googleFailure, refreshTokenGrant } from './google.ts'
import { firstBytes } from './http.ts'
import type { Storage, StoredItem } from './storage.ts'
import { PDF_TYPE } from './uploads.ts'

export const DRIVE_URL = 'https://www.googleapis.com/drive/v3'

const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'

const FOLDER_TYPE = 'application/vnd.google-apps.folder'

/** How long Drive keeps a resumable upload session open. */
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

/** A file as Drive lists it. Drive sends the size as a string. */
type DriveFile = { id: string; size?: string; mimeType: string }

const FILE_FIELDS = 'id,size,mimeType'

/** downloadFunctionUrl is the drive-download Edge Function's URL as the browser reaches it. */
export function driveStorage(account: DriveAccount, downloadFunctionUrl: string): Storage {
  const drive = googleClient(refreshTokenGrant(account))
  /** Folder ids by path. The adapter never deletes a folder, so an id stays right. */
  const folders = new Map<string, string>()

  async function list<T>(query: string, fields: string): Promise<T[]> {
    const params = new URLSearchParams({ q: query, fields: `files(${fields})`, spaces: 'drive', pageSize: '100' })
    const response = await drive('GET', `${DRIVE_URL}/files?${params}`)
    if (!response.ok) throw await googleFailure(response, 'list files')
    return (await response.json()).files
  }

  /** The oldest folder of the name in the parent, or null when there is none. */
  async function childFolder(parentId: string, name: string) {
    const found = await list<{ id: string; createdTime: string }>(
      `'${parentId}' in parents and name = '${quoted(name)}' and mimeType = '${FOLDER_TYPE}' and trashed = false`,
      'id,createdTime',
    )
    found.sort((a, b) => a.createdTime.localeCompare(b.createdTime) || a.id.localeCompare(b.id))
    return found[0]?.id ?? null
  }

  /** The id of the folder at path, made with any missing parents when make is true. Null when it is missing and make is false. */
  async function folderAt(path: string, make: boolean): Promise<string | null> {
    if (path === '') return 'root'
    const known = folders.get(path)
    if (known) return known
    const [parentPath, name] = split(path)
    const parentId = await folderAt(parentPath, make)
    if (!parentId) return null
    let id = await childFolder(parentId, name)
    if (!id && make) {
      const made = await drive('POST', `${DRIVE_URL}/files?fields=id`, { name, mimeType: FOLDER_TYPE, parents: [parentId] })
      if (!made.ok) throw await googleFailure(made, 'create folder')
      const { id: madeId }: { id: string } = await made.json()
      // A request at the same time may have made one too. Both take the older one.
      id = (await childFolder(parentId, name)) ?? madeId
    }
    if (id) folders.set(path, id)
    return id
  }

  return {
    // The session names the type, so Drive does not have to guess it. The files function takes only
    // .pdf names, and finalize checks the first bytes.
    // Drive takes the chunks without an Authorization header. It answers a browser's chunks with
    // CORS headers only when the request that opened the session named the browser's origin.
    async createUploadSession(path, origin) {
      const [folder, name] = split(path)
      const parentId = (await folderAt(folder, true))!
      const response = await drive('POST', `${UPLOAD_URL}?uploadType=resumable`, { name, parents: [parentId], mimeType: PDF_TYPE }, origin ? { Origin: origin } : {})
      const uploadUrl = response.headers.get('Location')
      if (!response.ok || !uploadUrl) throw await googleFailure(response, 'create upload session')
      await response.body?.cancel()
      return { uploadUrl, expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS).toISOString() }
    },

    async getItem(path) {
      const [folder, name] = split(path)
      const parentId = await folderAt(folder, false)
      if (!parentId) return null
      const [file] = await list<DriveFile>(`'${parentId}' in parents and name = '${quoted(name)}' and trashed = false`, FILE_FIELDS)
      return file ? storedItem(file) : null
    },

    async readStart(id, length) {
      const response = await drive('GET', `${DRIVE_URL}/files/${encodeURIComponent(id)}?alt=media`, undefined, { Range: `bytes=0-${length - 1}` })
      if (!response.ok) throw await googleFailure(response, 'download')
      return firstBytes(response, length)
    },

    // Drive copies at once and answers with the copy.
    async copyItem(id, path) {
      const [folder, name] = split(path)
      const parentId = (await folderAt(folder, true))!
      const response = await drive('POST', `${DRIVE_URL}/files/${encodeURIComponent(id)}/copy?fields=${FILE_FIELDS}`, { name, parents: [parentId] })
      if (response.status === 404) {
        await response.body?.cancel()
        return null
      }
      if (!response.ok) throw await googleFailure(response, 'copy')
      return storedItem(await response.json())
    },

    // Drive has no URL that gets a file without an Authorization header, so the drive-download
    // function gets the bytes as the account and streams them to the browser.
    downloadUrl: (id) => signedDownloadUrl(downloadFunctionUrl, id),

    // DELETE skips the trash.
    async deleteItem(id) {
      const response = await drive('DELETE', `${DRIVE_URL}/files/${encodeURIComponent(id)}`)
      if (!response.ok && response.status !== 404) throw await googleFailure(response, 'delete')
      await response.body?.cancel()
    },
  }
}

function storedItem(file: DriveFile): StoredItem {
  return { id: file.id, size: Number(file.size ?? 0), mimeType: file.mimeType }
}

/** The path's folder, which is empty at the root, and its last name. */
function split(path: string): [string, string] {
  const slash = path.lastIndexOf('/')
  return [slash === -1 ? '' : path.slice(0, slash), path.slice(slash + 1)]
}

/** text inside single quotes in a Drive query. */
function quoted(text: string) {
  return text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}
