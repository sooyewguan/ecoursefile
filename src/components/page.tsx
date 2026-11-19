import { MoreHorizontalIcon, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { TableCell, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {action}
    </div>
  )
}

/** Placeholder rows while a table's data loads, one cell per column with that column's classes. */
export function TableSkeleton({ columns, rows = 3 }: { columns: readonly string[]; rows?: number }) {
  return Array.from({ length: rows }, (_, row) => (
    <TableRow key={row} aria-hidden="true">
      {columns.map((className, column) => (
        <TableCell key={column} className={cn('px-4 py-3', className)}>
          <Skeleton className="h-5 w-full max-w-40" />
        </TableCell>
      ))}
    </TableRow>
  ))
}

/** A table row that says the table has nothing to show yet. */
export function TableEmpty({
  columns,
  icon: Icon,
  title,
  description,
}: {
  columns: number
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={columns} className="whitespace-normal">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon />
            </EmptyMedia>
            <EmptyTitle>{title}</EmptyTitle>
            <EmptyDescription>{description}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </TableCell>
    </TableRow>
  )
}

/** The menu of actions at the end of a table row. */
export function RowActions({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} className="data-[state=open]:bg-accent">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
