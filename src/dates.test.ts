import { expect, test } from 'vitest'
import { formatDate, formatDateTime } from './dates.ts'

test.each([
  ['2026-11-21T07:52:09.123Z', 'UTC', '21 Nov 2026', '21 Nov 2026, 7:52 AM'],
  ['2026-11-21T07:52:09.123Z', 'Asia/Kuala_Lumpur', '21 Nov 2026', '21 Nov 2026, 3:52 PM'],
  ['2026-11-21T16:05:00Z', 'Asia/Kuala_Lumpur', '22 Nov 2026', '22 Nov 2026, 12:05 AM'],
  ['2026-09-01T04:00:00Z', 'UTC', '1 Sep 2026', '1 Sep 2026, 4:00 AM'],
  ['2026-06-30T12:30:00+00:00', 'UTC', '30 Jun 2026', '30 Jun 2026, 12:30 PM'],
])('%s in %s is %s, or %s with the time', (value, timeZone, date, dateTime) => {
  expect(formatDate(value, timeZone)).toBe(date)
  expect(formatDateTime(value, timeZone)).toBe(dateTime)
})

test('a Date and its ISO string read the same', () => {
  const moment = new Date('2026-11-21T07:52:09Z')
  expect(formatDateTime(moment, 'UTC')).toBe(formatDateTime(moment.toISOString(), 'UTC'))
})
