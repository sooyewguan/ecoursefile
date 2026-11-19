import { expect, test } from 'vitest'
import { redirectFor, type AuthState } from './auth.ts'

const profile = { id: 'user-1', email: 'lecturer@example.test', fullName: 'A Lecturer' }

const states = {
  loading: { kind: 'loading' },
  'signed-out': { kind: 'signed-out' },
  'must-change-password': { kind: 'must-change-password', profile },
  ready: { kind: 'ready', profile, roles: ['lecturer'] },
} satisfies Record<AuthState['kind'], AuthState>

const otherPage = '/reports'

const expected: Record<AuthState['kind'], Record<string, string | null>> = {
  loading: { '/': null, '/sign-in': null, '/change-password': null, [otherPage]: null },
  'signed-out': { '/': '/sign-in', '/sign-in': null, '/change-password': '/sign-in', [otherPage]: '/sign-in' },
  'must-change-password': {
    '/': '/change-password',
    '/sign-in': '/change-password',
    '/change-password': null,
    [otherPage]: '/change-password',
  },
  ready: { '/': null, '/sign-in': '/', '/change-password': '/', [otherPage]: null },
}

const cases = Object.entries(expected).flatMap(([kind, byPath]) =>
  Object.entries(byPath).map(([path, target]) => [kind as AuthState['kind'], path, target] as const),
)

test.each(cases)('%s on %s redirects to %s', (kind, path, target) => {
  expect(redirectFor(states[kind], path)).toBe(target)
})
