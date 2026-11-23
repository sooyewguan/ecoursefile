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

const otherPage = '/help'
const semesterPage = '/semesters/semester-1'
const courseFilePage = '/course-files/offering-1'

const expected: Record<keyof typeof states, Record<string, string | null>> = {
  loading: {
    '/': null,
    '/sign-in': null,
    '/change-password': null,
    '/forgot-password': null,
    [otherPage]: null,
    '/users': null,
    '/departments': null,
    [semesterPage]: null,
    [courseFilePage]: null,
    '/reports': null,
    '/completeness': null,
  },
  'signed-out': {
    '/': '/sign-in',
    '/sign-in': null,
    '/change-password': '/sign-in',
    '/forgot-password': null,
    [otherPage]: '/sign-in',
    '/users': '/sign-in',
    '/departments': '/sign-in',
    [semesterPage]: '/sign-in',
    [courseFilePage]: '/sign-in',
    '/reports': '/sign-in',
    '/completeness': '/sign-in',
  },
  'must-change-password': {
    '/': '/change-password',
    '/sign-in': '/change-password',
    '/change-password': null,
    '/forgot-password': '/change-password',
    [otherPage]: '/change-password',
    '/users': '/change-password',
    '/departments': '/change-password',
    [semesterPage]: '/change-password',
    [courseFilePage]: '/change-password',
    '/reports': '/change-password',
    '/completeness': '/change-password',
  },
  'ready lecturer': {
    '/': null,
    '/sign-in': '/',
    '/change-password': '/',
    '/forgot-password': '/',
    [otherPage]: null,
    '/users': '/',
    '/departments': '/',
    [semesterPage]: '/',
    [courseFilePage]: null,
    '/reports': '/',
    '/completeness': null,
  },
  'ready no roles': {
    '/': null,
    '/sign-in': '/',
    '/change-password': '/',
    '/forgot-password': '/',
    [otherPage]: null,
    '/users': '/',
    '/departments': '/',
    [semesterPage]: '/',
    [courseFilePage]: '/',
    '/reports': '/',
    '/completeness': '/',
  },
  'ready root': {
    '/': null,
    '/sign-in': '/',
    '/change-password': '/',
    '/forgot-password': '/',
    [otherPage]: null,
    '/users': null,
    '/departments': '/',
    [semesterPage]: '/',
    [courseFilePage]: '/',
    '/reports': '/',
    '/completeness': '/',
  },
  'ready admin': {
    '/': null,
    '/sign-in': '/',
    '/change-password': '/',
    '/forgot-password': '/',
    [otherPage]: null,
    '/users': null,
    '/departments': null,
    [semesterPage]: null,
    [courseFilePage]: null,
    '/reports': null,
    '/completeness': '/',
  },
  'ready hod and admin': {
    '/': null,
    '/sign-in': '/',
    '/change-password': '/',
    '/forgot-password': '/',
    [otherPage]: null,
    '/users': null,
    '/departments': null,
    [semesterPage]: null,
    [courseFilePage]: null,
    '/reports': null,
    '/completeness': '/',
  },
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
