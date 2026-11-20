import type { ReportColumn, ReportTable } from './report-tables.ts'

// Exports a report view, as the page shows it, to an .xlsx or .csv file built in the browser.

export type ExportFormat = 'xlsx' | 'csv'

/** The file of a report view: its columns, and the rows given, which are the rows on screen. */
export async function exportReport<Row>(table: ReportTable<Row>, rows: Row[], semesterCode: string, format: ExportFormat): Promise<File> {
  const name = exportFileName(table.view, semesterCode, format)
  if (format === 'csv') return new File([reportCsv(table, rows)], name, { type: 'text/csv;charset=utf-8' })
  return new File([await reportXlsx(table, rows)], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/**
 * The view and the semester, such as `Offerings 2026-2027-1.xlsx`. Characters that Windows, macOS
 * or Linux do not allow in a file name, such as the / of the semester code, become -.
 */
export function exportFileName(view: string, semesterCode: string, format: ExportFormat) {
  return `${`${view} ${semesterCode}`.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-')}.${format}`
}

/** A cell of the file: text, a number, a day, or empty. */
type Cell = { text: string } | { number: number } | { day: string } | null

function cellOf<Row>(column: ReportColumn<Row>, row: Row): Cell {
  switch (column.kind) {
    case 'text': {
      const text = column.value(row)
      return text === null ? null : { text }
    }
    case 'number':
    case 'percent': {
      const number = column.value(row)
      return number === null ? null : { number }
    }
    case 'date': {
      const timestamp = column.value(row)
      return timestamp === null ? null : { day: localDay(timestamp) }
    }
  }
}

/** The day a timestamp falls on where the user is, such as 2026-11-20. */
function localDay(timestamp: string) {
  const date = new Date(timestamp)
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2, '0')).join('-')
}

/** The cell as text: a number in digits, and a day as 2026-11-20. */
function cellText(cell: Cell) {
  if (cell === null) return ''
  if ('text' in cell) return cell.text
  return 'number' in cell ? String(cell.number) : cell.day
}

/** The header that the file gives a column: a percentage's says so, such as `Complete (%)`. */
function exportHeader<Row>(column: ReportColumn<Row>) {
  return column.kind === 'percent' ? `${column.header} (%)` : column.header
}

/**
 * A spreadsheet runs a cell that starts with one of these as a formula when it opens a .csv file.
 * Names and titles are typed by users, so such a text starts with ' in the file, which makes the
 * spreadsheet show it as text.
 */
const FORMULA_START = /^[=+\-@\t\r]/

/**
 * The view as CSV by RFC 4180: comma-separated, a field in double quotes when it holds a comma,
 * quote or line break, a quote inside doubled, and CRLF after each row. A UTF-8 byte order mark
 * comes first, so that Excel reads names outside ASCII correctly.
 */
export function reportCsv<Row>(table: ReportTable<Row>, rows: Row[]) {
  const columns = Object.values(table.columns)
  const lines = [
    columns.map((column) => csvField({ text: exportHeader(column) })),
    ...rows.map((row) => columns.map((column) => csvField(cellOf(column, row)))),
  ]
  return `﻿${lines.map((fields) => fields.join(',')).join('\r\n')}\r\n`
}

function csvField(cell: Cell) {
  const text = cell !== null && 'text' in cell && FORMULA_START.test(cell.text) ? `'${cell.text}` : cellText(cell)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * The view as an .xlsx workbook of one sheet, named after the view, with the header row bold and
 * frozen. Text cells are strings in the Text format, so Excel never reads one as a formula, not
 * even when a user edits it. Counts and percentages are numbers, and days are dates. The
 * write-excel-file library loads only now, as its own chunk.
 */
export async function reportXlsx<Row>(table: ReportTable<Row>, rows: Row[]): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/universal')
  const columns = Object.values(table.columns)
  const headers = columns.map((column) => exportHeader(column))
  const cells = rows.map((row) => columns.map((column) => cellOf(column, row)))
  const widths = headers.map((header, index) => ({
    width: Math.min(MAX_WIDTH, Math.max(header.length, ...cells.map((row) => cellText(row[index]).length)) + 2),
  }))
  const sheet = [
    headers.map((header) => ({ value: header, type: String, format: TEXT_FORMAT, fontWeight: 'bold' as const })),
    ...cells.map((row) => row.map(xlsxCell)),
  ]
  return writeXlsxFile(sheet, { sheet: table.view, stickyRowsCount: 1, columns: widths }).toBlob()
}

/** Excel's Text number format: it keeps what a cell holds, and what a user types into it, as text. */
const TEXT_FORMAT = '@'

/** The widest a column starts, in characters, so that a long title does not stretch the sheet. */
const MAX_WIDTH = 50

function xlsxCell(cell: Cell) {
  if (cell === null) return null
  if ('text' in cell) return { value: cell.text, type: String, format: TEXT_FORMAT }
  if ('number' in cell) return { value: cell.number, type: Number }
  const [year, month, day] = cell.day.split('-').map(Number)
  return { value: new Date(Date.UTC(year, month - 1, day)), type: Date, format: 'yyyy-mm-dd' }
}
