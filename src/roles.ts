export const GLOBAL_ROLES = ['root', 'admin', 'lecturer', 'auditor', 'hod', 'dean', 'deputy_dean'] as const

export type GlobalRole = (typeof GLOBAL_ROLES)[number]

export const ROLE_LABELS: Record<GlobalRole, string> = {
  root: 'Root',
  admin: 'Admin',
  lecturer: 'Lecturer',
  auditor: 'Auditor',
  hod: 'HoD',
  dean: 'Dean',
  deputy_dean: 'Deputy Dean',
}

export function isGlobalRole(value: unknown): value is GlobalRole {
  return (GLOBAL_ROLES as readonly unknown[]).includes(value)
}
