import {
  BookOpenIcon,
  Building2Icon,
  CalendarRangeIcon,
  ChartColumnIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  ClipboardCheckIcon,
  FolderOpenIcon,
  HouseIcon,
  LayersIcon,
  LogOutIcon,
  MenuIcon,
  TagsIcon,
  UserRoundIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { Brand } from '@/components/brand'
import { Initials, RoleBadges } from '@/components/identity'
import { PageTitleContext, type PageTitle } from '@/components/page'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { canOpen, ROLE_PAGES, type Profile } from '../auth.ts'
import { signOut, useAuth } from '../auth-provider.tsx'
import { refreshPush } from '../push.ts'
import { GLOBAL_ROLES, ROLE_LABELS, type GlobalRole } from '../roles.ts'
import { supabase } from '../supabase.ts'

type PageLink = { path: string; label: string; icon: LucideIcon }

/** A titled group of links in the navigation. */
type NavGroup = { label: string; links: PageLink[] }

/**
 * How each role-gated page in auth.ts appears in the navigation. Settings pages, the lists that the
 * rest of the app picks from, share their own group.
 */
const PAGE_DETAILS: Record<(typeof ROLE_PAGES)[number]['path'], { icon: LucideIcon; settings?: true }> = {
  '/course-files': { icon: FolderOpenIcon },
  '/completeness': { icon: ClipboardCheckIcon },
  '/reports': { icon: ChartColumnIcon },
  '/semesters': { icon: CalendarRangeIcon },
  '/users': { icon: UsersIcon, settings: true },
  '/departments': { icon: Building2Icon, settings: true },
  '/course-types': { icon: LayersIcon, settings: true },
  '/courses': { icon: BookOpenIcon, settings: true },
  '/program-codes': { icon: TagsIcon, settings: true },
}

/** The role-gated pages that these roles may open, as the route rules in auth.ts decide, with the settings pages last. */
export function openPages(roles: readonly GlobalRole[]) {
  const pages = ROLE_PAGES.filter((page) => canOpen(roles, page.path)).map((page) => ({ ...page, ...PAGE_DETAILS[page.path] }))
  return [...pages.filter((page) => !page.settings), ...pages.filter((page) => page.settings)]
}

/** The navigation's groups for these roles. */
function navGroups(roles: readonly GlobalRole[]): NavGroup[] {
  const pages = openPages(roles)
  // A group needs two links or more, so a lone settings page sits with the other links.
  const settings: PageLink[] = pages.filter((page) => page.settings).length > 1 ? pages.filter((page) => page.settings) : []
  // With one page, the home page opens that page, so the navigation needs no Home.
  const workspace: PageLink[] = [
    ...(pages.length === 1 ? [] : [{ path: '/', label: 'Home', icon: HouseIcon }]),
    ...pages.filter((page) => !settings.includes(page)),
  ]
  return [{ label: 'Workspace', links: workspace }, ...(settings.length > 0 ? [{ label: 'Settings', links: settings }] : [])]
}

/**
 * The frame around every page of a signed-in user. From lg up, a navy sidebar holds the brand, the
 * navigation and the account menu, and a slim bar above the page names where the user is. Below lg,
 * the bar holds the brand and the account menu, and the navigation opens in a sheet from the left.
 */
export function AppShell() {
  const state = useAuth()
  const userId = state.kind === 'ready' ? state.profile.id : null
  const { pathname } = useLocation()
  const [pageTitle, setPageTitle] = useState<PageTitle | null>(null)

  // FCM may give this browser a new token from time to time, so register it again for each user who opens the app.
  useEffect(() => {
    if (userId) refreshPush(supabase).catch((error) => console.error('Could not refresh the push token', error))
  }, [userId])

  // The route guard sends every other state away from the pages inside the shell.
  if (state.kind !== 'ready') return null

  const groups = navGroups(state.roles)
  const current = pageTitle?.path === pathname ? pageTitle : null

  return (
    <PageTitleContext value={setPageTitle}>
      <div className="flex min-h-svh">
        <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border hidden w-60 shrink-0 border-r lg:block">
          <div className="sticky top-0 flex h-svh flex-col">
            <SidebarBrand />
            <SidebarNav groups={groups} />
            <div className="border-sidebar-border border-t p-3">
              <AccountMenu profile={state.profile} roles={state.roles} placement="sidebar" />
            </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="bg-background/85 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-30 border-b backdrop-blur">
            <div className="flex h-14 items-center gap-2 px-4 sm:px-6 lg:px-8">
              <MobileNav groups={groups} />
              <Link to="/" className="focus-visible:ring-ring/40 rounded-md outline-none focus-visible:ring-[3px] lg:hidden">
                <Brand />
              </Link>
              <Breadcrumb groups={groups} pathname={pathname} page={current} />
              <div className="ml-auto lg:hidden">
                <AccountMenu profile={state.profile} roles={state.roles} placement="bar" />
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>
    </PageTitleContext>
  )
}

function SidebarBrand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-14 shrink-0 items-center px-4">
      <Link to="/" onClick={onNavigate} className="focus-visible:ring-sidebar-ring/60 rounded-md outline-none focus-visible:ring-[3px]">
        <Brand />
      </Link>
    </div>
  )
}

/** The groups of links. The current page has a gold bar at its start and a brighter row. Following a link calls onNavigate. */
function SidebarNav({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="grid flex-1 content-start gap-6 overflow-y-auto px-3 py-4">
      {groups.map((group) => (
        <div key={group.label} role="group" aria-labelledby={`nav-${group.label}`} className="grid gap-0.5">
          <p id={`nav-${group.label}`} className="text-sidebar-muted px-3 pb-1.5 text-[0.6875rem] font-semibold tracking-wider uppercase">
            {group.label}
          </p>
          {group.links.map((link) => (
            <NavLink
              key={link.path}
              to={link.path}
              end={link.path === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-sidebar-ring/60 relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] pointer-coarse:py-3',
                  isActive &&
                    'bg-sidebar-accent text-sidebar-accent-foreground before:bg-highlight before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r-full',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <link.icon className={cn('size-4 shrink-0', isActive && 'text-highlight')} />
                  {link.label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )
}

/**
 * Where the user is, from lg up: the navigation's page that holds the current path, then the
 * page's own title when the path is below that page, such as a course file under Course files,
 * with the page it sits under between them, such as a section's course file.
 */
function Breadcrumb({ groups, pathname, page }: { groups: NavGroup[]; pathname: string; page: PageTitle | null }) {
  const area = groups
    .flatMap((group) => group.links)
    .find((link) => link.path !== '/' && (pathname === link.path || pathname.startsWith(`${link.path}/`)))
  const below = page && pathname !== area?.path
  const crumbs = [
    ...(area ? [{ label: area.label, to: (below && page.areaTo) || area.path, icon: area.icon }] : []),
    ...(below && page.parent ? [{ label: page.parent.title, to: page.parent.to, icon: null }] : []),
    ...(below ? [{ label: page.title, to: null, icon: null }] : []),
  ]
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 lg:block">
      <ol className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-sm">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1
          return (
            <li key={crumb.label} className={cn('flex min-w-0 items-center gap-1.5', last && 'text-foreground font-medium')}>
              {index > 0 && <ChevronRightIcon aria-hidden="true" className="text-muted-foreground/70 size-4 shrink-0" />}
              {crumb.icon && <crumb.icon aria-hidden="true" className="size-4 shrink-0" />}
              {crumb.to && !last ? (
                <Link to={crumb.to} className="hover:text-foreground truncate transition-colors">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className="truncate">
                  {crumb.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** Below lg, the navigation in a sheet from the left, in the sidebar's colors. Following a link closes it. */
function MobileNav({ groups }: { groups: NavGroup[] }) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" aria-label="Open navigation">
          <MenuIcon className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="bg-sidebar text-sidebar-foreground border-sidebar-border *:data-[slot=sheet-close]:text-sidebar-muted *:data-[slot=sheet-close]:hover:bg-sidebar-accent *:data-[slot=sheet-close]:hover:text-sidebar-foreground w-72 gap-0"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>Pages you can open</SheetDescription>
        </SheetHeader>
        <SidebarBrand onNavigate={close} />
        <SidebarNav groups={groups} onNavigate={close} />
      </SheetContent>
    </Sheet>
  )
}

/** The user's roles in the fixed role order, such as HoD · Lecturer. */
function roleLine(roles: readonly GlobalRole[]) {
  return GLOBAL_ROLES.filter((role) => roles.includes(role))
    .map((role) => ROLE_LABELS[role])
    .join(' · ')
}

/**
 * The account menu: My profile and Sign out. In the sidebar its button shows the user's name and
 * roles and the menu opens upwards. In the phone's bar the button is the user's initials.
 */
function AccountMenu({ profile, roles, placement }: { profile: Profile; roles: GlobalRole[]; placement: 'sidebar' | 'bar' }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {placement === 'sidebar' ? (
          <button
            type="button"
            aria-label={`Account menu for ${profile.displayName}`}
            className="hover:bg-sidebar-accent/60 data-[state=open]:bg-sidebar-accent focus-visible:ring-sidebar-ring/60 flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors outline-none focus-visible:ring-[3px]"
          >
            <Initials name={profile.fullName} className="bg-sidebar-accent text-sidebar-foreground ring-sidebar-border ring-1" />
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate text-sm font-medium">{profile.displayName}</span>
              <span className="text-sidebar-muted truncate text-xs">{roleLine(roles)}</span>
            </span>
            <ChevronsUpDownIcon aria-hidden="true" className="text-sidebar-muted size-4 shrink-0" />
          </button>
        ) : (
          <Button variant="ghost" size="icon" className="rounded-full" aria-label={`Account menu for ${profile.displayName}`}>
            <Initials name={profile.fullName} className="bg-secondary text-secondary-foreground" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={placement === 'sidebar' ? 'top' : 'bottom'}
        align={placement === 'sidebar' ? 'start' : 'end'}
        className={placement === 'sidebar' ? 'w-(--radix-dropdown-menu-trigger-width)' : 'w-64'}
      >
        <DropdownMenuLabel className="grid gap-2 font-normal">
          <div className="grid gap-0.5">
            <span className="truncate font-medium">{profile.displayName}</span>
            <span className="text-muted-foreground truncate text-xs">{profile.email}</span>
          </div>
          <RoleBadges roles={roles} />
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile">
            <UserRoundIcon />
            My profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
