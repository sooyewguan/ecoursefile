import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ArchiveIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CopyIcon,
  MessageSquareIcon,
  PowerIcon,
  PowerOffIcon,
  ReplyIcon,
  SendIcon,
  SquareCheckIcon,
  SquareIcon,
  Trash2Icon,
  UploadIcon,
  type LucideIcon,
} from 'lucide-react'
import { sectionName } from './sections.ts'

/** What an activity log entry records, as the activity_action enum in the database names it. */
export type ActivityAction =
  | 'upload'
  | 'delete'
  | 'reuse'
  | 'switch_on'
  | 'switch_off'
  | 'tick'
  | 'untick'
  | 'verified'
  | 'needs_fix'
  | 'send'
  | 'comment'
  | 'reply'
  | 'close'

/** One entry of a course file's activity, as the course_file_activity RPC returns it. */
export type ActivityEntry = {
  id: number
  created_at: string
  action: ActivityAction
  /** Null for a send, a reply and a close, which are about a whole audit request. */
  section: number | null
  /** The name of the user who made the change, also once they are deactivated. */
  actor_name: string
  /** The file of an upload, a delete or a reuse. */
  file_name: string | null
  /** The program code of a tick, an untick, or a student timetable's upload or delete. */
  program_code: string | null
  /** The course code and semester code of the past offering a reused file came from. */
  source_course_code: string | null
  source_semester_code: string | null
  /** The reason for a switch away from the course type's setting. */
  reason: string | null
  /** The comment of a verdict or of a staff comment, or the message of a reply. */
  comment: string | null
  /** The auditor, round and flagged sections of the audit request of a send, a comment, a reply or a close. */
  request_auditor_name: string | null
  request_round: number | null
  request_sections: number[] | null
}

/** The section an entry is about, such as 5 Student Timetable, with the program code of a student timetable. */
function place(entry: ActivityEntry) {
  return sectionName(entry.section!) + (entry.program_code ? ` for ${entry.program_code}` : '')
}

const SECTION_LIST = new Intl.ListFormat('en-GB', { type: 'conjunction' })

/** The sections of an entry's audit request, such as 4 Lecturer Timetable and 6 Attendance Record. */
function requestSections(entry: ActivityEntry) {
  return SECTION_LIST.format(entry.request_sections!.map(sectionName))
}

/** Whose audit request an entry is about, and its round, such as Dr. Aminah’s audit request round 2. */
function whoseRequest(entry: ActivityEntry) {
  return `${entry.request_auditor_name}’s audit request round ${entry.request_round}`
}

/**
 * Each action's icon and the plain-language description of an entry with it. The description says
 * what happened, and the page shows who did it and when beside it.
 */
export const ACTIVITY_ACTIONS: Readonly<Record<ActivityAction, { icon: LucideIcon; describe: (entry: ActivityEntry) => string }>> = {
  upload: { icon: UploadIcon, describe: (entry) => `Uploaded ${entry.file_name} to ${place(entry)}` },
  delete: { icon: Trash2Icon, describe: (entry) => `Deleted ${entry.file_name} from ${place(entry)}` },
  reuse: {
    icon: CopyIcon,
    describe: (entry) => `Copied ${entry.file_name} into ${place(entry)} from ${entry.source_course_code} ${entry.source_semester_code}`,
  },
  switch_on: { icon: PowerIcon, describe: (entry) => `Switched ${place(entry)} on` },
  switch_off: { icon: PowerOffIcon, describe: (entry) => `Switched ${place(entry)} off` },
  tick: { icon: SquareCheckIcon, describe: (entry) => `Ticked program code ${entry.program_code} in ${sectionName(entry.section!)}` },
  untick: { icon: SquareIcon, describe: (entry) => `Unticked program code ${entry.program_code} in ${sectionName(entry.section!)}` },
  verified: { icon: CircleCheckIcon, describe: (entry) => `Marked ${place(entry)} Verified` },
  needs_fix: { icon: CircleAlertIcon, describe: (entry) => `Marked ${place(entry)} Needs fix` },
  send: { icon: SendIcon, describe: (entry) => `Sent audit request round ${entry.request_round} on ${requestSections(entry)}` },
  comment: { icon: MessageSquareIcon, describe: (entry) => `Commented on ${place(entry)} in ${whoseRequest(entry)}` },
  reply: { icon: ReplyIcon, describe: (entry) => `Replied to ${whoseRequest(entry)} on ${requestSections(entry)}` },
  close: { icon: ArchiveIcon, describe: (entry) => `Closed audit request round ${entry.request_round} on ${requestSections(entry)}` },
}

/** What the entry records, in plain language. */
export function describeActivity(entry: ActivityEntry) {
  return ACTIVITY_ACTIONS[entry.action].describe(entry)
}

/** The text an entry carries: a switch's reason, a verdict's or a staff comment, or a reply's message. */
export function activityNote(entry: ActivityEntry) {
  return entry.reason ?? entry.comment
}

export const ACTIVITY_PAGE_SIZE = 50

/**
 * A page of the course file's activity, newest first: the entries older than after, or the newest
 * entries when after is left out. hasMore says whether older entries remain. A user who may not read
 * the course file gets the PostgrestError with code 42501.
 */
export async function activityPage(
  client: SupabaseClient,
  offeringId: string,
  after?: ActivityEntry,
  pageSize = ACTIVITY_PAGE_SIZE,
): Promise<{ entries: ActivityEntry[]; hasMore: boolean }> {
  // One entry more than the page shows says whether there is another page.
  const { data, error } = await client.rpc('course_file_activity', {
    offering_id: offeringId,
    before_created_at: after?.created_at ?? null,
    before_id: after?.id ?? null,
    page_size: pageSize + 1,
  })
  if (error) throw error
  const entries: ActivityEntry[] = data
  return { entries: entries.slice(0, pageSize), hasMore: entries.length > pageSize }
}
