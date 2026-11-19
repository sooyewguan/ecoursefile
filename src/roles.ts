export const GLOBAL_ROLES = ['root', 'admin', 'lecturer', 'auditor', 'hod', 'dean', 'deputy_dean'] as const

export type GlobalRole = (typeof GLOBAL_ROLES)[number]
