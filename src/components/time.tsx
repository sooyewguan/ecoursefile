import { formatDate, formatDateTime } from '../dates.ts'

/** A moment as people read it, such as 21 Nov 2026, 3:52 PM. With dateOnly it shows the date, and the time on hover. */
export function Time({ value, dateOnly = false }: { value: string; dateOnly?: boolean }) {
  return (
    <time dateTime={value} title={dateOnly ? formatDateTime(value) : undefined}>
      {dateOnly ? formatDate(value) : formatDateTime(value)}
    </time>
  )
}
