import { ArrowRightIcon } from 'lucide-react'
import { Link, Navigate } from 'react-router'
import { openPages } from '@/components/app-shell'
import { useDocumentTitle } from '@/components/page'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '../auth-provider.tsx'

/** A greeting and a card for each page the user may open. A user with one page goes straight to it. */
export function Home() {
  const state = useAuth()
  useDocumentTitle('Home')
  if (state.kind !== 'ready') return null
  const pages = openPages(state.roles)
  if (pages.length === 1) return <Navigate to={pages[0].path} replace />

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {state.profile.displayName}</h1>
      {pages.length > 0 && (
        <ul aria-label="Pages" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
      )}
    </div>
  )
}
