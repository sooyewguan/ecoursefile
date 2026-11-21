import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useEffect, useEffectEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { PAGE_SIZE, pageCount, pageRange, pageSummary } from '../paging.ts'

/** A page of rows, as a PostgREST query with { count: 'exact' } and range() answers it. */
type PageResult<Row> = { data: Row[] | null; count: number | null; error: unknown }

/**
 * One page of a long list that the server searches and counts. fetchPage asks for the rows in the
 * range that match the search text; build its filter with containsFilter. Changing the search text,
 * or filters, a string that names the list's other filters, goes back to page 1. The search waits
 * for typing to pause. rows and total keep the last page shown while the next one loads, and are
 * null only until the first one has. retry loads the page again, such as after a write.
 */
export function usePagedList<Row>(fetchPage: (range: { from: number; to: number }, search: string) => PromiseLike<PageResult<Row>>, filters = '') {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [paging, setPaging] = useState({ scope: '', page: 1 })
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ key: string; rows?: Row[]; total?: number; failed?: true } | null>(null)
  const fetchLatest = useEffectEvent(fetchPage)

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])

  const scope = `${filters}\n${search}`
  const page = paging.scope === scope ? paging.page : 1
  const key = `${scope}\n${page}\n${attempt}`

  useEffect(() => {
    let current = true
    Promise.resolve(fetchLatest(pageRange(page), search)).then(
      ({ data, count, error }) => {
        if (!current) return
        if (error || !data) return setResult((last) => ({ ...last, key, failed: true }))
        const total = count ?? data.length
        // A write can empty the last page, so the list moves back to the page that is now last.
        if (data.length === 0 && page > pageCount(total)) setPaging({ scope, page: pageCount(total) })
        setResult({ key, rows: data, total })
      },
      () => current && setResult((last) => ({ ...last, key, failed: true })),
    )
    return () => {
      current = false
    }
  }, [key, page, scope, search])

  return {
    rows: result?.rows ?? null,
    total: result?.total ?? null,
    /** Whether the page shown is not yet the one asked for. */
    loading: result?.key !== key,
    failed: result?.key === key && result.failed === true,
    page,
    setPage: (page: number) => setPaging({ scope, page }),
    query,
    setQuery,
    retry: () => setAttempt((count) => count + 1),
  }
}

/** The foot of a paged list: which rows show, of how many, and the previous and next page. It shows only when there is more than one page. */
export function Pager({ page, total, onPageChange }: { page: number; total: number; onPageChange: (page: number) => void }) {
  if (total <= PAGE_SIZE) return null
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm">
      <p className="text-muted-foreground tabular-nums">{pageSummary(page, total)}</p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeftIcon />
          <span className="max-sm:sr-only">Previous</span>
        </Button>
        <Button variant="outline" size="sm" aria-label="Next page" disabled={page >= pageCount(total)} onClick={() => onPageChange(page + 1)}>
          <span className="max-sm:sr-only">Next</span>
          <ChevronRightIcon />
        </Button>
      </div>
    </nav>
  )
}
