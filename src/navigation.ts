import {
  BookOpenIcon,
  Building2Icon,
  CalendarRangeIcon,
  ChartColumnIcon,
  ClipboardCheckIcon,
  FolderOpenIcon,
  FolderSearchIcon,
  HouseIcon,
  LayersIcon,
  TagsIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'
import { canOpen, ROLE_PAGES } from './auth.ts'
import type { GlobalRole } from './roles.ts'

export type PageLink = { path: string; label: string; icon: LucideIcon }

/** A titled group of links in the navigation. */
export type NavGroup = { label: string; links: PageLink[] }

/** The icon of each role-gated page in auth.ts. */
const PAGE_ICONS: Record<(typeof ROLE_PAGES)[number]['path'], LucideIcon> = {
  '/my-course-files': FolderOpenIcon,
  '/completeness': ClipboardCheckIcon,
  '/audit': FolderSearchIcon,
  '/course-files': FolderOpenIcon,
  '/reports': ChartColumnIcon,
  '/semesters': CalendarRangeIcon,
  '/users': UsersIcon,
  '/departments': Building2Icon,
  '/course-types': LayersIcon,
  '/courses': BookOpenIcon,
  '/program-codes': TagsIcon,
}

/**
 * The navigation's role groups, in the order they show. Each page goes in the first group whose
 * roles both the user and the page hold, so a page shows once. Each role's course files are a page
 * of their own, so a lecturer who audits finds My course files under Lecturer and Audit course
 * files under Auditor.
 */
const ROLE_GROUPS: readonly { label: string; roles: readonly GlobalRole[] }[] = [
  { label: 'Lecturer', roles: ['lecturer'] },
  { label: 'Auditor', roles: ['auditor'] },
  { label: 'Management', roles: ['hod', 'dean', 'deputy_dean'] },
  { label: 'Admin', roles: ['admin'] },
]

/** The role-gated pages that these roles may open, as the route rules in auth.ts decide. */
export function openPages(roles: readonly GlobalRole[]) {
  return ROLE_PAGES.filter((page) => canOpen(roles, page.path)).map((page) => ({ ...page, icon: PAGE_ICONS[page.path] }))
}

/** The navigation's groups for these roles: Workspace with Home, then one group for each role the user holds that has pages of its own. */
export function navGroups(roles: readonly GlobalRole[]): NavGroup[] {
  const pages = openPages(roles)
  const groups = ROLE_GROUPS.filter((group) => group.roles.some((role) => roles.includes(role))).map((group) => ({
    ...group,
    links: [] as PageLink[],
  }))
  const workspace: PageLink[] = []
  for (const page of pages) {
    const pageRoles: readonly GlobalRole[] = page.roles
    const group = groups.find((g) => g.roles.some((role) => pageRoles.includes(role)))
    ;(group ? group.links : workspace).push(page)
  }
  // With one page, the home page opens that page, so the navigation needs no Home.
  if (pages.length > 1) workspace.unshift({ path: '/', label: 'Home', icon: HouseIcon })
  return [
    ...(workspace.length > 0 ? [{ label: 'Workspace', links: workspace }] : []),
    ...groups.filter((group) => group.links.length > 0).map(({ label, links }) => ({ label, links })),
  ]
}
