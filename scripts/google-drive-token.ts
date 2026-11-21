// Prints a refresh token for the drive storage adapter. Run it on a computer with a browser, with
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET set to an OAuth client of the Desktop app type. It
// starts a server on a free local port, prints a Google sign-in link, and prints
// GOOGLE_REFRESH_TOKEN=... once you sign in with the Google account that will hold the files.
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

/** Lets the app see and change only the folders and files it makes. */
const SCOPE = 'https://www.googleapis.com/auth/drive.file'

const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].filter((name) => !process.env[name])
if (missing.length > 0) {
  console.error(`google-drive-token: missing required environment variables: ${missing.join(', ')}`)
  process.exit(1)
}
const clientId = process.env.GOOGLE_CLIENT_ID!
const clientSecret = process.env.GOOGLE_CLIENT_SECRET!
const state = randomBytes(16).toString('hex')
let redirectUri = ''

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', redirectUri)
  if (url.pathname !== '/') {
    res.writeHead(404).end()
    return
  }
  const code = url.searchParams.get('code')
  if (url.searchParams.get('state') !== state || !code) {
    res.writeHead(400).end(`Sign-in failed: ${url.searchParams.get('error') ?? 'the reply did not match this sign-in'}.`)
    return
  }
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  })
  const body: { refresh_token?: string; error_description?: string } = await response.json()
  if (!body.refresh_token) {
    res.writeHead(502).end('Google gave no refresh token. See the terminal.')
    console.error(`google-drive-token: Google gave no refresh token: ${body.error_description ?? response.status}`)
    process.exitCode = 1
  } else {
    res.end('Done. Go back to the terminal.')
    console.log(`GOOGLE_REFRESH_TOKEN=${body.refresh_token}`)
  }
  server.close()
})

server.listen(0, '127.0.0.1', () => {
  redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    // offline and consent make Google send a refresh token, even to an account that signed in before.
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  console.log(`Open this link and sign in with the Google account that will hold the files:\n\nhttps://accounts.google.com/o/oauth2/v2/auth?${params}\n`)
})
