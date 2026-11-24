import { XIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { TableCard } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/** What a bulk action did with one entry: the entry, its outcome as a badge, and any reason or note under it. */
export type BulkResult = {
  key: string
  name: ReactNode
  outcome: { label: string; variant: 'success' | 'warning' | 'destructive' | 'outline' }
  note?: ReactNode
}

/**
 * The results of a bulk action, such as an import or a copy, as a card above the list it changed.
 * The caller orders the rows, the ones that need attention first. It stays until dismissed.
 */
export function BulkResults({
  title,
  summary,
  nameHeading,
  results,
  onDismiss,
}: {
  title: string
  summary: string
  nameHeading: string
  results: BulkResult[]
  onDismiss: () => void
}) {
  return (
    <TableCard>
      <CardHeader className="border-b px-4 py-4">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{summary}</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label={`Dismiss ${title.toLowerCase()}`} onClick={onDismiss}>
            <XIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <div className="max-h-[28rem] overflow-y-auto">
        <Table aria-label={title}>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">{nameHeading}</TableHead>
              <TableHead className="px-4">Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((result) => (
              <TableRow key={result.key}>
                <TableCell className="px-4 py-3 align-top whitespace-normal">{result.name}</TableCell>
                <TableCell className="px-4 py-3 whitespace-normal">
                  <div className="grid justify-items-start gap-1">
                    <Badge variant={result.outcome.variant}>{result.outcome.label}</Badge>
                    {result.note && <span className="text-sm">{result.note}</span>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </TableCard>
  )
}
