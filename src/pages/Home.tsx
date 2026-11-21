import { ArrowRightIcon } from 'lucide-react'
import { Link } from 'react-router'
import { openPages } from '@/components/app-shell'
import { Initials, RoleBadges } from '@/components/identity'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '../auth-provider.tsx'

export function Home() {
  const state = useAuth()
  if (state.kind !== 'ready') return null
  const pages = openPages(state.roles)

  return (
    <div className="grid gap-8">
      <Card>
        <CardHeader className="flex items-start gap-4 sm:items-center">
          <Initials name={state.profile.fullName} className="size-12 text-base sm:size-14 sm:text-lg" />
          <div className="grid min-w-0 gap-1.5">
            <CardTitle className="text-xl sm:text-2xl">
              <h1>Welcome, {state.profile.displayName}</h1>
            </CardTitle>
            <CardDescription>Signed in as {state.profile.email}</CardDescription>
            <RoleBadges roles={state.roles} className="mt-1" />
          </div>
        </CardHeader>
      </Card>

      {pages.length > 0 && (
        <section aria-labelledby="home-pages" className="grid gap-3">
          <h2 id="home-pages" className="text-lg font-semibold tracking-tight">
            What you can manage
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pages.map((page) => (
              <li key={page.path}>
                <Link
                  to={page.path}
                  className="group focus-visible:ring-ring/50 block h-full rounded-xl outline-none focus-visible:ring-[3px]"
                >
                  <Card className="group-hover:border-foreground/20 h-full transition-colors group-hover:shadow-md">
                    <CardHeader className="gap-3">
                      <span className="bg-muted flex size-10 items-center justify-center rounded-lg">
                        <page.icon className="size-5" />
                      </span>
                      <CardTitle className="flex items-center justify-between text-base">
                        {page.label}
                        <ArrowRightIcon className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5" />
                      </CardTitle>
                      <CardDescription>{page.description}</CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
