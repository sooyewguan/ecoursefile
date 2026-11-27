import { expect, test } from 'vitest'
import { navGroups } from './navigation.ts'
import type { GlobalRole } from './roles.ts'

const menu = (roles: GlobalRole[]) => navGroups(roles).map((group) => [group.label, group.links.map((link) => link.label)])

test('a lecturer gets Workspace and a Lecturer group', () => {
  expect(menu(['lecturer'])).toEqual([
    ['Workspace', ['Home', 'Course files']],
    ['Lecturer', ['My completeness']],
  ])
})

test('an auditor gets an Auditor group', () => {
  expect(menu(['auditor'])).toEqual([
    ['Workspace', ['Home', 'Course files']],
    ['Auditor', ['Reports']],
  ])
})

test('a lecturer who audits gets both groups, and each page shows once', () => {
  expect(menu(['lecturer', 'auditor'])).toEqual([
    ['Workspace', ['Home', 'Course files']],
    ['Lecturer', ['My completeness']],
    ['Auditor', ['Reports']],
  ])
})

test('the admin gets an Admin group with the semesters and the settings pages', () => {
  expect(menu(['admin'])).toEqual([
    ['Workspace', ['Home', 'Course files']],
    ['Admin', ['Reports', 'Semesters', 'Users', 'Departments', 'Course types', 'Courses', 'Program codes']],
  ])
})

test('an admin who audits finds Reports under Auditor only', () => {
  expect(menu(['admin', 'auditor'])).toEqual([
    ['Workspace', ['Home', 'Course files']],
    ['Auditor', ['Reports']],
    ['Admin', ['Semesters', 'Users', 'Departments', 'Course types', 'Courses', 'Program codes']],
  ])
})

test('HoDs, deans and deputy deans share a Management group', () => {
  for (const role of ['hod', 'dean', 'deputy_dean'] as const) {
    expect(menu([role])).toEqual([
      ['Workspace', ['Home', 'Course files']],
      ['Management', ['Reports']],
    ])
  }
})

test('root opens one page, so the navigation holds only that page', () => {
  expect(menu(['root'])).toEqual([['Workspace', ['Users']]])
})
