import { expect, test } from 'vitest'
import { containsFilter, pageCount, pageRange, pageSummary } from './paging.ts'

test('pages count from 1 and cover consecutive rows', () => {
  expect(pageRange(1)).toEqual({ from: 0, to: 49 })
  expect(pageRange(2)).toEqual({ from: 50, to: 99 })
  expect(pageRange(3, 20)).toEqual({ from: 40, to: 59 })
})

test.each([
  [0, 1],
  [1, 1],
  [50, 1],
  [51, 2],
  [5409, 109],
])('%i rows fill %i pages of 50', (total, pages) => {
  expect(pageCount(total)).toBe(pages)
})

test('the summary names the rows on the page and the total', () => {
  expect(pageSummary(1, 5409)).toBe('1–50 of 5,409')
  expect(pageSummary(109, 5409)).toBe('5,401–5,409 of 5,409')
  expect(pageSummary(1, 12)).toBe('1–12 of 12')
  expect(pageSummary(1, 0)).toBe('0 of 0')
})

test('a blank query filters nothing', () => {
  expect(containsFilter(['code', 'name'], '')).toBeNull()
  expect(containsFilter(['code', 'name'], '   ')).toBeNull()
})

test('a query matches any column that contains it, trimmed', () => {
  expect(containsFilter(['code', 'name'], '  ftmk ')).toBe('code.ilike."%ftmk%",name.ilike."%ftmk%"')
})

test('the characters LIKE and PostgREST treat as syntax match only themselves', () => {
  // LIKE escapes % and _ with a backslash. PostgREST then escapes the backslash and the quote inside the quoted value.
  expect(containsFilter(['name'], '50%_off')).toBe(String.raw`name.ilike."%50\\%\\_off%"`)
  expect(containsFilter(['name'], String.raw`a\b`)).toBe(String.raw`name.ilike."%a\\\\b%"`)
  expect(containsFilter(['name'], 'say "hi", (now)')).toBe(String.raw`name.ilike."%say \"hi\", (now)%"`)
})
