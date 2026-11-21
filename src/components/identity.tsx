import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { initialsOf } from '../names.ts'
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

/** A circle with a name's initials. */
export function Initials({ name, className }: { name: string; className?: string }) {
  const letters = initialsOf(name)
  return (
    <span
      aria-hidden="true"
      className={cn(
        'bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium',
        className,
      )}
    >
      {letters}
    </span>
  )
}
