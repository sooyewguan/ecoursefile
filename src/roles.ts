import { GLOBAL_ROLES, isGlobalRole, type GlobalRole } from '../supabase/functions/_shared/roles.ts'

export { GLOBAL_ROLES, isGlobalRole, type GlobalRole }

export const ROLE_LABELS: Record<GlobalRole, string> = {
  root: 'Root',
  admin: 'Admin',
  lecturer: 'Lecturer',
  auditor: 'Auditor',
  hod: 'HoD',
  dean: 'Dean',
  deputy_dean: 'Deputy Dean',
}
