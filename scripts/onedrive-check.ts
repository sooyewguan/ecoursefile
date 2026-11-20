// Checks that a OneDrive can hold eCourseFile's files. It runs the Graph storage adapter of the
// files Edge Function and the browser's chunk upload against the OneDrive, step by step, and then
// deletes what it made. Run it with `npm run onedrive:check`. The README section "Checking a
// OneDrive" lists the variables and the Entra app that each sign-in needs.
import {
  clientCredentialsToken,
  GRAPH_URL,
  graphDriveStorage,
  graphFailure,
} from '../supabase/functions/_shared/graph-storage.ts'
import { PDF_SIGNATURE } from '../supabase/functions/_shared/uploads.ts'
import { sendChunks } from '../src/uploads.ts'

const config = readConfig()
const accessToken = config.signIn === 'app' ? clientCredentialsToken(config) : await deviceCodeToken(config)
const drive =
  config.signIn === 'app' ? `${GRAPH_URL}/users/${encodeURIComponent(config.user)}/drive` : `${GRAPH_URL}/me/drive`
const storage = graphDriveStorage(drive, accessToken)

// The same folder shape as a real file, with spaces, under a folder that the check deletes at the end.
const CHECK_FOLDER = 'eCourseFile/_onedrive-check'
const path = `${CHECK_FOLDER}/BITP1113 Programming/02 Teaching Plan/${new Date().toISOString().replaceAll(':', '-')}_check.pdf`
// Larger than one 5 MiB chunk, so the upload takes two chunks, and the last one is not a multiple of 320 KiB.
const bytes = testPdf(6 * 1024 * 1024 + 1234)

let failed = false
try {
  await step('Read the drive', async () => {
    const response = await fetch(`${drive}?$select=driveType,owner,quota`, {
      headers: { Authorization: `Bearer ${await accessToken()}` },
    })
    if (!response.ok) throw await graphFailure(response, 'get drive')
    const info = (await response.json()) as {
      driveType: string
      owner?: { user?: { displayName?: string } }
      quota?: { total?: number; used?: number; remaining?: number }
    }
    const gib = (n?: number) => (n === undefined ? '?' : `${(n / 1024 ** 3).toFixed(1)} GiB`)
    return `${info.driveType} drive of ${info.owner?.user?.displayName ?? 'unknown owner'}, ${gib(info.quota?.used)} used of ${gib(info.quota?.total)}, ${gib(info.quota?.remaining)} free`
  })

  const session = await step('Open an upload session at a new path', async () => {
    const session = await storage.createUploadSession(path)
    return [session, `expires ${session.expiresAt}`] as const
  })

  await step(`Upload URL allows a browser PUT from ${config.origin}`, async () => {
    const response = await fetch(session.uploadUrl, {
      method: 'OPTIONS',
      headers: {
        Origin: config.origin,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-range',
      },
    })
    const allowed = response.headers.get('Access-Control-Allow-Origin')
    if (allowed !== '*' && allowed !== config.origin) {
      throw new Error(`the preflight answered ${response.status} with Access-Control-Allow-Origin ${allowed ?? 'missing'}`)
    }
    return `Access-Control-Allow-Origin: ${allowed}`
  })

  await step('Send the file in 5 MiB chunks without an Authorization header', async () => {
    await sendChunks(session.uploadUrl, new Blob([bytes], { type: 'application/pdf' }))
    return `${bytes.length} bytes`
  })

  const item = await step('Find the item at its path', async () => {
    const item = await storage.getItem(path)
    if (!item) throw new Error('no item at the path')
    if (item.size !== bytes.length) throw new Error(`size ${item.size}, expected ${bytes.length}`)
    if (item.mimeType !== 'application/pdf') throw new Error(`type ${item.mimeType}, expected application/pdf`)
    return [item, `size ${item.size}, type ${item.mimeType}`] as const
  })

  await step('Refuse a second upload to the same path', async () => {
    const small = new Uint8Array(PDF_SIGNATURE)
    let status: number
    try {
      const again = await storage.createUploadSession(path)
      const response = await fetch(again.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes 0-${small.length - 1}/${small.length}` },
        body: small,
      })
      status = response.status
      await response.body?.cancel()
      if (!response.ok) await fetch(again.uploadUrl, { method: 'DELETE' })
    } catch (error) {
      if (!String(error).includes('failed with 409')) throw error
      return 'refused when the session opened (409)'
    }
    if (status !== 409) throw new Error(`the upload answered ${status}, expected 409`)
    const kept = await storage.getItem(path)
    if (kept?.size !== bytes.length) throw new Error('the first item changed')
    return 'refused when the bytes arrived (409), first item kept'
  })

  await step('Read the first bytes', async () => {
    const start = await storage.readStart(item.id, PDF_SIGNATURE.length)
    const text = new TextDecoder().decode(start)
    if (text !== '%PDF-') throw new Error(`read ${JSON.stringify(text)}`)
    return text
  })

  await step('Delete the item for good', async () => {
    await storage.deleteItem(item.id)
    if (await storage.getItem(path)) throw new Error('the item is still at its path')
    await storage.deleteItem(item.id)
    return 'gone, and deleting it again succeeds'
  })
} catch {
  failed = true
} finally {
  // Leaves eCourseFile itself, which a real upload would make anyway.
  const folder = await storage.getItem(CHECK_FOLDER).catch(() => null)
  if (folder) await storage.deleteItem(folder.id).catch((error) => console.error(`Could not delete ${CHECK_FOLDER}: ${error}`))
}

console.log(failed ? '\nThe OneDrive failed the check.' : '\nThe OneDrive passed every step.')
process.exit(failed ? 1 : 0)

/** Runs one step and prints its result. A step returns a note, or a value and a note. */
async function step<T>(name: string, run: () => Promise<string | readonly [T, string]>): Promise<T> {
  try {
    const result = await run()
    const [value, note] = typeof result === 'string' ? [undefined as T, result] : result
    console.log(`ok    ${name}: ${note}`)
    return value
  } catch (error) {
    console.log(`FAIL  ${name}: ${error instanceof Error ? error.message : error}`)
    throw error
  }
}

/** Random bytes that start with the PDF signature, which is all that finalize-upload reads. */
function testPdf(size: number) {
  const bytes = new Uint8Array(size)
  for (let start = 0; start < size; start += 65_536) crypto.getRandomValues(bytes.subarray(start, start + 65_536))
  bytes.set(new TextEncoder().encode('%PDF-1.7\n'))
  return bytes
}

/**
 * Signs in a person with the device code flow: it prints a code to enter at the Microsoft sign-in
 * page, and waits until they have signed in. The token lasts about an hour, which is enough.
 */
async function deviceCodeToken(config: { tenantId: string; clientId: string }) {
  const authority = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0`
  const response = await fetch(`${authority}/devicecode`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: config.clientId, scope: 'https://graph.microsoft.com/Files.ReadWrite' }),
  })
  if (!response.ok) throw await graphFailure(response, 'device code request')
  const code = (await response.json()) as { device_code: string; message: string; interval: number; expires_in: number }
  console.log(code.message)

  let interval = code.interval
  const deadline = Date.now() + code.expires_in * 1000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval * 1000))
    const poll = await fetch(`${authority}/token`, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: config.clientId,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: code.device_code,
      }),
    })
    const body = (await poll.json()) as { access_token?: string; error?: string; error_description?: string }
    if (body.access_token) {
      console.log('Signed in.\n')
      const token = body.access_token
      return async () => token
    }
    if (body.error === 'slow_down') interval += 5
    else if (body.error !== 'authorization_pending') throw new Error(`Sign-in failed: ${body.error_description ?? body.error}`)
  }
  throw new Error('Sign-in timed out.')
}

function readConfig() {
  const env = process.env
  const signIn = env.ONEDRIVE_SIGN_IN
  const required =
    signIn === 'app'
      ? ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'ONEDRIVE_USER']
      : ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID']
  const missing = required.filter((name) => !env[name])
  if ((signIn !== 'app' && signIn !== 'user') || missing.length > 0) {
    console.error('onedrive-check: set ONEDRIVE_SIGN_IN to app or user.')
    if (missing.length > 0) console.error(`onedrive-check: missing required environment variables: ${missing.join(', ')}`)
    process.exit(1)
  }
  const common = {
    tenantId: env.GRAPH_TENANT_ID!,
    clientId: env.GRAPH_CLIENT_ID!,
    origin: env.APP_ORIGIN ?? 'http://localhost:5173',
  }
  return signIn === 'app'
    ? { ...common, signIn: 'app' as const, clientSecret: env.GRAPH_CLIENT_SECRET!, user: env.ONEDRIVE_USER! }
    : { ...common, signIn: 'user' as const }
}
