// Long lists load a page at a time from the server, which also searches them, since PostgREST
// returns at most 1,000 rows to a request.

/** Rows on a page of a long list. */
export const PAGE_SIZE = 50

/** The first and last row of a page, counting pages from 1 and rows from 0, as PostgREST's range() takes them. */
export function pageRange(page: number, pageSize = PAGE_SIZE) {
  const from = (page - 1) * pageSize
  return { from, to: from + pageSize - 1 }
}

/** How many pages the rows fill. A list with no rows has one empty page. */
export function pageCount(total: number, pageSize = PAGE_SIZE) {
  return Math.max(1, Math.ceil(total / pageSize))
}

const count = new Intl.NumberFormat('en-US')

/** Which rows a page shows, of how many, such as "51–100 of 5,409". */
export function pageSummary(page: number, total: number, pageSize = PAGE_SIZE) {
  if (total === 0) return '0 of 0'
  const { from, to } = pageRange(page, pageSize)
  return `${count.format(from + 1)}–${count.format(Math.min(to + 1, total))} of ${count.format(total)}`
}

/**
 * A PostgREST or() filter for rows where any of the columns contains the query, ignoring case, or
 * null for a blank query. A % or _ in the query matches only itself, and a comma, quote or
 * parenthesis in it cannot end the filter early.
 */
export function containsFilter(columns: readonly string[], query: string) {
  const text = query.trim()
  if (!text) return null
  const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const quoted = `"${pattern.replace(/[\\"]/g, (c) => `\\${c}`)}"`
  return columns.map((column) => `${column}.ilike.${quoted}`).join(',')
}
