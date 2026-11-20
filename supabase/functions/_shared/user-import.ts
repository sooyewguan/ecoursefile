// The CSV user import, shared by the app and the accounts function. The app offers the template and
// shows the results. The function reads the file into rows here, before it creates anyone.
import { isGlobalRole, type GlobalRole } from './roles.ts'

/** A user the accounts function creates, from the Add user form or from a row of an import file. */
export type NewUser = {
  email: string
  fullName: string
  departmentId: string | null
  roles: GlobalRole[]
  temporaryPassword: string
}

/** The columns of an import file, in the template's order. */
const COLUMNS = ['full_name', 'email', 'department', 'roles', 'temporary_password'] as const

type Column = (typeof COLUMNS)[number]

/** What separates the roles in one cell, such as "lecturer;hod". */
export const ROLE_SEPARATOR = ';'

/**
 * The file the admin downloads to fill in: the header row, after a byte order mark so that a
 * spreadsheet opens it as UTF-8.
 */
export const USER_IMPORT_TEMPLATE = `\uFEFF${COLUMNS.join(',')}\r\n`

/** Why a row of the file holds no user to create. */
type RowProblem = 'missing_value' | 'duplicate_email' | 'unknown_role' | 'unknown_department'

/**
 * What the import did with one row of the file. row is its number as a spreadsheet shows it, the
 * header being row 1. code is a RowProblem for a row the function never tried to create, and the
 * code the function refuses a single new user with otherwise, such as forbidden or email_exists.
 */
export type ImportedRow = { row: number; email: string } & (
  | { status: 'created'; userId: string }
  | { status: 'rejected'; code: string; reason: string }
)

/** A row of the file read as a user to create, or the reason it is not one. */
export type ParsedRow = { row: number; email: string } & ({ user: NewUser } | { code: RowProblem; reason: string })

/** A row of the file below its header that has a value, with its cells by column and without the spaces around them. */
export type FileRow = { row: number; cells: Record<Column, string> }

/**
 * Reads an import file into its rows, or the reason the whole file cannot be read. The first row
 * that is not blank names the columns, in any order and case, with spaces or underscores, and
 * columns besides COLUMNS are ignored.
 */
export function readUserImport(csv: string): { problem: string } | { rows: FileRow[] } {
  const records = readCsv(csv)
  if ('unclosedQuoteRow' in records) return { problem: `The file has a quote on row ${records.unclosedQuoteRow} that is never closed.` }
  const filled = records.flatMap((fields, index) => (fields.some((field) => field.trim() !== '') ? [{ row: index + 1, fields }] : []))
  if (filled.length === 0) return { problem: 'The file is empty.' }

  const [header, ...body] = filled
  const names = header.fields.map(matchKey)
  for (const column of COLUMNS) {
    if (names.indexOf(column) !== names.lastIndexOf(column)) return { problem: `The file has more than one ${column} column.` }
  }
  const missing = COLUMNS.filter((column) => !names.includes(column))
  if (missing.length > 0) {
    return { problem: `The file has no ${missing.join(' or ')} column. Its first row must name the columns ${COLUMNS.join(', ')}.` }
  }
  if (body.length === 0) return { problem: 'The file has no users below its header row.' }
  return {
    rows: body.map(({ row, fields }) => ({
      row,
      cells: Object.fromEntries(COLUMNS.map((column) => [column, (fields[names.indexOf(column)] ?? '').trim()])) as Record<Column, string>,
    })),
  }
}

/**
 * Each row as the user to create, or the reason it holds none. departments maps the code of each
 * department that the rows name to its id, and a code it lacks names no department.
 */
export function toNewUsers(rows: FileRow[], departments: ReadonlyMap<string, string>): ParsedRow[] {
  return rows.map(({ row, cells }): ParsedRow => {
    const email = cells.email
    const reject = (code: RowProblem, reason: string) => ({ row, email, code, reason })
    const roles = cells.roles
      .split(ROLE_SEPARATOR)
      .map((role) => role.trim())
      .filter(Boolean)
    const blank = COLUMNS.find((column) => (column === 'roles' ? roles.length === 0 : column !== 'department' && cells[column] === ''))
    if (blank) return reject('missing_value', `The row has no ${blank.replaceAll('_', ' ')}.`)
    const twins = rows.filter((other) => other.row !== row && other.cells.email.toLowerCase() === email.toLowerCase())
    if (twins.length > 0) return reject('duplicate_email', `The email is also on row ${twins.map((other) => other.row).join(', ')}.`)
    const unknown = roles.filter((role) => !isGlobalRole(matchKey(role)))
    if (unknown.length > 0) return reject('unknown_role', `Unknown role: ${unknown.join(', ')}. Separate roles with "${ROLE_SEPARATOR}".`)
    const departmentId = cells.department === '' ? null : departments.get(cells.department)
    if (departmentId === undefined) return reject('unknown_department', `No department has the code "${cells.department}".`)
    return {
      row,
      email,
      user: {
        email,
        fullName: cells.full_name,
        departmentId,
        roles: [...new Set(roles.map(matchKey).filter(isGlobalRole))],
        temporaryPassword: cells.temporary_password,
      },
    }
  })
}

/** A header or a role as the import matches it: in lower case, with underscores for spaces and hyphens. */
function matchKey(text: string) {
  return text.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/**
 * The records of CSV text, as a spreadsheet reads them: fields separated by commas, and records by
 * CRLF, LF or CR. A field in double quotes may hold commas, line breaks and doubled quotes. A byte
 * order mark at the start is ignored.
 */
function readCsv(text: string): string[][] | { unclosedQuoteRow: number } {
  const records: string[][] = []
  let fields: string[] = []
  let field = ''
  let quoted = false
  for (let index = text.startsWith('\uFEFF') ? 1 : 0; index < text.length; index++) {
    const character = text[index]
    if (quoted) {
      if (character !== '"') field += character
      else if (text[index + 1] === '"') field += text[++index]
      else quoted = false
    } else if (character === '"' && field === '') {
      quoted = true
    } else if (character === ',') {
      fields.push(field)
      field = ''
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index++
      records.push([...fields, field])
      fields = []
      field = ''
    } else {
      field += character
    }
  }
  if (quoted) return { unclosedQuoteRow: records.length + 1 }
  if (fields.length > 0 || field !== '') records.push([...fields, field])
  return records
}
