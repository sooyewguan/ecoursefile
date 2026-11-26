import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { GLOBAL_ROLES, ROLE_LABELS, type GlobalRole } from '../roles.ts'

/** A user's roles as badges, in the fixed role order. Root and admin stand out. */
export function RoleBadges({ roles, className }: { roles: readonly GlobalRole[]; className?: string }) {
  if (roles.length === 0) return <span className={cn('text-muted-foreground text-sm', className)}>No roles</span>
  return (
    <ul aria-label="Roles" className={cn('flex flex-wrap gap-1', className)}>
      {GLOBAL_ROLES.filter((role) => roles.includes(role)).map((role) => (
        <Badge asChild key={role} variant={role === 'root' || role === 'admin' ? 'default' : 'secondary'}>
          <li>{ROLE_LABELS[role]}</li>
        </Badge>
      ))}
    </ul>
  )
}

/** A staff member as a list names them: their name, and whether their account is active. */
export type StaffMember = { name: string; active: boolean }

/** Staff names separated by commas, each marked Deactivated when their account is deactivated. */
export function StaffNames({ staff }: { staff: readonly StaffMember[] }) {
  return staff.map(({ name, active }, index) => (
    <span key={index}>
      {name}
      {!active && (
        <Badge variant="outline" className="ml-1.5 align-middle">
          Deactivated
        </Badge>
      )}
      {index < staff.length - 1 && ', '}
    </span>
  ))
}
