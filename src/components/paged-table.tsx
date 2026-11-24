import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { TableEmpty, TableLoadError, TableSkeleton } from '@/components/page'
import { Pager } from '@/components/paged-list'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TableBody } from '@/components/ui/table'
import { cn, plural } from '@/lib/utils'

/** What a table needs from usePagedList. */
type PagedList<Row> = {
  rows: Row[] | null
  total: number | null
  loading: boolean
  failed: boolean
  query: string
  setQuery: (query: string) => void
  search: string
  page: number
  setPage: (page: number) => void
  retry: () => void
}

/**
 * The body of a table that shows one page of a paged list: the load error with Try again,
 * placeholder rows until there is a page to show, empty when the page has no rows, or the rows.
 * The last page stays, dimmed, while the next one loads.
 */
export function PagedTableBody<Row>({
  list,
  columns,
  loadError,
  empty,
  children,
}: {
  list: PagedList<Row>
  /** Each column's classes, for the placeholder rows. */
  columns: readonly string[]
  /** What failed, such as "Couldn't load departments". */
  loadError: string
  empty: ReactNode
  children: (row: Row) => ReactNode
}) {
  const { rows } = list
  return (
    <TableBody aria-busy={list.loading} className={cn('transition-opacity', list.loading && rows?.length && 'opacity-60')}>
      {list.failed ? (
        <TableLoadError columns={columns.length} title={loadError} onRetry={list.retry} />
      ) : !rows || (list.loading && rows.length === 0) ? (
        // An empty page that is about to be replaced would show the wrong empty state.
        <TableSkeleton columns={columns} />
      ) : rows.length === 0 ? (
        empty
      ) : (
        rows.map(children)
      )}
    </TableBody>
  )
}

/**
 * Whether the list has nothing in it at all, as against no matches for a search. Such a list
 * offers its Add button in its empty state, and its header leaves it out so the button shows once.
 */
export function isEmptyList(list: PagedList<unknown>) {
  return !list.loading && !list.failed && list.search === '' && list.total === 0
}

/** The search box above a paged table, such as "Search departments". */
export function ListSearch({ list, label, className }: { list: PagedList<unknown>; label: string; className: string }) {
  return (
    <Input
      type="search"
      aria-label={label}
      placeholder={label}
      className={className}
      value={list.query}
      onChange={(event) => list.setQuery(event.target.value)}
    />
  )
}

/**
 * The row above a paged table: its search box, such as "Search departments", and how many the list
 * holds, or how many match the search.
 */
export function ListToolbar({ list, label, noun }: { list: PagedList<unknown>; label: string; noun: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <ListSearch list={list} label={label} className="sm:w-72" />
      {list.total !== null && (
        <p className="text-muted-foreground text-sm tabular-nums">{list.search ? `${list.total.toLocaleString('en-US')} matching` : plural(list.total, noun)}</p>
      )}
    </div>
  )
}

/** A searched list with no rows: "No matching departments" with Clear search, or "No departments yet" with the Add button. */
export function ListEmpty({
  list,
  columns,
  icon,
  noun,
  addButton,
}: {
  list: PagedList<unknown>
  columns: number
  icon: LucideIcon
  /** What the list holds, in the plural, such as "departments". */
  noun: string
  addButton: ReactNode
}) {
  if (!list.search) return <TableEmpty columns={columns} icon={icon} title={`No ${noun} yet`} action={addButton} />
  return (
    <TableEmpty
      columns={columns}
      icon={icon}
      title={`No matching ${noun}`}
      action={
        <Button variant="outline" onClick={() => list.setQuery('')}>
          Clear search
        </Button>
      }
    />
  )
}

/** The pager under a paged table. A new page starts at the top of the page. */
export function TablePager({ list }: { list: PagedList<unknown> }) {
  if (list.total === null) return null
  return (
    <Pager
      page={list.page}
      total={list.total}
      onPageChange={(page) => {
        list.setPage(page)
        window.scrollTo({ top: 0 })
      }}
    />
  )
}
