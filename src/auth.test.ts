import { expect, test } from 'vitest'
import { redirectFor, rolesFromAccessToken, type AuthState } from './auth.ts'
import type { GlobalRole } from './roles.ts'

const profile = { id: 'user-1', email: 'user@example.test', fullName: 'A User' }

function ready(...roles: GlobalRole[]): AuthState {
  return { kind: 'ready', profile, roles }
}

const states: Record<string, AuthState> = {
  loading: { kind: 'loading' },
  'signed-out': { kind: 'signed-out' },
  'must-change-password': { kind: 'must-change-password', profile },
  'ready lecturer': ready('lecturer'),
  'ready no roles': ready(),
  'ready root': ready('root'),
  'ready admin': ready('admin'),
  'ready hod and admin': ready('hod', 'admin'),
}

const otherPage = '/reports'

const expected: Record<keyof typeof states, Record<string, string | null>> = {
  loading: { '/': null, '/sign-in': null, '/change-password': null, [otherPage]: null, '/users': null, '/departments': null },
  'signed-out': {
    '/': '/sign-in',
    '/sign-in': null,
    '/change-password': '/sign-in',
    [otherPage]: '/sign-in',
    '/users': '/sign-in',
    '/departments': '/sign-in',
  },
  'must-change-password': {
    '/': '/change-password',
    '/sign-in': '/change-password',
    '/change-password': null,
    [otherPage]: '/change-password',
    '/users': '/change-password',
    '/departments': '/change-password',
  },
  'ready lecturer': { '/': null, '/sign-in': '/', '/change-password': '/', [otherPage]: null, '/users': '/', '/departments': '/' },
  'ready no roles': { '/': null, '/sign-in': '/', '/change-password': '/', [otherPage]: null, '/users': '/', '/departments': '/' },
  'ready root': { '/': null, '/sign-in': '/', '/change-password': '/', [otherPage]: null, '/users': null, '/departments': '/' },
  'ready admin': { '/': null, '/sign-in': '/', '/change-password': '/', [otherPage]: null, '/users': null, '/departments': null },
  'ready hod and admin': { '/': null, '/sign-in': '/', '/change-password': '/', [otherPage]: null, '/users': null, '/departments': null },
}

const cases = Object.entries(expected).flatMap(([state, byPath]) =>
  Object.entries(byPath).map(([path, target]) => [state, path, target] as const),
)

test.each(cases)('%s on %s redirects to %s', (state, path, target) => {
  expect(redirectFor(states[state], path)).toBe(target)
})

function token(claims: object) {
  const encode = (value: object) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  return `${encode({ alg: 'ES256', typ: 'JWT' })}.${encode(claims)}.signature`
}

test('roles come from the app_roles claim', () => {
  expect(rolesFromAccessToken(token({ sub: 'user-1', app_roles: ['hod', 'lecturer'], user_metadata: { full_name: 'Zoë Ng' } }))).toEqual([
    'hod',
    'lecturer',
  ])
})

test('a token without the app_roles claim has no roles', () => {
  expect(rolesFromAccessToken(token({ sub: 'user-1' }))).toEqual([])
})
