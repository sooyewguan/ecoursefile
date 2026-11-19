// The upload URL of the fake storage adapter. Like a Graph upload session URL, it takes PUT
// requests without an Authorization header, each with one chunk and its Content-Range, and
// answers 202 until the last chunk, then 201 with the new item. Chunks other than the last must
// be multiples of 320 KiB, as Graph requires. It answers only while STORAGE_ADAPTER is fake.
import { isUuid, rest, SERVICE } from '../_shared/http.ts'

const CHUNK_MULTIPLE = 320 * 1024

const HEX = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'))

Deno.serve(async (req) => {
  if (Deno.env.get('STORAGE_ADAPTER') !== 'fake') return graphError(404, 'itemNotFound')
  if (req.method !== 'PUT') return graphError(405, 'invalidRequest')
  if (req.headers.has('Authorization')) return graphError(401, 'unauthenticated')

  const sessionId = new URL(req.url).pathname.split('/').pop()
  const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers.get('Content-Range') ?? '')
  if (!isUuid(sessionId) || !range) return graphError(400, 'invalidRequest')
  const [start, end, total] = range.slice(1).map(Number)
  const chunk = new Uint8Array(await req.arrayBuffer())
  const last = end + 1 === total
  if (chunk.length !== end - start + 1 || end >= total || (!last && chunk.length % CHUNK_MULTIPLE !== 0)) {
    return graphError(400, 'invalidRange')
  }

  const { status, body } = await rest<{ status: number; body: unknown }>(
    'POST',
    '/rpc/put_chunk',
    { session_id: sessionId, start, total, chunk: `\\x${hex(chunk)}` },
    SERVICE,
    { 'Content-Profile': 'fake_storage' },
  )
  return Response.json(body, { status })
})

function graphError(status: number, code: string) {
  return Response.json({ error: { code } }, { status })
}

function hex(bytes: Uint8Array) {
  let text = ''
  for (const byte of bytes) text += HEX[byte]
  return text
}
