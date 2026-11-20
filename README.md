# eCourseFile

A web platform where course coordinators and lecturers submit course files for the ISO audit. The front end is a static React app for Firebase Hosting. The back end is Supabase.

## Requirements

- Node.js 22.18 or later. The scripts in `scripts/` are TypeScript files that Node runs directly.
- npm.
- Docker, for the local Supabase stack.

## Run the app locally

1. Install the dependencies.

   ```sh
   npm install
   ```

2. Start the local Supabase stack. The first start applies the migrations in `supabase/migrations/` and serves the Edge Functions in `supabase/functions/`.

   ```sh
   npm run stack:start
   ```

3. Copy `.env.example` to `.env`.
4. In `.env`, set `VITE_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` to the `PUBLISHABLE_KEY` and `SECRET_KEY` values that `npx supabase status -o env` prints.
5. In `.env`, set `ROOT_PASSWORD`.
6. Create the root user.

   ```sh
   npm run seed
   ```

7. Start the dev server, and open http://localhost:5173.

   ```sh
   npm run dev
   ```

8. Sign in with `ROOT_EMAIL` and `ROOT_PASSWORD`. The app asks root to set a new password before it shows any other page.
9. On the **Users** page, add the first admin. Root can create only admins. The admin then adds departments, staff and the catalog.

After you change `supabase/config.toml` or add an Edge Function, restart the stack. The edge runtime serves only the functions that existed when it started.

```sh
npx supabase stop
npm run stack:start
```

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Starts the Vite dev server on port 5173. Supabase auth redirects expect this port. |
| `npm run build` | Type-checks the project and builds the static site into `dist/`. `firebase.json` serves `dist/`. |
| `npm run preview` | Serves the built `dist/` locally. |
| `npm test` | Runs all tests. The local Supabase stack must be running. |
| `npm run seed` | Runs `scripts/seed-root.ts` with the variables in `.env`. |
| `npm run stack:start` | Starts the local Supabase stack without the services that the app does not use. |
| `npm run db:reset` | Resets the local database to the migrations, then runs `npm run seed`. |

## Environment variables

| Variable | Used by | Value |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Browser app | Supabase API URL. Locally `http://127.0.0.1:54321`. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser app | Supabase publishable key. |
| `SUPABASE_URL` | Seed script | Supabase API URL. |
| `SUPABASE_SECRET_KEY` | Seed script | Supabase secret key. It bypasses row-level security, so never give it a `VITE_` prefix. |
| `ROOT_EMAIL` | Seed script | Email address of the root user. |
| `ROOT_PASSWORD` | Seed script | First password of the root user. Root must replace it at the first sign-in. |
| `ROOT_NAME` | Seed script | Optional display name of the root user. The default is `Root`. |

The seed script exits with code 1 and names each missing variable.

The Edge Functions read these secrets. On the local stack, `[edge_runtime.secrets]` in `supabase/config.toml` sets them. In a hosted project, set them with `npx supabase secrets set NAME=value`.

| Secret | Used by | Value |
| --- | --- | --- |
| `STORAGE_ADAPTER` | `files` and `fake-storage` functions | `graph` to store files in SharePoint, or `fake` to store them in the `fake_storage` schema. The local stack uses `fake`. The `files` function does not start without it, and the `fake-storage` function answers only while it is `fake`. |
| `FAKE_STORAGE_URL` | `files` function, with `fake` | The URL of the `fake-storage` function as the browser reaches it. Locally `http://127.0.0.1:54321/functions/v1/fake-storage`. |
| `GRAPH_TENANT_ID` | `files` function, with `graph` | The Entra tenant ID. |
| `GRAPH_CLIENT_ID` | `files` function, with `graph` | The client ID of the Entra app that has `Sites.Selected` and the `write` role on the site. |
| `GRAPH_CLIENT_SECRET` | `files` function, with `graph` | The client secret of that app. |
| `GRAPH_SITE_ID` | `files` function, with `graph` | The SharePoint site ID, such as `contoso.sharepoint.com,<site-collection-id>,<web-id>`. Files go to the site's default document library. |

## Seeding root again

You can run `npm run seed` more than once. The seed script sets root's password and the must-change-password flag only while root has never signed in. After root signs in, a new run only adds the `root` role back if it is missing. A new run never overwrites a password that root chose.

## Users and roles

A user can hold several global roles. The rules for who may change what are SQL functions in `supabase/migrations/20261119020000_role_management.sql`. RLS policies, the `accounts` Edge Function and the app all use these functions.

| Who | May do |
| --- | --- |
| Root | Read every user. Grant and revoke `admin`. Create users whose only role is `admin`. Nothing else. |
| Admin | Read every user. Grant and revoke `lecturer`, `auditor`, `hod`, `dean` and `deputy_dean`. Create staff users, set their department, reset their password, and deactivate or reactivate them. Add, edit and delete departments. Add and edit the catalog. Add semesters, offer courses and assign their lecturers. Upload and delete each semester's Academic Calendar and Appointment Letter. |
| Everyone else | Read their own profile and roles, read departments, read the catalog, and read semesters. |

Some limits apply to everyone:

- Nobody can grant `root`.
- Nobody can change their own roles or the roles of a root user.
- An admin cannot edit, reset or deactivate themselves, another admin or a root user.
- An HoD must have a department. A department can have more than one HoD.
- Clients can update only `full_name`, `department_id` and `active` on a profile. The email and the must-change-password flag are not writable.

A Custom Access Token Hook, `public.custom_access_token_hook`, puts the user's roles in the `app_roles` claim of each access token. RLS reads the roles from that claim, and so does the app. A role change therefore takes effect at the user's next sign-in or token refresh, which is at most one hour later (`jwt_expiry` in `supabase/config.toml`).

When a profile is inactive, the hook refuses to issue a token. The deactivated user gets HTTP 403 at sign-in and at the next token refresh. Their profile stays, so their name still appears wherever it is shown.

## Catalog

The admin keeps the catalog on three pages. The tables and their RLS policies are in `supabase/migrations/20261119030000_catalog.sql`.

| Page | Table | What each entry holds |
| --- | --- | --- |
| **Course types** | `course_types` | A unique name, and `sections_on`, the switchable sections (10 to 16) that are on by default. A switchable section that is not in the list is off. |
| **Courses** | `courses` | A unique code, a title, a department and a course type. |
| **Program codes** | `program_codes` | A unique code, such as `1 BITS S1G1`. |

Only admins add and edit catalog entries. Every signed-in user except root reads them. Nobody deletes them, and a department that has courses cannot be deleted. A write that repeats a name or code fails with Postgres error `23505`, and the pages show it as a plain message.

## Semesters and offerings

The admin sets up each semester on the **Semesters** page. The tables, their RLS policies and the RPCs are in `supabase/migrations/20261119040000_semesters_and_offerings.sql`.

| Table | What each entry holds |
| --- | --- |
| `semesters` | A start year and a number from 1 to 3, where 3 is the short semester. The database generates the unique `code`, such as `2026/2027-1`. |
| `offerings` | One catalog course in one semester, at most once per semester. `coordinator_id` is the coordinator. `default_sections_on` is a copy of the course type's `sections_on`, taken when the offering is created. Later edits to the type, or a new type for the course, leave the offering as it was. `section_reasons` and `sections_on` hold the offering's own setting. See [Switching sections](#switching-sections). |
| `offering_lecturers` | The lecturers of each offering. The coordinator is always one of them, so the coordinator counts as a lecturer. Only users with the `lecturer` role can be added. |

The app writes offerings through two RPCs. Both run as the caller, so RLS lets only admins write.

| RPC | What it does |
| --- | --- |
| `create_offering(semester_id, course_id, coordinator_id, lecturer_ids)` | Adds the offering with its coordinator and lecturers, and returns the offering's id. |
| `set_offering_lecturers(offering_id, coordinator_id, lecturer_ids)` | Replaces the offering's coordinator and lecturers. |

Both add the coordinator to the lecturers when `lecturer_ids` leaves them out. An offering whose coordinator is not one of its lecturers fails with Postgres error `23503`, and a course offered twice in a semester fails with `23505`.

Who reads an offering, its lecturers and its course file is decided by `public.can_read_offering(offering_id)`:

| Role | Offerings they read |
| --- | --- |
| Admin, Auditor, HoD, Dean, Deputy Dean | Every offering in every semester |
| Lecturer | The offerings they teach or coordinate, in every semester |
| Root | None |

Readers of an offering also read `lecturer_name` with each of its lecturers, such as `select=offering_lecturers(lecturer_id, lecturer_name)`. Lecturers cannot read other users' profiles, so this is how they see who they teach with.

The **Course files** page lists the offerings the user reads, grouped by semester, newest first. Each opens a course file page with the 19 sections in their fixed order. The section list is the `SECTIONS` constant in `src/sections.ts`. The page reads each section's `status` from the `section_statuses(offering_id)` RPC:

| Status | Sections |
| --- | --- |
| `missing` | Every section that is on and has no files, except sections 7 to 9. Sections 1 and 3 are missing until the admin uploads the semester's file. Section 4 is missing while any lecturer of the offering, the coordinator included, has no timetable for the semester. Section 5 is missing while no program code is ticked, and while any ticked code has no timetable for the semester. |
| `pending_review` | Every section that is on and has files. Sections 1 and 3 have one once the admin uploads the semester's file, section 4 once every lecturer of the offering has a timetable, and section 5 once codes are ticked and each has a timetable. See [Shared files](#shared-files). |
| `empty` | Sections 7 to 9 while they have no files. They may stay empty and never count as missing. |
| `off` | Sections 10 to 16 that the offering has off |

Each row also has `counts_toward_completeness`, which is false for a switched-off section and true for every other section. The spec makes a switched-off section with an open Needs fix verdict count too. That rule goes in `section_statuses` once verdicts exist.

### Switching sections

The coordinator and lecturers of an offering switch sections 10 to 16 on or off from the row menu on the course file page. Nobody else can, not even the admin, and sections 1 to 9 and 17 to 19 cannot be switched. The migration is `supabase/migrations/20261119130000_section_toggles.sql`.

| RPC or column | What it does |
| --- | --- |
| `switch_section(offering_id, section, is_on, reason)` | Switches the section on (`is_on` true) or off. Setting a section differently from `default_sections_on` needs a reason that is not blank, which is stored without its outer blanks. Setting it back clears the reason, so `reason` may be left out. Switching a section to the setting it has changes nothing. A caller who does not teach the offering, or another section, fails with Postgres error `42501`, and a missing or blank reason with `23514`. |
| `section_reasons` | A column of `offerings`: a JSON object with one reason for each section set differently from `default_sections_on`, keyed by section number, such as `{ "11": "Labs run this semester" }`. |
| `sections_on` | A column of `offerings`, generated from the two above: `default_sections_on` with each section that has a reason switched the other way. Nobody writes it. |

The course file page shows each reason under its section's title, such as "Switched off: Notes are in the textbook". Files in a switched-off section stay, and can still be deleted. Each switch adds a `switch_on` or `switch_off` entry, with its reason, to the activity log. A switch back to the default logs no reason.

## Files

The coordinator and lecturers of an offering upload PDFs to the sections that hold plain files:

| Section | Where the files go |
| --- | --- |
| 2 Teaching Plan, 6 Attendance Record, 17 Week 12 Marks, 18 Grade List | The section |
| 7 Replacement Notices, 8 Proof of Absence, 9 Warning Letters | The section. It may stay empty, and its status is then `empty`, never `missing`. |
| 10 Lecture Notes | The section, while the offering has it on. The browser merges each PDF 8 pages to a page before it uploads it, and only the merged PDF is stored. Staff upload as many parts as they like. |
| 11 Lab Exercises to 16 Final Exam | One slot of one numbered item, such as Lab 2 or Quiz 1, while the offering has the section on. See [Items](#items). |
| 19 LO/PO Analysis | One of four slots: PO Achievement (`po_achievement`), LO Achievement (`lo_achievement`), LO/PO Evaluation (`lo_po_evaluation`) and CQI (`cqi`). Each slot holds its own files in its own order. |

The slots are the `SECTION_SLOTS` constant in `supabase/functions/_shared/sections.ts`, and the `files` table's check constraint lists the same names. Each of these sections' titles on the course file page opens the section page, which lists the files in their order, one list per slot. Everyone who reads the course file sees the lists. The tables, RPCs and their RLS policies are in `supabase/migrations/20261119050000_files_and_activity_log.sql`, `supabase/migrations/20261119090100_plain_file_sections.sql`, `supabase/migrations/20261119100000_lecture_notes.sql` and `supabase/migrations/20261119110000_item_sections.sql`.

A switched-off section shows as `off`, even when it holds files. Staff cannot upload to it, add items to it or reorder its files, but they can still delete its files and items by the usual rights.

### Items

In sections 11 to 16, staff add numbered items with no fixed count. Each item has the slots of its section, in this order:

| Section | Items are called | Slots |
| --- | --- | --- |
| 11 Lab Exercises | Lab | Lab Sheet (`lab_sheet`), Answer Scheme (`answer_scheme`), Script High (`script_high`), Script Medium (`script_medium`), Script Low (`script_low`) |
| 12 Tutorial | Tutorial | Question (`question`), Answer Scheme (`answer_scheme`) |
| 13 Quiz | Quiz | Question (`question`), Answer Scheme (`answer_scheme`), Scripts (`scripts`) |
| 14 Assignment | Assignment | Question (`question`), Rubric (`rubric`), Moderation Form (`moderation_form`), Script High, Script Medium, Script Low |
| 15 Mid-Term Test | Test | Question, Answer Scheme, Moderation Form, Script High, Script Medium, Script Low |
| 16 Final Exam | Exam | Question, Answer Scheme, Moderation Form, Script High, Script Medium, Script Low |

- Script High, Script Medium and Script Low hold one file each. The other slots, Scripts included, hold any number of files in the order staff set.
- The browser merges every answer script, in Script High, Script Medium, Script Low and Scripts, 4 pages to a page before it uploads it. Each script is one upload.
- A new item takes the number after the section's highest item. Deleting an item does not renumber the others.
- The section is `pending_review` once any slot of any item has a file. An item without files does not count.
- Deleting an item deletes its files from storage and from the database, and logs each file's delete. A caller may delete an item when they teach the offering and may delete every file in it. So the coordinator may delete any item, a lecturer an item whose files they all uploaded, and every lecturer an empty item.

| Table | What each entry holds |
| --- | --- |
| `files` | One file in one section of an offering: its `item` number in sections 11 to 16 and its `slot` in sections 11 to 16 and 19 (`null` elsewhere), the storage item ID, the file name, the size, its `position` in its section, item and slot, the uploader and the upload time. A shared file has a `semester_id` in place of the `offering_id`. A lecturer timetable also has the `lecturer_id` whose timetable it is, and a student timetable the `program_code_id`. |
| `items` | One item of sections 11 to 16: the offering, the section and the item's `number`. A file's `item` refers to it, so an item's files go before the item does. |
| `activity_log` | One upload, delete, reuse, switch or tick: the offering, or the `semester_id` for a shared file and the `lecturer_id` for a lecturer timetable, the section, the `program_code_id` of every row of section 5, the `action` (`upload`, `delete`, `reuse`, `switch_on`, `switch_off`, `tick` or `untick`), the actor, the file name of an upload, delete or reuse, the `source_offering_id` of a reuse, which is the past offering the file came from, and the reason of a switch away from the course type default. Rows are never changed or removed, not even by the service role. |

Readers of an offering read all three tables, and the readers of a shared file read its rows. Clients write none of them. The `files` Edge Function writes them with the service role, and `add_item` adds items. Staff can also copy a file in from a past offering. See [Reuse from past offerings](#reuse-from-past-offerings).

| RPC or column | What it does |
| --- | --- |
| `can_upload(offering_id, section)` | Whether the caller may upload to the section. True for sections 2, 6 to 9, 17, 18 and 19, and for sections 10 to 16 while the offering has them on, for the offering's coordinator and lecturers. It asks `user_can_upload(user_id, offering_id, section)` for the caller. Clients cannot call `user_can_upload`. |
| `add_item(offering_id, section)` | Adds the next item to a section from 11 to 16 and returns its number. Adds made at the same time run one after another, so each gets its own number. A caller for whom `can_upload` is false, or another section, fails with Postgres error `42501`. |
| `deletable` | A column of `files`: whether the caller may delete the file. The uploader and the offering's coordinator may, while they teach the offering. Also a column of `items`: whether the caller teaches the offering and may delete every file in the item. |
| `uploader_name` | A column of `files`: the uploader's name. |
| `reorder_files(file_ids)` | Sets the order of one section's or slot's files to the order of `file_ids`. A caller who may not upload to the section, or a list with files of another section, item or slot, fails with Postgres error `42501`. |

### Reuse from past offerings

The coordinator and lecturers of an offering copy a file from a past offering of the same course into a reusable place of their course file. The reusable places are `isReusable` in `supabase/functions/_shared/sections.ts`, read from the `reusable` flag of each section and slot in the registry:

| Section | Reusable places |
| --- | --- |
| 10 Lecture Notes | The section |
| 11 Lab Exercises | Lab Sheet and Answer Scheme of each lab |
| 12 Tutorial | Question and Answer Scheme of each tutorial |

- A past offering is an offering of the same catalog course, so of the same course code, in an earlier semester: one with an earlier start year, or the same start year and a lower number. Semester 3 of a year comes after semester 2. A later offering, the offering itself and offerings of other courses are never past offerings.
- On the section page, each reusable place has a **Reuse from past** button next to its upload button, for staff who may upload there. It opens the picker.
- The picker lists the files in the same section and slot of each past offering, the latest semester first, then by item and by the order in the slot. A lab sheet takes only lab sheets, and the tutorial answer scheme only tutorial answer schemes, from any item. Each listed file has only its id, semester code, item, name and size.
- Reuse copies the stored item into the offering's folder through the storage adapter, as `<upload time>_<file name>` in the same folder an upload would use. The copy is a new file record at the end of its slot, uploaded by the user who picked it, and it holds its own bytes. Deleting the original later leaves the copy, and deleting the copy leaves the original.
- A reuse passes the gates of an upload: the user may upload to the place, so the section is on and they teach the offering, and the item exists. The files function checks them before it copies. `reuse_file` checks the upload right again as it records the copy, so a section switched off, or a lecturer unassigned, while the file was copied gets no file, and the function deletes the copy.
- Each reuse adds a `reuse` row to the offering's activity log, with the file name and the past offering's id in `source_offering_id`.
- The picker gives no other access to past offerings. A lecturer who did not teach one still reads none of its offering row, lecturers, items, files, statuses or log. Clients cannot call the two RPCs below. The `files` function calls them with the service role, after it has asked `can_upload` as the caller.

| RPC | What it does |
| --- | --- |
| `reusable_files(offering_id, section, slot)` | The files of the past offerings of the offering's course in the section and slot, each with the past offering's id and semester code. |
| `reuse_file(source_offering_id, offering_id, section, item, slot, storage_item_id, name, size, actor_id)` | Records a copied file at the end of its slot and logs the reuse, if the actor may still upload to the section. Otherwise it fails with Postgres error `42501`. |

The migrations are `supabase/migrations/20261119170000_fake_storage_copy_item.sql`, `supabase/migrations/20261119170100_reuse_action.sql` and `supabase/migrations/20261119170200_reuse_from_past_offerings.sql`.

### Shared files

A shared file is stored once and linked into many course files. Its key is the semester, the section and, for a lecturer timetable, the lecturer whose timetable it is, or for a student timetable, its program code. Each key holds one file. The `sharedFile` field of each section in `SECTIONS` says what the section's files are shared by. The migrations are `supabase/migrations/20261119140000_shared_files.sql`, `supabase/migrations/20261119150000_lecturer_timetables.sql` and `supabase/migrations/20261119160000_student_timetables.sql`.

| Section | Shared by | Who uploads and deletes it | Course files that link it |
| --- | --- | --- | --- |
| 1 Academic Calendar, 3 Appointment Letter | Semester | The admin, under **Shared files** on the semester page | Every offering of the semester, including offerings added later |
| 4 Lecturer Timetable | Lecturer | Each lecturer, the coordinator included, their own only, on the section 4 page of any course file they teach. The admin cannot. | Every offering the lecturer teaches in the semester, including offerings they are assigned to later |
| 5 Student Timetable | Program code | The admin, one for each program code, under **Student timetables** on the semester page | Every offering of the semester whose coordinator or lecturers tick the code on its section 5 page |

- A semester's file is stored at `eCourseFile/<semester>/_shared/<NN section>/<upload time>_<file name>`, such as `eCourseFile/2026-2027-1/_shared/01 Academic Calendar/2026-11-19T10-30-00.123Z_calendar.pdf`. A timetable goes one folder deeper, in a folder named by the lecturer's id and then their email, such as `eCourseFile/2026-2027-1/_shared/04 Lecturer Timetable/0b6c6f2e-5d0b-4a8e-9a43-3f1d2c7e8a10 aisyah@example.edu/2026-11-19T10-30-00.123Z_timetable.pdf`. Finalize looks in the caller's own folder, so nobody records an upload as another lecturer's timetable. The id keeps two lecturers apart whose emails make the same folder name once the characters SharePoint forbids become `-`, such as `a/b@x` and `a-b@x`. A student timetable goes in a folder named by the program code's id and then the code, such as `.../05 Student Timetable/7f3e9a1c-2b4d-4e6f-8a0b-1c2d3e4f5a6b 1 BITS S1G1/<upload time>_<file name>`, so an upload for one code is never recorded for another.
- To replace a shared file, the user who may delete it deletes it and uploads the new one.
- Sections 1 and 3 of a course file are `missing` until the semester has the file, and `pending_review` once it has. Section 4 is `missing` while any lecturer of the offering has no timetable for the semester, so assigning a lecturer without one sets it back to `missing`. The section pages of 1 and 3 list the linked file. The section 4 page lists every lecturer of the offering, the coordinator first, with their timetable or Missing.
- The section 5 page lists the program codes that have a student timetable for the semester, and the offering's coordinator and lecturers tick the codes whose students take the course. Only a code on that list can be ticked. Section 5 is `missing` while no code is ticked, and `pending_review` once one is. Each tick and untick adds a `tick` or `untick` row, with the `program_code_id`, to the offering's activity log. Ticking a ticked code, or unticking an unticked one, changes and logs nothing.
- A tick says which programs take the course, so it outlives its code's timetable. Deleting the timetable unlinks it from every offering that ticks the code, and section 5 of each is `missing` until staff untick the code or the admin uploads its timetable again, which links it back. The section 5 page lists such a code as ticked and Missing.
- The admin, auditors, HoDs, deans and deputy deans read every shared file. A lecturer reads the calendar, letter and student timetables of each semester in which they teach an offering, their own timetables, and the timetables of the lecturers they teach an offering with. Root reads none.
- Before a delete, the semester page or the section 4 page lists the offerings whose course files link the file, and the user confirms. After the delete, the section is `missing` in each of those course files.
- Each upload and delete adds a row with the `semester_id`, and the `lecturer_id` of a lecturer timetable or the `program_code_id` of a student timetable, to the activity log. The readers of the file read the row.

| RPC or column | What it does |
| --- | --- |
| `can_upload_shared_file(semester_id, section)` | Whether the caller may upload their file of the section for the semester. For sections 1, 3 and 5, true for admins, for a semester that exists. For section 4, true for a lecturer who teaches an offering in the semester. The timetable is always the caller's own. |
| `linked_files` | A computed relationship of `offerings`: the shared files that the offering's course file links, which are the semester's calendar and letter, the timetable of each of its lecturers, and the student timetable of each program code it ticks. The app reads it with `select=linked_files(...)`. |
| `linked_offerings` | A computed relationship of `files`: the offerings whose course files link the shared file. The semester page and the section 4 page read it to list them before a delete. |
| `deletable` | For a lecturer timetable, true for its lecturer. For another shared file, true for admins. |
| `offering_program_codes` | A table: one row for each program code ticked in section 5 of an offering. The offering's readers read it. Clients write it only through `tick_program_code`. |
| `program_code_choices` | A computed relationship of `offerings`: the program codes with a student timetable in the offering's semester, which section 5 can tick. The app reads it with `select=program_code_choices(...)`. |
| `tick_program_code(offering_id, program_code_id, ticked)` | Ticks or unticks the code in section 5 of the offering and logs it. A caller who is not the offering's coordinator or one of its lecturers fails with Postgres error `42501`. Ticking a code that is not in `program_code_choices` fails with `23503`. Any ticked code can be unticked. |

### Upload flow

`src/uploads.ts` holds the browser side. `uploadFile` takes these steps:

1. The browser checks that the file is a PDF of 20 MB or less. The rule is `uploadProblem` in `supabase/functions/_shared/uploads.ts`. Where `pagesPerSheet` in `src/sections.ts` gives a number, the browser first merges the PDF with the PDF engine and applies the rule to the merged PDF. The number is the slot's `perSheet` in `SECTION_SLOTS`, 4 for answer scripts, or else the section's `perSheet` in `SECTIONS`, 8 for Lecture Notes. A PDF that the engine cannot read, such as one with a password, is refused with the code `unreadable_pdf`.
2. The browser calls the `files` function with `create-upload-session`. The function refuses a file name that does not end in `.pdf`, in any case, because SharePoint takes the item's type from its name. It asks `can_upload` as the caller, or `can_upload_shared_file` for a shared file. In sections 11 to 16 it also refuses an item that does not exist, and a slot that holds one file and has it. It refuses a shared file whose key already has one, such as a second timetable of the caller for the semester. It returns a pre-authenticated `uploadUrl` and a `storedName`.
3. The browser sends the file to `uploadUrl` in 5 MiB chunks with `PUT` and `Content-Range`, and without an Authorization header.
4. The browser calls `finalize-upload` with the `storedName`. The function gets the item at the session's path, checks the same rule, and reads the item's first 5 bytes, which must be the PDF signature `%PDF-`. If the item fails a check, the function deletes it. Otherwise it records the file and logs the upload. If recording fails, such as when the item was deleted or the one-file slot filled after the session opened, the function deletes the stored item too. The section's status becomes `pending_review`.

Finalize looks the item up by its path, not by an item ID from the browser. A caller can therefore record or delete only items in a section that they may upload to. Finalizing the same upload twice returns the same record.

Each file is stored at `eCourseFile/<semester>/<course code> <course title>/<NN section>/<upload time>_<file name>`, such as `eCourseFile/2026-2027-1/BITP1113 Programming/02 Teaching Plan/2026-11-19T10-30-00.123Z_plan.pdf`. A file in an item has the item's name as one more folder, and a file in a slot the slot's title, such as `.../11 Lab Exercises/Lab 2/Script High/<upload time>_<file name>` or `.../19 LO-PO Analysis/CQI/<upload time>_<file name>`. Characters that SharePoint does not allow in names become `-`.

### The files Edge Function

The app calls `supabase/functions/files/index.ts` with `supabase.functions.invoke('files', { body })` as the signed-in user. The JSON body has an `action` field.

| `action` | Other fields | Who may call it | What it returns |
| --- | --- | --- | --- |
| `create-upload-session` | `offeringId`, `section`, `item` (sections 11 to 16 only), `slot` (sections 11 to 16 and 19 only), `fileName`. For a shared file, `semesterId`, `section` (1, 3, 4 or 5), `programCodeId` (section 5 only) and `fileName`. Section 4 is the caller's own timetable, so the body names no lecturer. | Users for whom `can_upload` is true. For a shared file, users for whom `can_upload_shared_file` is true. | `{ "uploadUrl", "expiresAt", "storedName" }` |
| `finalize-upload` | The same fields as `create-upload-session`, with `storedName` in place of `fileName` | The same users as `create-upload-session` | `{ "file": <the files row> }` |
| `delete-file` | `fileId`, and `confirmed` set to `true` for a shared file | Users who see the file with `deletable` true | `{ "fileId" }` |
| `delete-item` | `offeringId`, `section` (11 to 16), `item` | Users who see the item with `deletable` true | `{ "item" }` |
| `list-reusable-files` | `offeringId`, `section`, `item` and `slot` of a reusable place, as for `create-upload-session` | Users for whom `can_upload` is true | `{ "files": [{ "id", "semester_code", "item", "name", "size" }] }`, the files of past offerings that the place can take |
| `reuse-file` | The fields of `list-reusable-files`, and the `fileId` of a file it lists | Users for whom `can_upload` is true | `{ "file": <the new files row> }` |

`delete-file` deletes the item from storage for good, then deletes the record and logs the delete. `delete-item` does the same for each file of the item, then deletes the item. If it stops part way, the item stays with the files that are left, and deleting it again finishes the job. On failure, the function returns `{ "code": "...", "message": "..." }`.

| HTTP status | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | The body is not one of the actions above. Sections 11 to 16 need an item number in `item`, and other sections take no `item`. Sections 11 to 16 and 19 need one of the section's slot names in `slot`, and other sections take no `slot`. A body with `semesterId` needs section 1, 3, 4 or 5, and takes no `offeringId`, `item` or `slot`. Section 5 needs the `programCodeId` of a program code that exists, and no other body takes `programCodeId`. `list-reusable-files` and `reuse-file` need a reusable place. |
| 401 | `unauthorized` | The request has no valid signed-in user. |
| 403 | `forbidden` | The caller may not upload to the section, or may not delete the file or item. At `reuse-file`, the section was switched off, or the caller unassigned, while the file was copied. The function deleted the copy. |
| 404 | `not_found` | The upload's item does not exist, finalize found no uploaded item, or the caller cannot see the file or item to delete. At `reuse-file`, the file is not one that `list-reusable-files` lists for the place, such as a file deleted since, or one of another course, of a later offering or of another slot. |
| 409 | `slot_full` | The slot holds one file and has it, or the shared file's key has its file, such as the semester's calendar, the caller's timetable for the semester, or a program code's student timetable for the semester. At finalize, the function deleted the stored item. |
| 409 | `confirmation_required` | `delete-file` of a shared file without `confirmed` set to `true`. Nothing was deleted. |
| 422 | `not_pdf` | `create-upload-session`: the file name does not end in `.pdf`. `finalize-upload`: the stored item is not a PDF or does not start with `%PDF-`, and the function deleted it. |
| 422 | `too_large` | The stored item is larger than 20 MB. The function deleted it. |

### Storage adapters

`supabase/functions/_shared/storage.ts` defines the storage adapter: create an upload session for a path, get the item at a path, read an item's first bytes, copy an item to a path, and delete an item for good. `STORAGE_ADAPTER` picks the implementation.

- `graph` (`_shared/graph-storage.ts`) stores items in the default document library of one SharePoint site through Microsoft Graph. It signs in as the Entra app with the client credentials in the `GRAPH_*` secrets. It reads an item's first bytes by following the `/content` redirect to the item's download URL with a `Range` header, or from the `/content` body when Graph sends the bytes without a redirect. It reads no more of a body than it needs, and a Graph error message holds at most the first 500 bytes of the response body. To copy, it makes the target folder and any missing parents, posts the driveItem `copy`, and polls the monitor URL that Graph answers with until the copy completes, for at most 100 seconds. A copy still running then fails the reuse, and may still land in SharePoint later without a record. No automated test covers it.
- `fake` (`_shared/fake-storage.ts`) keeps items in the `fake_storage` schema, which only the service role can use. Its upload URLs point at the `fake-storage` Edge Function. Like a Graph upload URL, that function takes chunks without an Authorization header, refuses chunks out of order, and wants every chunk except the last in multiples of 320 KiB. It passes each chunk to `fake_storage.put_chunk` as the raw request body, with the session, start and total in headers. Encoding a 5 MiB chunk as text cost the worker about 100 ms of CPU, and the edge runtime retires a worker after 1 s of CPU, so a chunk could fail with HTTP 503 or 546. The fake takes an item's type from its name, as SharePoint does. It copies an item inside the database with `fake_storage.copy_item`, so the bytes never pass through an Edge Function. Seam 1 tests read `fake_storage.items` with the secret key.

`supabase/config.toml` exposes the `fake_storage` schema to the API, so the schema comes from a migration and exists in every database.

## PDF engine

`src/pdf/` holds the PDF engine: pure functions over PDF bytes, built on pdf-lib, that run in the browser and in Node. The app loads it only when it needs it, so pdf-lib is a separate chunk of the build.

`nUp(bytes, perSheet)` in `src/pdf/n-up.ts` returns a new PDF with `perSheet` pages of the source on each A4 portrait page, in their order.

| `perSheet` | Grid | Used for |
| --- | --- | --- |
| 8 | 2 columns, 4 rows | Lecture Notes |
| 4 | 2 columns, 2 rows | Answer scripts |

The grid fills left to right, then top to bottom. Each source page is scaled to fit its cell with a thin frame, and shows the way a viewer shows it: its crop box only, turned by its `/Rotate`. The engine embeds all source pages in one call, so a font that many pages share is copied once.

## The accounts Edge Function

`supabase/functions/accounts/index.ts` handles the account changes that need the service role. The app calls it with `supabase.functions.invoke('accounts', { body })` as the signed-in user. The function asks the database what the caller may do, as the caller, before it uses the service role.

The JSON body has an `action` field.

| `action` | Other fields | Who may call it | What it does |
| --- | --- | --- | --- |
| `create-user` | `email`, `fullName`, `departmentId` (a department id or `null`), `roles`, `temporaryPassword` | Root, with `roles` set to `["admin"]`. Admins, with staff roles. | Creates the user with the temporary password and the must-change-password flag set. If a later step fails, it deletes the new user. |
| `reset-password` | `userId`, `temporaryPassword` | Admins, for users they manage | Sets the temporary password, then sets the must-change-password flag again. |

On success, the function returns HTTP 200 and `{ "userId": "..." }`. On failure, it returns `{ "code": "...", "message": "..." }`. Tests and the app can rely on the `code` values.

| HTTP status | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | The body is not one of the actions above, or Supabase Auth refused a value, such as a short password. |
| 401 | `unauthorized` | The request has no valid signed-in user. |
| 403 | `forbidden` | The caller may not do this. |
| 409 | `email_exists` | A user with this email already exists. |

The Edge Functions import only local files in `supabase/functions/_shared`. They call the Supabase Auth and PostgREST endpoints with `fetch`. In the local edge runtime container, a remote import such as `npm:@supabase/supabase-js` fails at boot when the container cannot verify TLS through a proxy. A function without remote imports does not depend on that.

## Tests

`npm test` runs two Vitest projects.

- `unit` runs the `src/**/*.test.ts` files. These test pure functions, such as the route rules in `src/auth.ts`. They include the seam 3 tests of the PDF engine in `src/pdf/`, which merge PDFs that `src/pdf/fixtures.ts` generates and read the result with pdfjs-dist, the way a viewer shows it.
- `seam1` runs the `tests/**/*.test.ts` files against the local Supabase stack through supabase-js, including the Edge Functions. The upload tests use `src/uploads.ts`, as the app does, and read the fake storage library. Before the tests run, `tests/global-setup.ts` reads the stack's keys from `npx supabase status` and seeds one user for each global role, such as `lecturer@seam1.test`. Tests sign in with `signInAs(role)` from `tests/harness.ts`.

Tests that create users give each user a new email address. You can run the tests again without a database reset. Semester codes are limited, so `pickSemester` in `tests/harness.ts` returns an existing semester once its random code is taken. A test offering can share its semester with other tests' offerings.

An upload of a semester's calendar or letter changes sections 1 and 3 of every offering in the semester. The semesters are therefore split by start year:

- `pickSemester` and `createOffering` use the 2,700 codes with start years 2000 to 2899.
- `semesterWithoutSharedFiles` uses the 300 codes with start years 2900 to 2999. It deletes the calendar and letter that an earlier test or run left, through the `files` function as the admin. Only `tests/shared-files.test.ts` uploads calendars and letters, and its tests run one after another.

A timetable changes section 4 only of the offerings its lecturer teaches in the semester. The tests in `tests/lecturer-timetables.test.ts` upload timetables only for lecturers they create, so they take semesters from `pickSemester` and change no other test's offering.

A student timetable changes section 5 only of the offerings that tick its program code. The tests in `tests/student-timetables.test.ts` upload timetables only for program codes they create, so they also take semesters from `pickSemester`. They read the pick list only for their own codes, because other tests and runs leave student timetables in the same semesters.

The tests in `tests/reuse.test.ts` offer a course they create in four different semesters from `pickSemester`, and order them by start year and number. The picker finds past offerings by course, so other tests' offerings in the same semesters never show in it.

Tests read back the rows they create by id, never a whole table. The API returns at most 1,000 rows, and tables such as `course_types` grow with every run.

## Troubleshooting

- If the stack cannot pull images from `public.ecr.aws`, pull them from Docker Hub instead.

  ```sh
  SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io npm run stack:start
  ```

- If calls to an Edge Function fail with HTTP 404, the edge runtime started before the function existed. If they fail with HTTP 500 and `name resolution failed`, the edge runtime container is not running. In both cases, restart the stack.
- If `npm run stack:start` fails with `supabase_rest_ecoursefile unexpected status 503`, the local database is older than the `fake_storage` migration, and PostgREST does not start without an exposed schema. Start from a new local database. This deletes the local data.

  ```sh
  npx supabase stop --no-backup
  npm run stack:start
  npm run seed
  ```
