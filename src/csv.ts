// CSV text as a spreadsheet writes it. It reads the same way as readCsv in
// supabase/functions/_shared/user-import.ts, which the accounts function keeps to itself.

/**
 * The records of CSV text, as a spreadsheet reads them: fields separated by commas, and records by
 * CRLF, LF or CR. A field in double quotes may hold commas, line breaks and doubled quotes. A byte
 * order mark at the start is ignored. A quote that is never closed gives the row it opens on.
 */
export function readCsv(text: string): string[][] | { unclosedQuoteRow: number } {
  const records: string[][] = []
  let fields: string[] = []
  let field = ''
  let quoted = false
  for (let index = text.startsWith('﻿') ? 1 : 0; index < text.length; index++) {
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

