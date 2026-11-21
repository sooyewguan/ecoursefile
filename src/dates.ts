// Dates as people read them: day, short month and year, such as 21 Nov 2026, with a 12-hour time
// when the time matters. Exports to CSV and Excel keep ISO dates instead.

const formatters = new Map<string, Intl.DateTimeFormat>()

/** The parts of a moment in the time zone, or the browser's when none is given. */
function partsOf(value: string | Date, timeZone: string | undefined) {
  const key = timeZone ?? ''
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone,
    })
    formatters.set(key, formatter)
  }
  const parts = formatter.formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return { date: `${part('day')} ${part('month')} ${part('year')}`, time: `${part('hour')}:${part('minute')} ${part('dayPeriod').toUpperCase()}` }
}

/** The date, such as 21 Nov 2026. */
export function formatDate(value: string | Date, timeZone?: string) {
  return partsOf(value, timeZone).date
}

/** The date and time, such as 21 Nov 2026, 3:52 PM. */
export function formatDateTime(value: string | Date, timeZone?: string) {
  const { date, time } = partsOf(value, timeZone)
  return `${date}, ${time}`
}
