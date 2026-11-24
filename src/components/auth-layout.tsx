import type { ReactNode } from 'react'
import { Brand } from '@/components/brand'
import { useDocumentTitle } from '@/components/page'
import { ModeToggle } from '@/components/mode-toggle'

/**
 * The frame of the signed-out and must-change-password pages. From lg up, the brand panel on the
 * left and the form on the right, at a larger size, with the copyright at the foot. Below lg, the
 * brand above the form's card.
 */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
}) {
  useDocumentTitle(title)
  return (
    <div className="bg-background lg:bg-card grid min-h-svh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <BrandPanel />
      <main className="relative flex flex-col px-4 py-10 sm:px-10 lg:py-8">
        <ModeToggle className="absolute top-3 right-3 sm:top-4 sm:right-4" />
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="grid w-full max-w-sm gap-6 lg:max-w-[25rem] lg:gap-8">
            <Brand className="justify-self-center lg:hidden" />
            <div className="max-lg:bg-card grid gap-6 max-lg:rounded-xl max-lg:border max-lg:p-6 max-lg:shadow-xs lg:gap-8">
              <div className="grid gap-1.5 max-lg:text-center lg:gap-2">
                <h1 className="text-2xl/8 font-semibold tracking-tight lg:text-3xl/9">{title}</h1>
                {description && <p className="text-muted-foreground text-sm/relaxed lg:text-base/relaxed">{description}</p>}
              </div>
              <div className="contents lg:[&_[data-slot=button]]:h-10 lg:[&_[data-slot=input]]:h-10">{children}</div>
            </div>
            {footer && <div className="text-muted-foreground text-sm max-lg:text-center lg:border-t lg:pt-6">{footer}</div>}
          </div>
        </div>
        <p className="text-muted-foreground mx-auto mt-10 w-full max-w-[25rem] text-xs max-lg:hidden">© {new Date().getFullYear()} eCourseFile</p>
      </main>
    </div>
  )
}

/** The panel with the brand and what the app is for. */
function BrandPanel() {
  return (
    <aside className="bg-muted hidden flex-col justify-between p-10 lg:flex xl:p-14">
      <Brand />
      <div className="grid max-w-md gap-4">
        <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">Course files and ISO audit</p>
        <p className="text-3xl/tight font-semibold tracking-tight text-balance xl:text-4xl/tight">Every course file, ready for audit.</p>
        <p className="text-muted-foreground text-base/relaxed">
          Lecturers upload each section, auditors verify it, and the faculty sees how complete each semester is.
        </p>
      </div>
    </aside>
  )
}
