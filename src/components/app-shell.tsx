import {
  BookOpenIcon,
  Building2Icon,
  CalendarRangeIcon,
  ChevronDownIcon,
  CloudUploadIcon,
  FolderOpenIcon,
  HouseIcon,
  LayersIcon,
  LogOutIcon,
  MenuIcon,
  TagsIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router'
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
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { canOpen, ROLE_PAGES, type Profile } from '../auth.ts'
import { useAuth } from '../auth-provider.tsx'
import type { GlobalRole } from '../roles.ts'
import { supabase } from '../supabase.ts'

type PageLink = { path: string; label: string; icon: LucideIcon }

/** How each role-gated page in auth.ts appears in the navigation and on the home page. */
const PAGE_DETAILS: Record<(typeof ROLE_PAGES)[number]['path'], { icon: LucideIcon; description: string }> = {
  '/course-files': { icon: FolderOpenIcon, description: 'Open course files and see which sections are missing.' },
  '/users': { icon: UsersIcon, description: 'Add accounts, assign roles and manage access.' },
  '/departments': { icon: Building2Icon, description: 'Add, rename and remove departments.' },
  '/course-types': { icon: LayersIcon, description: 'Set which of sections 10 to 16 are on by default.' },
  '/courses': { icon: BookOpenIcon, description: 'Add courses with their department and course type.' },
  '/program-codes': { icon: TagsIcon, description: 'Keep the master list of program codes.' },
  '/semesters': { icon: CalendarRangeIcon, description: 'Add semesters, offer courses and assign their lecturers.' },
  '/onedrive-check': { icon: CloudUploadIcon, description: 'Check that a OneDrive can store course files.' },
}

/** The role-gated pages that these roles may open, as the route rules in auth.ts decide. */
export function openPages(roles: readonly GlobalRole[]) {
  return ROLE_PAGES.filter((page) => canOpen(roles, page.path)).map((page) => ({ ...page, ...PAGE_DETAILS[page.path] }))
}

/** The top bar and page frame around every page of a signed-in user. */
export function AppShell() {
  const state = useAuth()
  // The route guard sends every other state away from the pages inside the shell.
  if (state.kind !== 'ready') return null

  const links: PageLink[] = [{ path: '/', label: 'Home', icon: HouseIcon }, ...openPages(state.roles)]

  return (
    <div className="bg-muted/40 flex min-h-svh flex-col">
      <header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
          <MobileNav links={links} />
          <Link to="/" className="mr-4 rounded-md">
            <Brand />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 xl:flex">
            {links.map((link) => (
              <NavLink
                key={link.path}
                to={link.path}
                end={link.path === '/'}
                className={({ isActive }) =>
                  cn(
                    'text-muted-foreground hover:text-foreground hover:bg-accent rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                    isActive && 'bg-accent text-foreground',
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
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

function MobileNav({ links }: { links: PageLink[] }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="-ml-2 xl:hidden" aria-label="Open navigation">
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
        <nav aria-label="Main" className="grid gap-1 px-3">
          {links.map((link) => (
            <SheetClose asChild key={link.path}>
              <NavLink
                to={link.path}
                end={link.path === '/'}
                className={({ isActive }) =>
                  cn(
                    'text-muted-foreground hover:text-foreground hover:bg-accent flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive && 'bg-accent text-foreground',
                  )
                }
              >
                <link.icon className="size-4" />
                {link.label}
              </NavLink>
            </SheetClose>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  )
}

function UserMenu({ profile, roles }: { profile: Profile; roles: GlobalRole[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-2 px-1.5 sm:pr-2" aria-label={`Account menu for ${profile.fullName}`}>
          <Initials name={profile.fullName} />
          <span className="hidden max-w-48 truncate sm:inline">{profile.fullName}</span>
          <ChevronDownIcon className="text-muted-foreground hidden sm:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="grid gap-2 font-normal">
          <div className="grid gap-0.5">
            <span className="truncate font-medium">{profile.fullName}</span>
            <span className="text-muted-foreground truncate text-xs">{profile.email}</span>
          </div>
          <RoleBadges roles={roles} />
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void supabase.auth.signOut()}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
