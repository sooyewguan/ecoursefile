import { HistoryIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { LoadError } from '@/components/page'
import { Time } from '@/components/time'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { ACTIVITY_ACTIONS, activityNote, activityPage, describeActivity, type ActivityEntry } from '../activity.ts'
import { friendlyError } from '../errors.ts'
import { supabase } from '../supabase.ts'

/**
 * The activity of a course file, newest first: what happened, who did it and when, a page at a time
 * with Load more. It covers the course file's own changes, its verdicts and audit requests, and the
 * shared files it links.
 */
export function ActivityLog({ offeringId }: { offeringId: string }) {
  /** Null while the first page loads. */
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  /** Whether the first page failed to load. */
  const [loadFailed, setLoadFailed] = useState(false)

  /** Loads the newest page, or the page after the entry given, and adds it below the entries shown. */
  const load = useCallback(
    async (after?: ActivityEntry) => {
      try {
        const page = await activityPage(supabase, offeringId, after)
        setEntries((shown) => (after ? [...(shown ?? []), ...page.entries] : page.entries))
        setHasMore(page.hasMore)
        setLoadFailed(false)
      } catch (failure) {
        if (after) toast.error(friendlyError(failure))
        else setLoadFailed(true)
      }
    },
    [offeringId],
  )

  useEffect(() => {
    void load()
  }, [load])

  async function loadMore() {
    setLoadingMore(true)
    await load(entries?.at(-1))
    setLoadingMore(false)
  }

  return (
    <section aria-label="Activity" className="grid gap-3">
      {loadFailed ? (
        <Card className="py-0">
          <LoadError title="Couldn't load the activity" onRetry={() => load()} />
        </Card>
      ) : entries === null ? (
        <Card className="gap-0 py-0">
          <ol className="divide-y">
            <ActivitySkeleton />
          </ol>
        </Card>
      ) : entries.length === 0 ? (
        <Card className="py-0">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HistoryIcon />
              </EmptyMedia>
              <EmptyTitle>No activity yet</EmptyTitle>
              <EmptyDescription>Uploads, switches, verdicts and audit requests show here as they happen.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          <ol aria-label="Activity, newest first" className="divide-y">
            {entries.map((entry) => (
              <ActivityItem key={entry.id} entry={entry} />
            ))}
          </ol>
        </Card>
      )}
      {hasMore && (
        <div>
          <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore && <Spinner />}
            Load more
          </Button>
        </div>
      )}
    </section>
  )
}

function ActivityItem({ entry }: { entry: ActivityEntry }) {
  const Icon = ACTIVITY_ACTIONS[entry.action].icon
  const note = activityNote(entry)
  return (
    <li className="grid grid-cols-[1.25rem_1fr] gap-x-3 px-4 py-3 md:px-6">
      <Icon aria-hidden="true" className="text-muted-foreground mt-0.5 size-5" />
      <div className="grid min-w-0 gap-1">
        <p className="text-sm font-medium">{describeActivity(entry)}</p>
        {note && <p className="text-muted-foreground border-l-2 pl-3 text-sm whitespace-pre-wrap">{note}</p>}
        <p className="text-muted-foreground text-xs">
          {entry.actor_name} · <Time value={entry.created_at} />
        </p>
      </div>
    </li>
  )
}

/** Placeholder entries while the first page loads. */
function ActivitySkeleton() {
  return Array.from({ length: 5 }, (_, row) => (
    <li key={row} aria-hidden="true" className="grid grid-cols-[1.25rem_1fr] gap-x-3 px-4 py-3 md:px-6">
      <Skeleton className="size-5" />
      <div className="grid gap-2">
        <Skeleton className="h-4 w-72 max-w-full" />
        <Skeleton className="h-3 w-40 max-w-full" />
      </div>
    </li>
  ))
}
