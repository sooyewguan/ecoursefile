import {
  BookOpenIcon,
  Building2Icon,
  CalendarRangeIcon,
  ChartColumnIcon,
  ClipboardCheckIcon,
  ChevronDownIcon,
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
import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { Brand } from '@/components/brand'
import { Initials, RoleBadges } from '@/components/identity'
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
import { useAuth } from '../auth-provider.tsx'
import type { GlobalRole } from '../roles.ts'
import { supabase } from '../supabase.ts'

type PageLink = { path: string; label: string; icon: LucideIcon }

/**
 * How each role-gated page in auth.ts appears in the navigation and on the home page. Settings
 * pages, the lists that the rest of the app picks from, share one menu in the navigation.
 */
const PAGE_DETAILS: Record<(typeof ROLE_PAGES)[number]['path'], { icon: LucideIcon; description: string; settings?: true }> = {
  '/course-files': { icon: FolderOpenIcon, description: 'Open course files and see which sections are missing.' },
  '/completeness': { icon: ClipboardCheckIcon, description: 'See what is missing from the course files you teach.' },
  '/reports': { icon: ChartColumnIcon, description: 'See how complete each semester is, by department, offering, section and lecturer.' },
  '/semesters': { icon: CalendarRangeIcon, description: 'Add semesters, offer courses and assign their lecturers.' },
  '/users': { icon: UsersIcon, description: 'Add accounts, assign roles and manage access.', settings: true },
  '/departments': { icon: Building2Icon, description: 'Staff departments and their codes.', settings: true },
  '/course-types': { icon: LayersIcon, description: 'Set which of sections 10 to 16 are on by default.', settings: true },
  '/courses': { icon: BookOpenIcon, description: 'Add courses with their department and course type.', settings: true },
  '/program-codes': { icon: TagsIcon, description: 'Codes used to tag student timetables.', settings: true },
}

/** The role-gated pages that these roles may open, as the route rules in auth.ts decide, with the settings pages last. */
export function openPages(roles: readonly GlobalRole[]) {
  const pages = ROLE_PAGES.filter((page) => canOpen(roles, page.path)).map((page) => ({ ...page, ...PAGE_DETAILS[page.path] }))
  return [...pages.filter((page) => !page.settings), ...pages.filter((page) => page.settings)]
}

const NAV_LINK = 'text-muted-foreground hover:text-foreground hover:bg-accent rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors'

/** The top bar and page frame around every page of a signed-in user. */
export function AppShell() {
  const state = useAuth()
  // The route guard sends every other state away from the pages inside the shell.
  if (state.kind !== 'ready') return null

  const pages = openPages(state.roles)
  // A menu needs two items or more, so a lone settings page sits with the other links.
  const settings: PageLink[] = pages.filter((page) => page.settings).length > 1 ? pages.filter((page) => page.settings) : []
  // With one page, the home page opens that page, so the navigation needs no Home.
  const main: PageLink[] = [
    ...(pages.length === 1 ? [] : [{ path: '/', label: 'Home', icon: HouseIcon }]),
    ...pages.filter((page) => !settings.includes(page)),
  ]

  return (
    <div className="bg-muted/40 flex min-h-svh flex-col">
      <header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
          <MobileNav main={main} settings={settings} />
          <Link to="/" className="mr-4 shrink-0 rounded-md">
            <Brand />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {main.map((link) => (
              <NavLink key={link.path} to={link.path} end={link.path === '/'} className={({ isActive }) => cn(NAV_LINK, isActive && 'bg-accent text-foreground')}>
                {link.label}
              </NavLink>
            ))}
            {settings.length > 0 && <SettingsMenu links={settings} />}
          </nav>
          <div className="ml-auto">
            <UserMenu profile={state.profile} roles={state.roles} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  )
}

/** The settings pages as one menu, shown as current while one of them is open. */
function SettingsMenu({ links }: { links: PageLink[] }) {
  const { pathname } = useLocation()
  const current = links.find((link) => pathname === link.path || pathname.startsWith(`${link.path}/`))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(NAV_LINK, 'flex items-center gap-1 outline-none', current && 'bg-accent text-foreground')}>
        Settings
        <ChevronDownIcon className="size-4 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {links.map((link) => (
          <DropdownMenuItem key={link.path} asChild className={cn(link === current && 'bg-accent/60 font-medium')}>
            <Link to={link.path} aria-current={link === current ? 'page' : undefined}>
              <link.icon />
              {link.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Below lg, the navigation in a sheet from the left. Following a link closes it. */
function MobileNav({ main, settings }: { main: PageLink[]; settings: PageLink[] }) {
  const [open, setOpen] = useState(false)
  const link = (page: PageLink) => (
    <NavLink
      key={page.path}
      to={page.path}
      end={page.path === '/'}
      onClick={() => setOpen(false)}
      className={({ isActive }) =>
        cn(
          'text-muted-foreground hover:text-foreground hover:bg-accent flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors pointer-coarse:py-3',
          isActive && 'bg-accent text-foreground',
        )
      }
    >
      <page.icon className="size-4" />
      {page.label}
    </NavLink>
  )
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" aria-label="Open navigation">
          <MenuIcon className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72">
        <SheetHeader className="border-b">
          <SheetTitle>
            <Brand />
          </SheetTitle>
          <SheetDescription className="sr-only">Pages you can open</SheetDescription>
        </SheetHeader>
        <nav aria-label="Main" className="grid gap-4 px-3">
          <div className="grid gap-1">{main.map(link)}</div>
          {settings.length > 0 && (
            <div role="group" aria-labelledby="mobile-settings" className="grid gap-1">
              <p id="mobile-settings" className="text-muted-foreground px-3 text-xs font-medium">
                Settings
              </p>
              {settings.map(link)}
            </div>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  )
}

function UserMenu({ profile, roles }: { profile: Profile; roles: GlobalRole[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-2 px-1.5 sm:pr-2" aria-label={`Account menu for ${profile.displayName}`}>
          <Initials name={profile.fullName} />
          <span className="hidden max-w-48 truncate sm:inline">{profile.displayName}</span>
          <ChevronDownIcon className="text-muted-foreground hidden sm:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
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
        <DropdownMenuItem onSelect={() => void supabase.auth.signOut()}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
