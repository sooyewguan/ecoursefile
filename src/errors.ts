import { MIN_PASSWORD_LENGTH } from './auth.ts'

/**
 * An error whose message the app wrote for the person using it, such as a refused upload. The
 * files, audit-requests and accounts functions answer with { code, message }, and the browser
 * makes its own, such as for a PDF it cannot read. status is the HTTP status, or null for the browser's.
 */
export class UserFacingError extends Error {
  code: string
  status: number | null
  constructor(code: string, message: string, status: number | null = null) {
    super(message)
    this.code = code
    this.status = status
  }
}

export const FALLBACK_MESSAGE = 'Something went wrong. Try again.'
export const OFFLINE_MESSAGE = "Can't reach the server. Check your connection and try again."

/** Messages for error codes whose own message is not fit to show. */
const CODE_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Incorrect email or password.',
  weak_password: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  same_password: "Choose a password you haven't used here before.",
  otp_expired: 'This link has expired.',
  email_exists: 'An account with this email already exists.',
  over_email_send_rate_limit: 'Too many tries. Wait a minute, then try again.',
  over_request_rate_limit: 'Too many tries. Wait a minute, then try again.',
}

/**
 * Messages for Postgres error codes, for when the message is the database's own. The app's own SQL
 * functions raise the same codes with a sentence written for people, which shows as it is.
 */
const DATABASE_MESSAGES: Record<string, string> = {
  '23505': 'That already exists.',
  '42501': "You don't have permission to do that.",
}

/** What the errors of supabase-js, the Edge Functions and the browser have in common. Any may be missing. */
type ErrorFields = { name?: unknown; code?: unknown; status?: unknown; message?: unknown }

/**
 * The text to show for an error. codes gives the text for error codes in this context, such as a
 * clash on a unique code, and fallback the text for an error with nothing fit to show.
 *
 * A server message shows as it is only when it is a sentence: it starts with a capital and ends
 * with a stop. Postgres writes its own messages in lower case with no stop, and the app's SQL
 * functions and Edge Functions write sentences.
 */
export function friendlyError(error: unknown, { codes = {}, fallback = FALLBACK_MESSAGE }: { codes?: Record<string, string>; fallback?: string } = {}) {
  const fields: ErrorFields = typeof error === 'object' && error !== null ? error : {}
  const code = typeof fields.code === 'string' ? fields.code : ''
  const message = typeof fields.message === 'string' ? fields.message : ''
  if (codes[code]) return codes[code]
  if (isOffline(fields.name, message)) return OFFLINE_MESSAGE
  if (CODE_MESSAGES[code]) return CODE_MESSAGES[code]
  if (code === 'internal_error') return fallback
  if (error instanceof UserFacingError) return error.message
  if ((code || typeof fields.status === 'number') && /^[A-Z][\s\S]*[.!?]$/.test(message)) return message
  return DATABASE_MESSAGES[code] ?? fallback
}

/** Whether the request never reached the server, as each browser and supabase-js client says it. */
function isOffline(name: unknown, message: string) {
  return (
    name === 'AuthRetryableFetchError' ||
    name === 'FunctionsFetchError' ||
    /failed to fetch|fetch failed|networkerror|load failed|network request failed/i.test(message)
  )
}
