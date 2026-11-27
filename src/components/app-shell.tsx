import { ChevronsUpDownIcon, LogOutIcon, UserRoundIcon } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { Brand } from '@/components/brand'
import { RoleBadges } from '@/components/identity'
import { ModeToggle } from '@/components/mode-toggle'
import { PageTitleContext, type PageTitle } from '@/components/page'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { type Profile } from '../auth.ts'
import { signOut, useAuth } from '../auth-provider.tsx'
import { navGroups, type NavGroup, type PageLink } from '../navigation.ts'
import { initialsOf } from '../names.ts'
import { refreshPush } from '../push.ts'
import { GLOBAL_ROLES, ROLE_LABELS, type GlobalRole } from '../roles.ts'
import { supabase } from '../supabase.ts'

/**
 * The frame around every page of a signed-in user: shadcn/ui's Sidebar with the brand, the
 * navigation and the account menu, and a bar above the page with the sidebar trigger, the
 * breadcrumb and the theme toggle. Below md the sidebar opens as a sheet.
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
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader>
            <Link to="/" className="ring-sidebar-ring rounded-md p-2 outline-none focus-visible:ring-2">
              <Brand />
            </Link>
          </SidebarHeader>
          <SidebarContent>
            {groups.map((group) => (
              <SidebarGroup key={group.label}>
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                <SidebarMenu>
                  {group.links.map((link) => (
                    <NavItem key={link.path} link={link} />
                  ))}
                </SidebarMenu>
              </SidebarGroup>
            ))}
          </SidebarContent>
          <SidebarFooter>
            <AccountMenu profile={state.profile} roles={state.roles} />
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <header className="bg-background/85 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <PageBreadcrumb groups={groups} pathname={pathname} page={current} />
            <ModeToggle className="ml-auto" />
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </PageTitleContext>
  )
}

/** A link in the navigation. On a phone, following it closes the sidebar's sheet. */
function NavItem({ link }: { link: PageLink }) {
  const { isMobile, setOpenMobile } = useSidebar()
  const { pathname } = useLocation()
  const active = link.path === '/' ? pathname === '/' : pathname === link.path || pathname.startsWith(`${link.path}/`)
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active}>
        <NavLink to={link.path} end={link.path === '/'} onClick={() => isMobile && setOpenMobile(false)}>
          <link.icon />
          <span>{link.label}</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/**
 * Where the user is: the navigation's page that holds the current path, then the page's own title
 * when the path is below that page, such as a course file under Course files, with the page it
 * sits under between them, such as a section's course file. On a phone only the last crumb shows.
 */
function PageBreadcrumb({ groups, pathname, page }: { groups: NavGroup[]; pathname: string; page: PageTitle | null }) {
  const area = groups
    .flatMap((group) => group.links)
    .find((link) => link.path !== '/' && (pathname === link.path || pathname.startsWith(`${link.path}/`)))
  const below = page && pathname !== area?.path
  const crumbs = [
    ...(area ? [{ label: area.label, to: (below && page.areaTo) || area.path }] : []),
    ...(below && page.parent ? [{ label: page.parent.title, to: page.parent.to }] : []),
    ...(below ? [{ label: page.title, to: null }] : []),
  ]
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1
          return (
            <Fragment key={crumb.label}>
              {index > 0 && <BreadcrumbSeparator className="hidden md:block" />}
              <BreadcrumbItem className={last ? 'min-w-0' : 'hidden md:inline-flex'}>
                {crumb.to && !last ? (
                  <BreadcrumbLink asChild>
                    <Link to={crumb.to}>{crumb.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

/** The user's roles in the fixed role order, such as HoD · Lecturer. */
function roleLine(roles: readonly GlobalRole[]) {
  return GLOBAL_ROLES.filter((role) => roles.includes(role))
    .map((role) => ROLE_LABELS[role])
    .join(' · ')
}

/** The account menu in the sidebar's footer: the user's name and roles, My profile and Sign out. */
function AccountMenu({ profile, roles }: { profile: Profile; roles: GlobalRole[] }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" aria-label={`Account menu for ${profile.displayName}`} className="data-[state=open]:bg-sidebar-accent">
              <Avatar>
                <AvatarFallback>{initialsOf(profile.fullName)}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">{profile.displayName}</span>
                <span className="text-sidebar-foreground/70 truncate text-xs">{roleLine(roles)}</span>
              </div>
              <ChevronsUpDownIcon className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
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
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
