import { ArrowLeftIcon, CircleAlertIcon, MoreHorizontalIcon, RotateCwIcon, type LucideIcon } from 'lucide-react'
import { createContext, use, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { TableCell, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

/** A page that a page sits under, below the navigation's page, such as a section's course file. */
export type ParentPage = { title: string; to: string }

/** The title of the page at a path, and any page it sits under, which the app shell's top bar names. */
export type PageTitle = { path: string; title: string; parent?: ParentPage }

/** How a page inside the app shell tells the shell its title. Pages outside the shell have none. */
export const PageTitleContext = createContext<((title: PageTitle) => void) | null>(null)

/** Names the browser tab after the page, as "<title> · eCourseFile", and the shell's top bar, with any parent, while the page shows. */
export function useDocumentTitle(title: string, parent?: ParentPage | null) {
  const setPageTitle = use(PageTitleContext)
  const { pathname } = useLocation()
  const parentTitle = parent?.title
  const parentTo = parent?.to
  useEffect(() => {
    document.title = `${title} · eCourseFile`
    setPageTitle?.({ path: pathname, title, parent: parentTitle && parentTo ? { title: parentTitle, to: parentTo } : undefined })
  }, [title, parentTitle, parentTo, pathname, setPageTitle])
}

/** A page's title, with an optional line under it and the page's actions at its end. parent names the page it sits under in the top bar. */
export function PageHeader({
  title,
  description,
  action,
  parent,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  parent?: ParentPage | null
}) {
  useDocumentTitle(title, parent)
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="grid min-w-0 gap-1">
        <h1 className="text-2xl/8 font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      {action}
    </div>
  )
}

/**
 * A page's buttons, at the end of its header. On a phone they take the header's full width and
 * share each row they wrap onto, so buttons of different lengths line up at both edges.
 */
export function PageActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2 max-sm:w-full max-sm:*:grow">{children}</div>
}

/** The card that holds a table edge to edge, with what belongs to the table, such as its pager. */
export function TableCard({ children }: { children: ReactNode }) {
  return <Card className="gap-0 overflow-hidden py-0">{children}</Card>
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

type EmptyStateProps = {
  icon: LucideIcon
  /** A noun phrase, such as "No courses yet". */
  title: string
  description?: ReactNode
  /** What the viewer can do about it, such as the page's Add button. */
  action?: ReactNode
}

/** What a list shows when it has nothing to show. */
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}

/** A table row that says the table has nothing to show. */
export function TableEmpty({ columns, ...state }: { columns: number } & EmptyStateProps) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={columns} className="whitespace-normal">
        <EmptyState {...state} />
      </TableCell>
    </TableRow>
  )
}

/** Data that failed to load, such as "Couldn't load departments", with a button that loads it again. */
export function LoadError({ title, onRetry }: { title: string; onRetry: () => unknown }) {
  const [retrying, setRetrying] = useState(false)
  return (
    <Empty role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive">
          <CircleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true)
            await onRetry()
            setRetrying(false)
          }}
        >
          {retrying ? <Spinner /> : <RotateCwIcon />}
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  )
}

/** A table row that says the table's data failed to load. */
export function TableLoadError({ columns, ...props }: { columns: number; title: string; onRetry: () => unknown }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={columns} className="whitespace-normal">
        <LoadError {...props} />
      </TableCell>
    </TableRow>
  )
}

/** The page of something that does not exist, or that the viewer may not open, with a link back. */
export function NotFound({ icon: Icon, title, backTo, backLabel }: { icon: LucideIcon; title: string; backTo: string; backLabel: string }) {
  useDocumentTitle(title)
  return (
    <Card className="py-0">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
          <EmptyTitle>
            <h1>{title}</h1>
          </EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link to={backTo}>
              <ArrowLeftIcon />
              {backLabel}
            </Link>
          </Button>
        </EmptyContent>
      </Empty>
    </Card>
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
