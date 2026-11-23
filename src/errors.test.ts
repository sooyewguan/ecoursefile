import { expect, test } from 'vitest'
import { FALLBACK_MESSAGE, friendlyError, OFFLINE_MESSAGE, UserFacingError } from './errors.ts'

// The errors below have the shapes that supabase-js gave against the local stack.

test.each([
  ['a wrong password', { name: 'AuthApiError', code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' }, 'Incorrect email or password.'],
  ['a short password', { name: 'AuthWeakPasswordError', code: 'weak_password', status: 422, message: 'Password should be at least 6 characters.' }, 'Use at least 6 characters.'],
  ['a reused password', { name: 'AuthApiError', code: 'same_password', status: 422, message: 'New password should be different from the old password.' }, "Choose a password you haven't used here before."],
  ['a used reset link', { name: 'AuthApiError', code: 'otp_expired', status: 403, message: 'Email link is invalid or has expired' }, 'This link has expired.'],
  ['a taken email', new UserFacingError('email_exists', 'A user with this email address has already been registered', 409), 'An account with this email already exists.'],
])('%s reads as our own words', (_, error, text) => {
  expect(friendlyError(error)).toBe(text)
})

test.each([
  ['supabase-js auth', { name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' }],
  ['supabase-js data', { code: '', message: 'TypeError: fetch failed' }],
  ['an Edge Function', { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' }],
  ['Chrome', new TypeError('Failed to fetch')],
  ['Firefox', new TypeError('NetworkError when attempting to fetch resource.')],
  ['Safari', new TypeError('Load failed')],
])('a request that %s could not send says the server is out of reach', (_, error) => {
  expect(friendlyError(error)).toBe(OFFLINE_MESSAGE)
})

test('a Postgres message never shows, and its code says what happened', () => {
  expect(friendlyError({ code: '42501', message: 'permission denied for table departments' })).toBe("You don't have permission to do that.")
  expect(friendlyError({ code: '23505', message: 'duplicate key value violates unique constraint "departments_code_key"' })).toBe('That already exists.')
  expect(friendlyError({ code: '22P02', message: 'invalid input syntax for type uuid: "nope"' })).toBe(FALLBACK_MESSAGE)
  expect(
    friendlyError({ code: '23503', message: 'update or delete on table "departments" violates foreign key constraint "profiles_department_id_fkey" on table "profiles"' }),
  ).toBe(FALLBACK_MESSAGE)
})

test('the context names the text for a code, and for an error with nothing to show', () => {
  const inUse = 'It still has courses or staff. Move them to another department first.'
  const raw = { code: '23503', message: 'update or delete on table "departments" violates foreign key constraint' }
  expect(friendlyError(raw, { codes: { '23503': inUse } })).toBe(inUse)
  expect(friendlyError({ code: '23505', message: 'duplicate key value' }, { codes: { '23505': 'A course with the code BITP1113 already exists.' } })).toBe(
    'A course with the code BITP1113 already exists.',
  )
  expect(friendlyError(new Error('Cannot read properties of undefined'), { fallback: "Couldn't sign in. Try again." })).toBe("Couldn't sign in. Try again.")
})

test('a sentence that the app wrote for people shows as it is', () => {
  // Raised by the tick_program_code SQL function, and by the hook that refuses a deactivated user.
  const sql = { code: '23503', message: 'This program code has no student timetable for the semester.' }
  expect(friendlyError(sql)).toBe(sql.message)
  const hook = { name: 'AuthApiError', code: 'unknown', status: 403, message: 'This account is deactivated.' }
  expect(friendlyError(hook)).toBe(hook.message)
  const refusal = new UserFacingError('unreadable_pdf', 'scan.pdf could not be read as a PDF. Export it as a PDF again and upload that.')
  expect(friendlyError(refusal)).toBe(refusal.message)
})

test('a message that no server wrote, or that only says the request failed, falls back', () => {
  expect(friendlyError(new Error('Something internal broke.'))).toBe(FALLBACK_MESSAGE)
  expect(friendlyError(new UserFacingError('internal_error', 'The request failed.', 500))).toBe(FALLBACK_MESSAGE)
  expect(friendlyError({ name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code' })).toBe(FALLBACK_MESSAGE)
  expect(friendlyError('oops')).toBe(FALLBACK_MESSAGE)
  expect(friendlyError(null)).toBe(FALLBACK_MESSAGE)
})
