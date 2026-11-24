import { CalendarClockIcon, UploadIcon } from 'lucide-react'
import { Link } from 'react-router'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { LECTURER_FILE_SECTION } from '../sections.ts'

/** The user's own timetable is missing, with a link to the timetable section of one of their course files, where they upload it. */
export function TimetableMissing({ semesterCode, offeringId }: { semesterCode: string; offeringId: string }) {
  return (
    <Alert role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 [&>svg]:translate-y-0">
      <CalendarClockIcon />
      <p className="min-w-0 flex-1 basis-60 font-medium">Your timetable for {semesterCode} is missing</p>
      <Button asChild size="sm" variant="outline" className="max-sm:ml-7">
        <Link to={`/course-files/${offeringId}/sections/${LECTURER_FILE_SECTION.number}`}>
          <UploadIcon />
          Upload timetable
        </Link>
      </Button>
    </Alert>
  )
}
