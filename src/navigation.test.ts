import { expect, test } from 'vitest'
import { navGroups } from './navigation.ts'
import type { GlobalRole } from './roles.ts'

const menu = (roles: GlobalRole[]) => navGroups(roles).map((group) => [group.label, group.links.map((link) => link.label)])
const paths = (roles: GlobalRole[]) => navGroups(roles).flatMap((group) => group.links.map((link) => link.path))

test('a lecturer gets their own course files under Lecturer', () => {
  expect(menu(['lecturer'])).toEqual([
    ['Workspace', ['Home']],
    ['Lecturer', ['My course files', 'My completeness']],
  ])
})

test('an auditor gets the course files to audit under Auditor', () => {
  expect(menu(['auditor'])).toEqual([
    ['Workspace', ['Home']],
    ['Auditor', ['Audit course files', 'Reports']],
  ])
})

test('a lecturer who audits gets a separate course file page for each role', () => {
  expect(menu(['lecturer', 'auditor'])).toEqual([
    ['Workspace', ['Home']],
    ['Lecturer', ['My course files', 'My completeness']],
    ['Auditor', ['Audit course files', 'Reports']],
  ])
  expect(paths(['lecturer', 'auditor'])).toEqual(['/', '/my-course-files', '/completeness', '/audit', '/reports'])
})

test('the admin gets the read-only course files with the semesters and the settings pages', () => {
  expect(menu(['admin'])).toEqual([
    ['Workspace', ['Home']],
    ['Admin', ['Course files', 'Reports', 'Semesters', 'Users', 'Departments', 'Course types', 'Courses', 'Program codes']],
  ])
})

test('an admin who audits audits under Auditor and reads under Admin', () => {
  expect(menu(['admin', 'auditor'])).toEqual([
    ['Workspace', ['Home']],
    ['Auditor', ['Audit course files', 'Reports']],
    ['Admin', ['Course files', 'Semesters', 'Users', 'Departments', 'Course types', 'Courses', 'Program codes']],
  ])
})

test('HoDs, deans and deputy deans share a Management group', () => {
  for (const role of ['hod', 'dean', 'deputy_dean'] as const) {
    expect(menu([role])).toEqual([
      ['Workspace', ['Home']],
      ['Management', ['Course files', 'Reports']],
    ])
  }
})

test('root opens one page, so the navigation holds only that page', () => {
  expect(menu(['root'])).toEqual([['Workspace', ['Users']]])
})
