// The download URLs of the drive storage adapter. Drive has no URL that gets a file's bytes without
// an Authorization header, so this function gets them as the app's Google account and streams them
// to the browser as they come. It answers GET of a URL that the adapter signed, until the expiry the
// URL carries. It answers only while STORAGE_ADAPTER is drive.
import { signedItemId } from '../_shared/download-url.ts'
import { DRIVE_URL, driveClient, driveCredentialsFromEnv } from '../_shared/drive-storage.ts'

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' }

const client = Deno.env.get('STORAGE_ADAPTER') === 'drive' ? driveClient(driveCredentialsFromEnv()) : null

Deno.serve(async (req) => {
  if (!client) return answer(404)
  if (req.method !== 'GET') return answer(405)
  const itemId = await signedItemId(new URL(req.url))
  if (!itemId) return answer(401)
  const file = await client.drive('GET', `${DRIVE_URL}/files/${encodeURIComponent(itemId)}?alt=media`)
  if (!file.ok) {
    console.error(`Drive download of ${itemId} failed with ${file.status}.`)
    await file.body?.cancel()
    return answer(file.status === 404 ? 404 : 502)
  }
  return new Response(file.body, { headers: { ...CORS_HEADERS, 'Content-Type': 'application/pdf' } })
})

function answer(status: number) {
  return new Response(null, { status, headers: CORS_HEADERS })
}
