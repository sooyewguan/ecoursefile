import { createClient } from '@supabase/supabase-js'
import { ensureUser } from './ensure-user.ts'

const config = readConfig()

const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

await ensureUser(admin, {
  email: config.ROOT_EMAIL,
  password: config.ROOT_PASSWORD,
  fullName: config.ROOT_NAME,
  roles: ['root'],
  // The seed password sits in deployment config, so root replaces it on first sign-in.
  mustChangePassword: true,
})

console.log(`Root user ready: ${config.ROOT_EMAIL}`)

function readConfig() {
  const required = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'ROOT_EMAIL', 'ROOT_PASSWORD'] as const
  const missing = required.filter((name) => !process.env[name])
  if (missing.length > 0) {
    console.error(`seed-root: missing required environment variables: ${missing.join(', ')}`)
    process.exit(1)
  }
  const env = process.env as Record<(typeof required)[number], string>
  return {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY,
    ROOT_EMAIL: env.ROOT_EMAIL,
    ROOT_PASSWORD: env.ROOT_PASSWORD,
    ROOT_NAME: process.env.ROOT_NAME || 'Root',
  }
}
