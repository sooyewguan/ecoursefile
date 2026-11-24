import { importReason, type ImportedRow } from '../supabase/functions/_shared/user-import.ts'
import { csvFile, csvTextField } from './csv.ts'

/** The rows as the import results list them: the rejected rows first, then the added ones, each in file order. */
export function inResultOrder(rows: ImportedRow[]) {
  return [...rows.filter((row) => row.status === 'rejected'), ...rows.filter((row) => row.status === 'created')]
}

/** The import results as a CSV file, in the order the page lists them, with a Row, Email, Result and Reason column. */
export function importResultsCsv(rows: ImportedRow[]) {
  return csvFile([
    ['Row', 'Email', 'Result', 'Reason'],
    ...inResultOrder(rows).map((row) =>
      [String(row.row), row.email, row.status === 'created' ? 'Added' : 'Rejected', row.status === 'created' ? '' : importReason(row)].map(csvTextField),
    ),
  ])
}
