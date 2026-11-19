import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !publishableKey) {
  throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env (see .env.example).')
}

export const supabase = createClient(url, publishableKey)

/** The Postgres error code for a write that would repeat a value a unique column already holds. */
export const UNIQUE_VIOLATION = '23505'
