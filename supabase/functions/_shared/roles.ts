// The global roles, shared by the app and the Edge Functions. The global_role enum in SQL has the same ones.

export const GLOBAL_ROLES = ['root', 'admin', 'lecturer', 'auditor', 'hod', 'dean', 'deputy_dean'] as const

export type GlobalRole = (typeof GLOBAL_ROLES)[number]

export function isGlobalRole(value: unknown): value is GlobalRole {
  return (GLOBAL_ROLES as readonly unknown[]).includes(value)
}
