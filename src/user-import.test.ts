import { expect, test } from 'vitest'
import { importReason, readUserImport, toNewUsers, USER_IMPORT_TEMPLATE, type ImportedRow } from '../supabase/functions/_shared/user-import.ts'
import { importResultsCsv } from './import-results.ts'

const HEADER = 'full_name,email,department,roles,temporary_password'
const DEPARTMENTS = new Map([['ftmk', 'department-id']])

function parse(csv: string) {
  const file = readUserImport(csv)
  if ('problem' in file) throw new Error(file.problem)
  return toNewUsers(file.rows, DEPARTMENTS)
}

test("the template's example row is a valid user in every column but its email, which the import skips", () => {
  expect(parse(USER_IMPORT_TEMPLATE)).toEqual([
    { row: 2, email: 'aisyah.rahman@example.com', code: 'example_row', reason: "This is the template's example row. Delete it from the file." },
  ])
  expect(parse(USER_IMPORT_TEMPLATE.replace('aisyah.rahman@example.com', 'aisyah@utem.edu.my'))).toEqual([
    {
      row: 2,
      email: 'aisyah@utem.edu.my',
      user: {
        email: 'aisyah@utem.edu.my',
        fullName: 'Aisyah binti Rahman',
        title: 'Dr.',
        departmentId: 'department-id',
        roles: ['lecturer', 'hod'],
        temporaryPassword: 'Change-me-2026',
      },
    },
  ])
})

test('a row whose email is not an address is rejected in the app wording, before it reaches Auth', () => {
  const rows = parse(
    [HEADER, 'No At,not-an-email,,lecturer,pw-123456', 'Space,a b@utem.edu.my,,lecturer,pw-123456', 'Good,good@utem.edu.my,,lecturer,pw-123456'].join('\n'),
  )
  expect(rows.map((row) => ('code' in row ? [row.code, row.reason] : 'user'))).toEqual([
    ['invalid_email', 'The email is not a valid address.'],
    ['invalid_email', 'The email is not a valid address.'],
    'user',
  ])
})

test('an email already in use reads in the app wording, and every other reason as the import gave it', () => {
  const authWording = 'A user with this email address has already been registered'
  expect(importReason({ row: 2, email: 'a@utem.edu.my', status: 'rejected', code: 'email_exists', reason: authWording })).toBe(
    'An account with this email already exists.',
  )
  expect(importReason({ row: 3, email: 'b@utem.edu.my', status: 'rejected', code: 'forbidden', reason: 'An HoD needs a department.' })).toBe(
    'An HoD needs a department.',
  )
})

test('the results download as CSV in the order the page lists them, rejected rows first, with each reason', () => {
  const rows: ImportedRow[] = [
    { row: 2, email: 'added@utem.edu.my', status: 'created', userId: 'id-1' },
    { row: 3, email: 'taken@utem.edu.my', status: 'rejected', code: 'email_exists', reason: 'A user with this email address has already been registered' },
    { row: 4, email: '=cmd@utem.edu.my', status: 'rejected', code: 'unknown_role', reason: 'Unknown role: boss, chief. Separate roles with ";".' },
  ]
  expect(importResultsCsv(rows)).toBe(
    '﻿Row,Email,Result,Reason\r\n' +
      '3,taken@utem.edu.my,Rejected,An account with this email already exists.\r\n' +
      `4,'=cmd@utem.edu.my,Rejected,"Unknown role: boss, chief. Separate roles with "";""."\r\n` +
      '2,added@utem.edu.my,Added,\r\n',
  )
})
