import type { ReactNode } from 'react'
import { Brand } from '@/components/brand'
import { useDocumentTitle } from '@/components/page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/** The centered card that the signed-out and must-change-password pages use. */
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
    <main className="bg-muted flex min-h-svh flex-col items-center justify-center p-4 sm:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Brand className="self-center text-lg" />
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">
              <h1>{title}</h1>
            </CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          {children && <CardContent>{children}</CardContent>}
        </Card>
        {footer && <div className="text-muted-foreground text-center text-sm">{footer}</div>}
      </div>
    </main>
  )
}
