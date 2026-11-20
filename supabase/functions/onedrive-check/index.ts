// Checks that a OneDrive can hold eCourseFile's files, in the deployed stack. The OneDrive check page
// calls it as a signed-in admin. This function makes the Graph calls with the files function's
// adapter, and the page sends the file from the browser, as a real upload does. See the README
// section "Checking a OneDrive".
import { clientCredentialsToken, GRAPH_URL, graphDriveStorage, graphFailure } from '../_shared/graph-storage.ts'
import { invalid, isRecord, Refusal, rest, serveJson } from '../_shared/http.ts'
import type { Storage } from '../_shared/storage.ts'
import { PDF_SIGNATURE } from '../_shared/uploads.ts'

/** The folder that holds each run's file. Every run deletes it at the end. */
const CHECK_FOLDER = 'eCourseFile/_onedrive-check'

/** A run's ID is its start time, which names its file. */
const RUN_ID = /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z$/

type Step = { name: string; ok: boolean; note: string }

type Config =
  | { signIn: 'app'; tenantId: string; clientId: string; clientSecret: string; user: string }
  | { signIn: 'user'; tenantId: string; clientId: string }

serveJson(async (body, caller) => {
  const roles = await rest<string[]>('POST', '/rpc/jwt_roles', {}, caller)
  if (!roles.includes('admin')) throw new Refusal(403, 'forbidden', 'Only admins may run the OneDrive check.')
  const config = readConfig()
  const input = isRecord(body) ? body : {}

  switch (input.action) {
    case 'begin':
      return config.signIn === 'app' ? { signIn: 'app' } : { signIn: 'user', ...(await deviceCode(config)) }
    case 'token':
      if (config.signIn !== 'user' || typeof input.deviceCode !== 'string') throw invalid('token needs deviceCode.')
      return await redeemDeviceCode(config, input.deviceCode)
    case 'start':
      return await start(storageFor(config, input))
    case 'finish':
      return await finish(storageFor(config, input), runIdOf(input), sizeOf(input))
    case 'clean-up':
      runIdOf(input)
      return { steps: await cleanUp(storageFor(config, input).storage) }
    default:
      throw invalid('action must be begin, token, start, finish or clean-up.')
  }
})

/**
 * Reads the drive and opens an upload session at a new path, whose folders do not exist yet.
 * The page then sends the file to uploadUrl and calls finish with the runId.
 */
async function start({ storage, drive, accessToken }: Graph) {
  const runId = new Date().toISOString().replaceAll(':', '-')
  const steps: Step[] = []
  let uploadUrl: string | undefined
  const passed =
    (await step(steps, 'Read the drive', async () => {
      const response = await fetch(`${drive}?$select=driveType,owner,quota`, {
        headers: { Authorization: `Bearer ${await accessToken()}` },
      })
      if (!response.ok) throw await graphFailure(response, 'get drive')
      const info: {
        driveType: string
        owner?: { user?: { displayName?: string } }
        quota?: { total?: number; used?: number; remaining?: number }
      } = await response.json()
      const gib = (n?: number) => (n === undefined ? '?' : `${(n / 1024 ** 3).toFixed(1)} GiB`)
      return `${info.driveType} drive of ${info.owner?.user?.displayName ?? 'unknown owner'}, ${gib(info.quota?.used)} used of ${gib(info.quota?.total)}, ${gib(info.quota?.remaining)} free`
    })) &&
    (await step(steps, 'Open an upload session at a new path', async () => {
      const session = await storage.createUploadSession(pathOf(runId))
      uploadUrl = session.uploadUrl
      return `${pathOf(runId)}, expires ${session.expiresAt}`
    }))
  if (!passed) steps.push(...(await cleanUp(storage)))
  return { steps, runId, uploadUrl: passed ? uploadUrl : undefined }
}

/** Checks the item that the page sent, deletes it, and deletes the check folder. */
async function finish({ storage }: Graph, runId: string, size: number) {
  const path = pathOf(runId)
  const steps: Step[] = []
  let id = ''
  ;(await step(steps, 'Find the item at its path', async () => {
    const item = await storage.getItem(path)
    if (!item) throw new Error('no item at the path')
    if (item.size !== size) throw new Error(`size ${item.size}, expected ${size}`)
    if (item.mimeType !== 'application/pdf') throw new Error(`type ${item.mimeType}, expected application/pdf`)
    id = item.id
    return `size ${item.size}, type ${item.mimeType}`
  })) &&
    (await step(steps, 'Refuse a second upload to the same path', async () => {
      let status: number
      try {
        const again = await storage.createUploadSession(path)
        const response = await fetch(again.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Range': `bytes 0-${PDF_SIGNATURE.length - 1}/${PDF_SIGNATURE.length}` },
          body: PDF_SIGNATURE,
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
      if (kept?.size !== size) throw new Error('the first item changed')
      return 'refused when the bytes arrived (409), first item kept'
    })) &&
    (await step(steps, 'Read the first bytes', async () => {
      const text = new TextDecoder().decode(await storage.readStart(id, PDF_SIGNATURE.length))
      if (text !== '%PDF-') throw new Error(`read ${JSON.stringify(text)}`)
      return text
    })) &&
    (await step(steps, 'Delete the item for good', async () => {
      await storage.deleteItem(id)
      if (await storage.getItem(path)) throw new Error('the item is still at its path')
      await storage.deleteItem(id)
      return 'gone, and deleting it again succeeds'
    }))
  steps.push(...(await cleanUp(storage)))
  return { steps }
}

/** Deletes the check folder for good. It leaves eCourseFile, which a real upload would make anyway. */
async function cleanUp(storage: Storage) {
  const steps: Step[] = []
  await step(steps, `Delete ${CHECK_FOLDER}`, async () => {
    const folder = await storage.getItem(CHECK_FOLDER)
    if (!folder) return 'nothing to delete'
    await storage.deleteItem(folder.id)
    return 'deleted'
  })
  return steps
}

/** Runs one step, adds its result to steps, and returns whether it passed. */
async function step(steps: Step[], name: string, run: () => Promise<string>) {
  try {
    steps.push({ name, ok: true, note: await run() })
    return true
  } catch (error) {
    console.error(name, error)
    steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) })
    return false
  }
}

/** The same folder shape as a real file, with spaces. */
function pathOf(runId: string) {
  return `${CHECK_FOLDER}/BITP1113 Programming/02 Teaching Plan/${runId}_check.pdf`
}

type Graph = { storage: Storage; drive: string; accessToken: () => Promise<string> }

/**
 * The OneDrive and a way to get a token. With app sign-in, the drive is ONEDRIVE_USER's and the
 * token the Entra app's. With user sign-in, the drive is the signed-in person's, and the page sends
 * the token that token gave it.
 */
function storageFor(config: Config, input: Record<string, unknown>): Graph {
  let drive: string
  let accessToken: () => Promise<string>
  if (config.signIn === 'app') {
    drive = `${GRAPH_URL}/users/${encodeURIComponent(config.user)}/drive`
    accessToken = clientCredentialsToken(config)
  } else {
    const token = input.graphToken
    if (typeof token !== 'string' || token === '') throw invalid('Sign in to Microsoft first: graphToken is missing.')
    drive = `${GRAPH_URL}/me/drive`
    accessToken = async () => token
  }
  return { storage: graphDriveStorage(drive, accessToken), drive, accessToken }
}

/** Starts the device code flow: the person enters userCode at verificationUri. */
async function deviceCode(config: { tenantId: string; clientId: string }) {
  const response = await fetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/devicecode`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: config.clientId, scope: 'https://graph.microsoft.com/Files.ReadWrite' }),
  })
  if (!response.ok) throw await graphFailure(response, 'device code request')
  const code: { device_code: string; user_code: string; verification_uri: string; interval: number } = await response.json()
  return { deviceCode: code.device_code, userCode: code.user_code, verificationUri: code.verification_uri, interval: code.interval }
}

/** Asks once whether the person has signed in. The page asks again every interval seconds while pending. */
async function redeemDeviceCode(config: { tenantId: string; clientId: string }, deviceCode: string) {
  const response = await fetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: config.clientId,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
    }),
  })
  const body: { access_token?: string; error?: string; error_description?: string } = await response.json()
  if (body.access_token) return { graphToken: body.access_token }
  if (body.error === 'authorization_pending' || body.error === 'slow_down') return { pending: true }
  throw new Refusal(400, 'sign_in_failed', `Microsoft sign-in failed: ${body.error_description ?? body.error}`)
}

function runIdOf(input: Record<string, unknown>) {
  if (typeof input.runId !== 'string' || !RUN_ID.test(input.runId)) throw invalid('runId is not a run ID from start.')
  return input.runId
}

function sizeOf(input: Record<string, unknown>) {
  if (typeof input.size !== 'number' || !Number.isInteger(input.size) || input.size <= 0) throw invalid('size must be a positive integer.')
  return input.size
}

function readConfig(): Config {
  const env = (name: string) => Deno.env.get(name) ?? ''
  const signIn = env('ONEDRIVE_SIGN_IN')
  const required =
    signIn === 'app'
      ? ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'ONEDRIVE_USER']
      : ['ONEDRIVE_SIGN_IN', 'GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID']
  const missing = required.filter((name) => !env(name))
  if ((signIn !== 'app' && signIn !== 'user') || missing.length > 0) {
    const names = missing.length > 0 ? missing : ['ONEDRIVE_SIGN_IN']
    throw new Refusal(503, 'not_configured', `Set these secrets first: ${names.join(', ')}. ONEDRIVE_SIGN_IN must be app or user.`)
  }
  const common = { tenantId: env('GRAPH_TENANT_ID'), clientId: env('GRAPH_CLIENT_ID') }
  return signIn === 'app'
    ? { ...common, signIn, clientSecret: env('GRAPH_CLIENT_SECRET'), user: env('ONEDRIVE_USER') }
    : { ...common, signIn }
}
