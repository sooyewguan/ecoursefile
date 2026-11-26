// The upload and download URLs of the fake storage adapter. It answers only while STORAGE_ADAPTER
// is fake.
//
// An upload URL works like a Drive resumable upload session URL. It takes PUT requests without an
// Authorization header, each with one chunk and its Content-Range, and answers 308 until the last
// chunk, then 201 with the new item. Chunks other than the last must be multiples of 256 KiB, as
// Drive requires.
//
// A download URL answers GET without an Authorization header with the item's bytes, until the
// expiry it carries, if its signature matches.
import { signedItemId } from '../_shared/download-url.ts'
import { isUuid, rest, SERVICE, serviceGet } from '../_shared/http.ts'

const CHUNK_MULTIPLE = 256 * 1024

Deno.serve(async (req) => {
  if (Deno.env.get('STORAGE_ADAPTER') !== 'fake') return failure(404, 'itemNotFound')
  if (req.method === 'GET') return download(new URL(req.url))
  if (req.method !== 'PUT') return failure(405, 'invalidRequest')
  if (req.headers.has('Authorization')) return failure(401, 'unauthenticated')

  const sessionId = new URL(req.url).pathname.split('/').pop()
  const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers.get('Content-Range') ?? '')
  if (!isUuid(sessionId) || !range) return failure(400, 'invalidRequest')
  const [start, end, total] = range.slice(1).map(Number)
  const chunk = new Uint8Array(await req.arrayBuffer())
  const last = end + 1 === total
  if (chunk.length !== end - start + 1 || end >= total || (!last && chunk.length % CHUNK_MULTIPLE !== 0)) {
    return failure(400, 'invalidRange')
  }

  // The bytes go to the database as they came. Encoding them as text cost the worker's CPU limit.
  const { status, body } = await rest<{ status: number; body: unknown }>('POST', '/rpc/put_chunk', chunk, SERVICE, {
    'Content-Profile': 'fake_storage',
    'X-Upload-Session': sessionId,
    'X-Upload-Start': String(start),
    'X-Upload-Total': String(total),
  })
  // put_chunk answers 202 for a chunk before the last, where Drive answers 308 Resume Incomplete.
  return Response.json(body, { status: status === 202 ? 308 : status })
})

// The bytes stream from PostgREST to the browser as they come, so the worker neither holds nor
// encodes them.
async function download(url: URL) {
  const itemId = await signedItemId(url)
  if (!isUuid(itemId)) return failure(401, 'unauthenticated')
  const item = await serviceGet(`/rpc/read_item?item_id=${itemId}`, { 'Accept-Profile': 'fake_storage', Accept: 'application/octet-stream' })
  if (!item.ok) {
    await item.body?.cancel()
    return failure(404, 'itemNotFound')
  }
  return new Response(item.body, { headers: { 'Content-Type': 'application/octet-stream' } })
}

function failure(status: number, code: string) {
  return Response.json({ error: { code } }, { status })
}
