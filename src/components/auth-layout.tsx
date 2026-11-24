import type { ReactNode } from 'react'
import { Brand } from '@/components/brand'
import { useDocumentTitle } from '@/components/page'
import { cn } from '@/lib/utils'

/**
 * The frame of the signed-out and must-change-password pages. From lg up, the brand panel on the
 * left and the form on the right. Below lg, the brand above the form's card.
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
      <main className="flex flex-col items-center justify-center px-4 py-10 sm:px-10">
        <div className="grid w-full max-w-sm gap-6">
          <Brand className="justify-self-center lg:hidden" />
          <div className="max-lg:bg-card grid gap-6 max-lg:rounded-xl max-lg:border max-lg:p-6 max-lg:shadow-xs">
            <div className="grid gap-1.5 max-lg:text-center">
              <h1 className="text-2xl/8 font-semibold tracking-tight">{title}</h1>
              {description && <p className="text-muted-foreground text-sm/relaxed">{description}</p>}
            </div>
            {children}
          </div>
          {footer && <div className="text-muted-foreground text-sm max-lg:text-center">{footer}</div>}
        </div>
      </main>
    </div>
  )
}

/** The navy panel with the brand, what the app is for, and a heatmap motif of section squares. */
function BrandPanel() {
  return (
    <aside className="bg-sidebar text-sidebar-foreground relative hidden flex-col justify-between overflow-hidden p-10 lg:flex xl:p-14">
      <Brand />
      <div className="relative z-10 grid max-w-md gap-4">
        <p className="text-highlight text-xs font-semibold tracking-wider uppercase">Course files and ISO audit</p>
        <p className="text-3xl/tight font-semibold tracking-tight text-balance xl:text-4xl/tight">Every course file, ready for audit.</p>
        <p className="text-sidebar-muted text-base/relaxed">
          Lecturers upload each section, auditors verify it, and the faculty sees how complete each semester is.
        </p>
      </div>
      <HeatmapMotif />
    </aside>
  )
}

/** Shades of the motif's squares: mostly quiet, a few bright, and a few gold. */
const MOTIF_SHADES = ['bg-white/[0.05]', 'bg-white/[0.08]', 'bg-white/[0.12]', 'bg-white/[0.18]', 'bg-highlight/80', 'bg-white/[0.08]', 'bg-white/[0.28]']

/** Seven rows of the 19 sections, shaded by a fixed pattern. Decoration only. */
function HeatmapMotif() {
  return (
    <div aria-hidden="true" className="grid w-fit grid-cols-[repeat(19,auto)] gap-1.5 [mask-image:linear-gradient(to_top,black_30%,transparent)]">
      {Array.from({ length: 7 * 19 }, (_, cell) => {
        const row = Math.floor(cell / 19)
        const column = cell % 19
        return <span key={cell} className={cn('size-4 rounded-[3px] xl:size-5', MOTIF_SHADES[(row * 5 + column * 3 + ((row * column) % 4)) % MOTIF_SHADES.length])} />
      })}
    </div>
  )
}
