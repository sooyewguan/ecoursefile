// CSV files the app builds in the browser, by RFC 4180: comma-separated, a field in double quotes
// when it holds a comma, quote or line break, a quote inside doubled, and CRLF after each row. A
// UTF-8 byte order mark comes first, so that Excel reads names outside ASCII correctly.

/**
 * A spreadsheet runs a cell that starts with one of these as a formula when it opens a .csv file.
 * Names, titles and emails are typed by users, so such a text starts with ' in the file, which
 * makes the spreadsheet show it as text.
 */
const FORMULA_START = /^[=+\-@\t\r]/

/** CSV text of rows whose fields are already CSV fields. */
export function csvFile(lines: string[][]) {
  return `﻿${lines.map((fields) => fields.join(',')).join('\r\n')}\r\n`
}

/** Text as one CSV field, kept from running as a formula. */
export function csvTextField(text: string) {
  return csvQuoted(FORMULA_START.test(text) ? `'${text}` : text)
}

/** A value as one CSV field, in quotes when it needs them. A number or a date is written as it is. */
export function csvQuoted(text: string) {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

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

