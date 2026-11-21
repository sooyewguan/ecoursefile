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

The local stack sends no email. It records each email in the fake outbox instead, so a password reset link is read from there. See [Email](#email).

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
| `MAIL_ADAPTER` | `send-email` and `audit-requests` functions | `graph` to send email from the shared mailbox, or `fake` to record it in the `fake_mail` schema. The local stack uses `fake`. The functions do not start without it. |
| `SEND_EMAIL_HOOK_SECRET` | `send-email` function | The secret of the Send Email Hook, `v1,whsec_` and a base64 key, the same value as the hook's secret in Supabase Auth. The function does not start without it. |
| `GRAPH_TENANT_ID` | `files` function with `STORAGE_ADAPTER` `graph`, and `send-email` and `audit-requests` with `MAIL_ADAPTER` `graph` | The Entra tenant ID. |
| `GRAPH_CLIENT_ID` | The same | The client ID of the Entra app that has `Sites.Selected` and the `write` role on the site, and may send as the shared mailbox. |
| `GRAPH_CLIENT_SECRET` | The same | The client secret of that app. |
| `GRAPH_SITE_ID` | `files` function, with `graph` | The SharePoint site ID, such as `contoso.sharepoint.com,<site-collection-id>,<web-id>`. Files go to the site's default document library. |
| `GRAPH_MAILBOX` | `send-email` and `audit-requests` functions, with `graph` | The address of the Exchange Online shared mailbox that every email comes from. |

## Seeding root again

You can run `npm run seed` more than once. The seed script sets root's password and the must-change-password flag only while root has never signed in. After root signs in, a new run only adds the `root` role back if it is missing. A new run never overwrites a password that root chose.

## Users and roles

A user can hold several global roles. The rules for who may change what are SQL functions in `supabase/migrations/20261119020000_role_management.sql`. RLS policies, the `accounts` Edge Function and the app all use these functions.

| Who | May do |
| --- | --- |
| Root | Read every user. Grant and revoke `admin`. Create users whose only role is `admin`. Nothing else. |
| Admin | Read every user. Grant and revoke `lecturer`, `auditor`, `hod`, `dean` and `deputy_dean`. Create staff users one at a time or from a CSV file, set their title, name and department, reset their password, and deactivate or reactivate them. Add, edit and delete departments. Add and edit the catalog. Add semesters, offer courses and assign their lecturers. Upload and delete each semester's Academic Calendar and Appointment Letter. |
| Everyone else | Read their own profile and roles, change their own title and name, read departments, read the catalog, and read semesters. |

Some limits apply to everyone:

- Nobody can grant `root`.
- Nobody can change their own roles or the roles of a root user.
- An admin cannot edit, reset or deactivate themselves, another admin or a root user.
- An HoD must have a department. A department can have more than one HoD.
- Clients can update only `full_name`, `title`, `department_id` and `active` on a profile, and only on a profile an admin manages. The email and the must-change-password flag are not writable.
- A user changes their own title and name only through `update_my_profile`. No policy lets a user update their own profile row, because that would let them change their own department and active state too.

A Custom Access Token Hook, `public.custom_access_token_hook`, puts the user's roles in the `app_roles` claim of each access token. RLS reads the roles from that claim, and so does the app. A role change therefore takes effect at the user's next sign-in or token refresh, which is at most one hour later (`jwt_expiry` in `supabase/config.toml`).

When a profile is inactive, the hook refuses to issue a token. The deactivated user gets HTTP 403 at sign-in and at the next token refresh. Their profile stays, so their name still appears wherever it is shown.

### Names and titles

A profile has a `full_name` and an optional `title`, an honorific such as `Dr.`, `Prof. Madya` or `Ts.`. A title is trimmed, not empty, and at most 40 characters. `display_name` is a generated column that the database keeps up to date: the title, a space and the full name, or the full name alone. The migration is `supabase/migrations/20261121010000_profile_titles.sql`.

The app names a person by `display_name` wherever it shows them: the header and the home page, the **Users** page, and the staff picker of a semester. The database columns and RPCs that name people read it too: `uploader_name`, the `lecturer_name` of `offering_lecturers` and of `report_lecturers`, `auditor_name`, `replier_name`, `commenter_name`, `actor_name` and `coordinator_name`. So do the PDF cover and the audit request and password reset emails. Lists of people sort by `full_name`, so that people with a title do not group together. The exceptions are the PDF cover and the lecturer timetable section of a course file. They list an offering's lecturers by `lecturer_name` after the coordinator, because lecturers cannot read other profiles.

`update_my_profile(full_name, title)` sets the caller's own name and title, trimmed, and changes nothing else. An empty title clears the title. An empty name fails with Postgres error `23514`, and a name over 200 characters or a title over 40 fails with `22001`. Admins set a user's title and name on the **Users** page, as they set the department.

### Importing users from a CSV file

On the **Users** page, an admin clicks **Import CSV**, downloads the template, fills it in, and uploads it. Each valid row adds a user, as **Add user** would, with the must-change-password flag set. The page then lists every row of the file: the rejected rows first, each with its reason, then the added ones.

The `accounts` function reads the file, not the browser. It checks every row against the database anyway, for departments, roles the caller may give and emails in use, so one reader in one place applies every rule. The code is in `supabase/functions/_shared/user-import.ts`.

- The first row that is not blank names the columns: `full_name`, `email`, `department`, `roles` and `temporary_password`, and optionally `title`. They can be in any order and any case, with spaces for underscores, such as `Full Name`. Other columns are ignored.
- `title` is the user's title, such as `Dr.`, or empty for none. A file without a `title` column gives nobody a title. The template lists `title` last.
- `department` is the department's code, exactly as the **Departments** page shows it, or empty for none. The import does not match names, because two departments can have the same name.
- `roles` holds one or more roles, separated by `;`, such as `lecturer;hod`. A role is matched in any case, with spaces for underscores, such as `Deputy Dean`.
- Spaces around a value are ignored. Quoted values can hold commas, line breaks and doubled quotes. A byte order mark, CRLF or LF line ends, and blank rows are fine. The template starts with a byte order mark, so a spreadsheet opens it as UTF-8.
- A file holds at most 300 users, `MAX_IMPORT_ROWS` in `user-import.ts`. A longer file is refused as a whole with HTTP 400, and the admin splits it. Each row costs the function about 3 ms of CPU and 91 ms in all, and a hosted Edge Function stops after 2 s of CPU or 150 s. A file of 300 rows takes about 0.9 s of CPU and 27 s, so it stays well inside both limits, where a file of about 700 rows would stop part way with no report.

The function reads all rows before it creates anyone. It creates the users of the valid rows one at a time, in file order, through the same code as `create-user`. A rejected row stops no other row, and neither does a server error on a row. Each rejected row gets one `code` and a `reason`.

| `code` | Reason |
| --- | --- |
| `missing_value` | The full name, email, roles or temporary password is empty. |
| `duplicate_email` | Another row of the file has the same email, in any case. Every row with that email is rejected. |
| `unknown_role` | A role is not a global role. |
| `unknown_department` | No department has the code. |
| `forbidden` | The admin may not give a role, which includes `admin` and `root`. Or the row gives `hod` without a department. |
| `email_exists` | A user with the email already exists. |
| `invalid_request` | Supabase Auth refused a value, such as an email in the wrong format or a password shorter than 6 characters. Or the title is longer than 40 characters. |
| `internal_error` | The server failed while it added the user, such as when Supabase Auth answered with HTTP 500. The rows before and after it are still added. Import the row again later. |

A second import of the same file adds nobody. Every row whose user was added is now rejected with `email_exists`, and those users stay as they are. The import never writes the temporary passwords anywhere but Supabase Auth. They are not in any response, log or activity log row.

### Password reset

A user who forgot their password asks for a reset link, and sets a new password with it. Supabase Auth sends no email through SMTP. Its Send Email Hook hands each email to the `send-email` Edge Function, which sends it through the mail adapter. See [Email](#email).

1. The sign-in page links to **Forgot password?**, which asks for the email. The page calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: <the app's origin> })`. It then replaces the form with the same words for every email: "If an account exists for <email>, we sent a reset link. It expires in 1 hour."
2. Supabase Auth calls the hook for an email with an account. The function sends the reset email if the user's profile is active, and sends nothing for a deactivated user. Supabase Auth answers a first request with `{}` and HTTP 200 for an active user, a deactivated user and an email with no account alike.
3. The email greets the user by their display name and links to `/reset-password?token_hash=<token hash>` at the origin of `redirectTo`. Supabase Auth has already checked `redirectTo` against `site_url` and `additional_redirect_urls` in `supabase/config.toml`, and uses `site_url` for any other URL, so the link never leads to another site. Every value the email shows is HTML-escaped.
4. The reset page asks for the new password twice. Only then does it call `supabase.auth.verifyOtp({ token_hash, type: 'recovery' })`, so a mail scanner that opens the link does not use it up. The token signs the user in, and the page sets the password with `supabase.auth.updateUser({ password })` and goes on to the app. A link with no `token_hash` shows "This link doesn't work", and a used or expired one shows "This link has expired", each with **Request a new link**.
5. The link works once, for one hour (`otp_expiry`). A link sent before the user was deactivated signs nobody in, because the access token hook refuses a deactivated user a session with HTTP 403.

Two things in Supabase Auth's answer still differ. A repeat request for an email with an account, within `max_frequency` in `[auth.email]` of the last one, gets HTTP 429 and "you can only request this after N seconds", while an email with no account gets HTTP 200 again. And a request for an email with an account takes longer, because Supabase Auth calls the hook. The page shows its usual text for a 429 too, so the page tells nobody which it was, but someone who calls the Supabase Auth API directly can tell from the status or the time.

A new password clears the must-change-password flag, whether the user sets it on the change-password page or with a reset link, since they chose it. Every new password field, and the temporary password fields of the **Users** page, says "At least 6 characters" and refuses a shorter one before it reaches Supabase Auth, which sets that minimum with `minimum_password_length` in `supabase/config.toml`.

### My profile

Every signed-in user opens **My profile** from the account menu at the top right, at `/profile`. The page splits what an admin sets from what the user sets.

- The card on the left shows the user's initials, their name with its title, and their email, department and roles. It has no inputs. A user with no department sees a dash.
- **Name and title** is a form for the title, which is optional, and the full name. **Save** calls `update_my_profile`. The page then reads the profile again with `useReloadAuth` from `src/auth-provider.tsx`, so the header shows the new name at once, and a toast says "Saved". A blank name shows the database's "Give your full name." under the field. See [Names and titles](#names-and-titles).
- **Password** asks for the current password and the new one twice. The page checks the current password with `supabase.auth.signInWithPassword`, so a person at an unlocked screen who does not know it cannot take over the account. It then calls `supabase.auth.updateUser({ password })`, and a toast says "Password changed". A wrong current password, a new password equal to the current one, and a confirmation that differs each show under their own field. The user stays signed in. This check runs in the browser only. A caller with the session's access token can still call Supabase Auth directly.

Initials skip words that link a given name to a parent's name, such as "bin", "binti" and "a/l", so "Aisyah binti Rahman" shows as AR. The rule is `initialsOf` in `src/names.ts`.

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

The **Course files** page lists the offerings the user reads, grouped by semester, newest first. Each opens a course file page. Its **Sections** tab shows the 19 sections in their fixed order, and its **Activity** tab the course file's activity. See [Activity](#activity). The section list is the `SECTIONS` constant in `src/sections.ts`. The page reads each section's `status` from the `section_statuses(offering_id)` RPC:

| Status | Sections |
| --- | --- |
| `missing` | Every section that is on and has no files, except sections 7 to 9. Sections 1 and 3 are missing until the admin uploads the semester's file. Section 4 is missing while any lecturer of the offering, the coordinator included, has no timetable for the semester. Section 5 is missing while no program code is ticked, and while any ticked code has no timetable for the semester. |
| `pending_review` | Every section that is on and has files, with no verdict or with files changed since its latest verdict. Sections 1 and 3 have one once the admin uploads the semester's file, section 4 once every lecturer of the offering has a timetable, and section 5 once codes are ticked and each has a timetable. See [Shared files](#shared-files). Also a switched-off section that changed since its latest verdict, when that verdict is Needs fix. |
| `verified`, `needs_fix` | The section's latest verdict, while the section has the files it had when the auditor gave it, and is on or off as it was then. See [Auditor verdicts](#auditor-verdicts). |
| `empty` | Sections 7 to 9 while they have no files, with no verdict or with a change since. They may stay empty and never count as missing. |
| `off` | Sections 10 to 16 that the offering has off, with no verdict or with a change since a Verified verdict |

A verdict never hides `missing`. Each row also has `counts_toward_completeness`, which is false for a switched-off section and true for every other section. A switched-off section whose latest verdict is Needs fix counts too.

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
| `activity_log` | One upload, delete, reuse, switch, tick, verdict, or send of, comment on or reply to an audit request: the offering, or the `semester_id` for a shared file and the `lecturer_id` for a lecturer timetable, the section (none for a send or a reply), the `program_code_id` of every row of section 5 except a verdict's or a comment's, the `action` (`upload`, `delete`, `reuse`, `switch_on`, `switch_off`, `tick`, `untick`, `verified`, `needs_fix`, `send`, `comment` or `reply`), the actor, the file name of an upload, delete or reuse, the `source_offering_id` of a reuse, which is the past offering the file came from, the reason of a switch away from the course type default, the `comment` of a verdict, of a staff comment or of a reply's message, and the `audit_request_id` of a send, comment or reply. Rows are never changed or removed, by anyone. See [Activity](#activity). |

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
| `linked_files` | A computed relationship of `offerings`: the shared files that the offering's course file links, which are the semester's calendar and letter, the timetable of each of its lecturers, and the student timetable of each program code it ticks. The app reads it with `select=linked_files(...)`. They are the files of the semester whose key is one of `linked_shared_keys(offering)`, the rule that the course file's activity follows too. |
| `linked_offerings` | A computed relationship of `files`: the offerings whose course files link the shared file. The semester page and the section 4 page read it to list them before a delete. |
| `deletable` | For a lecturer timetable, true for its lecturer. For another shared file, true for admins. |
| `offering_program_codes` | A table: one row for each program code ticked in section 5 of an offering. The offering's readers read it. Clients write it only through `tick_program_code`. |
| `program_code_choices` | A computed relationship of `offerings`: the program codes with a student timetable in the offering's semester, which section 5 can tick. The app reads it with `select=program_code_choices(...)`. |
| `tick_program_code(offering_id, program_code_id, ticked)` | Ticks or unticks the code in section 5 of the offering and logs it. A caller who is not the offering's coordinator or one of its lecturers fails with Postgres error `42501`. Ticking a code that is not in `program_code_choices` fails with `23503`. Any ticked code can be unticked. |

### Upload flow

`src/uploads.ts` holds the browser side. `uploadFile` takes these steps:

1. The browser checks that the file is a PDF of 20 MB or less. The rule is `uploadProblem` in `supabase/functions/_shared/uploads.ts`. Where `pagesPerSheet` in `src/sections.ts` gives a number, the browser first merges the PDF with the PDF engine and applies the rule to the merged PDF. The number is the slot's `perSheet` in `SECTION_SLOTS`, 4 for answer scripts, or else the section's `perSheet` in `SECTIONS`, 8 for Lecture Notes. The browser then reads the PDF to store with the engine's `loadPdf`, as the compile will. A PDF that the engine cannot read is refused with the code `unreadable_pdf` and a message that names the file: a protected one, with any password, even one that only limits printing or editing, or a damaged one. The calendar, the letter and the timetables take the same steps.
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
| `compile-manifest` | `offeringId` | Users for whom `can_read_offering` is true | The manifest that the browser compiles the course file's PDF from. See [Compiled PDF](#compiled-pdf). |

`delete-file` deletes the item from storage for good, then deletes the record and logs the delete. `delete-item` does the same for each file of the item, then deletes the item. If it stops part way, the item stays with the files that are left, and deleting it again finishes the job. On failure, the function returns `{ "code": "...", "message": "..." }`.

| HTTP status | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | The body is not one of the actions above. Sections 11 to 16 need an item number in `item`, and other sections take no `item`. Sections 11 to 16 and 19 need one of the section's slot names in `slot`, and other sections take no `slot`. A body with `semesterId` needs section 1, 3, 4 or 5, and takes no `offeringId`, `item` or `slot`. Section 5 needs the `programCodeId` of a program code that exists, and no other body takes `programCodeId`. `list-reusable-files` and `reuse-file` need a reusable place. |
| 401 | `unauthorized` | The request has no valid signed-in user. |
| 403 | `forbidden` | The caller may not upload to the section, may not delete the file or item, or may not read the course file to compile. At `reuse-file`, the section was switched off, or the caller unassigned, while the file was copied. The function deleted the copy. |
| 404 | `not_found` | The upload's item does not exist, the offering to compile does not exist, finalize found no uploaded item, or the caller cannot see the file or item to delete. At `reuse-file`, the file is not one that `list-reusable-files` lists for the place, such as a file deleted since, or one of another course, of a later offering or of another slot. |
| 409 | `slot_full` | The slot holds one file and has it, or the shared file's key has its file, such as the semester's calendar, the caller's timetable for the semester, or a program code's student timetable for the semester. At finalize, the function deleted the stored item. |
| 409 | `confirmation_required` | `delete-file` of a shared file without `confirmed` set to `true`. Nothing was deleted. |
| 422 | `not_pdf` | `create-upload-session`: the file name does not end in `.pdf`. `finalize-upload`: the stored item is not a PDF or does not start with `%PDF-`, and the function deleted it. |
| 422 | `too_large` | The stored item is larger than 20 MB. The function deleted it. |

### Storage adapters

`supabase/functions/_shared/storage.ts` defines the storage adapter: create an upload session for a path, get the item at a path, read an item's first bytes, copy an item to a path, give a short-lived download URL for an item, and delete an item for good. `STORAGE_ADAPTER` picks the implementation.

- `graph` (`_shared/graph-storage.ts`) stores items in the default document library of one SharePoint site through Microsoft Graph. It signs in as the Entra app with the client credentials in the `GRAPH_*` secrets. It reads an item's first bytes by following the `/content` redirect to the item's download URL with a `Range` header, or from the `/content` body when Graph sends the bytes without a redirect. It reads no more of a body than it needs, and a Graph error message holds at most the first 500 bytes of the response body. To copy, it makes the target folder and any missing parents, posts the driveItem `copy`, and polls the monitor URL that Graph answers with until the copy completes, for at most 100 seconds. A copy still running then fails the reuse, and may still land in SharePoint later without a record. A download URL is the item's `@microsoft.graph.downloadUrl`, which works for about an hour without an Authorization header. No automated test covers it.
- `fake` (`_shared/fake-storage.ts`) keeps items in the `fake_storage` schema, which only the service role can use. Its upload URLs point at the `fake-storage` Edge Function. Like a Graph upload URL, that function takes chunks without an Authorization header, refuses chunks out of order, and wants every chunk except the last in multiples of 320 KiB. It passes each chunk to `fake_storage.put_chunk` as the raw request body, with the session, start and total in headers. Encoding a 5 MiB chunk as text cost the worker about 100 ms of CPU, and the edge runtime retires a worker after 1 s of CPU, so a chunk could fail with HTTP 503 or 546. The fake takes an item's type from its name, as SharePoint does. It copies an item inside the database with `fake_storage.copy_item`, so the bytes never pass through an Edge Function. Its download URL is `<FAKE_STORAGE_URL>/<item id>?expires=<time>&signature=<HMAC>`, which works for an hour. The `fake-storage` function answers a `GET` of it, without an Authorization header, with the item's bytes, if the signature matches the item and expiry. It signs with the service role key, so the URL needs no stored session. It streams the bytes from `fake_storage.read_item`, which PostgREST sends as the raw body because the function returns the `"application/octet-stream"` domain, so the worker never encodes them. A changed or expired URL gets HTTP 401, and a deleted item 404. Seam 1 tests read `fake_storage.items` with the secret key.

`supabase/config.toml` exposes the `fake_storage` schema to the API, so the schema comes from a migration and exists in every database.

## Auditor verdicts

Auditors read every course file in every semester, and give any section of it a verdict: `verified` or `needs_fix`, with a comment. Switched-off sections can be marked too, to challenge a wrong switch. The migrations are `supabase/migrations/20261120010100_auditor_verdicts.sql` and `supabase/migrations/20261120020000_open_needs_fix_counts.sql`.

- Each section page shows the latest verdict, with its auditor, time and comment, to everyone who reads the course file. Auditors also get **Mark verified** and **Mark needs fix**, which ask for the comment. Staff see the card once the section has a verdict. When the section changed after it, so that its status is neither that verdict nor `missing`, the card says the verdict was given before the latest change.
- A verdict holds what `section_contents` returned for the section when the auditor gave it: whether the section was on, and the ids of its files. `section_statuses` shows the latest verdict while `section_contents` still returns the same. Any file that enters or leaves the section sets it back to `pending_review`, or to `off` for a switched-off section whose latest verdict is Verified, whatever made the change: an upload, a delete or a reuse, a shared file uploaded or deleted, a lecturer assigned or unassigned, or a program code ticked or unticked. A new upload has a new id, so replacing a file is a change. Reordering files or adding an item without files is not. A file uploaded and then deleted again leaves the section as the auditor judged it, so the verdict shows again.
- A switch on or off after a verdict is a change too. A switched-off section counts toward completeness while its latest verdict is Needs fix, until a new verdict replaces it. A Needs fix on a switched-off section challenges the switch, and a later change, such as a deleted file or switching a flagged section off, leaves the switch just as wrong. So the section keeps counting, and its status is `pending_review` until the auditor checks it again.
- Each verdict adds a `verified` or `needs_fix` row, with its comment, to the offering's activity log.
- A Needs fix also goes into the auditor's draft audit request, and a Verified takes the section out of it. See [Audit requests](#audit-requests).

| RPC, table or column | What it does |
| --- | --- |
| `record_verdict(offering_id, section, verdict, comment)` | Records the caller's verdict on the section and logs it. `verdict` is `verified` or `needs_fix`. `needs_fix` needs a comment that is not blank. A comment is stored without its outer blanks, and a blank comment on `verified` as none. A caller without the `auditor` role, a section outside 1 to 19, or an offering that does not exist fails with Postgres error `42501`, a missing comment with `23514`, and a missing verdict with `22004`. |
| `section_verdicts` | Every verdict ever given: the offering, the section, the verdict, the comment, the auditor, the section's `file_ids` and `section_on` when it was given, and the time. Readers of the offering read them. Clients write them only through `record_verdict`, and nobody changes or removes them, not even the service role. |
| `auditor_name` | A column of `section_verdicts`: the auditor's name, for everyone who reads the verdict. |
| `section_contents(offering)` | For each of the 19 sections, whether it is on and the sorted ids of its files: the course file's own files and the shared files it links. |
| `section_contents_of(offering_ids)`, `section_statuses_of(offering_ids)` | `section_contents` and the statuses of `section_statuses` for many offerings at once, one row for each section of each offering, with its `offering_id`. `section_contents` and `section_statuses` read from them, so one query holds each rule. Clients cannot call `section_statuses_of`. `section_statuses` and the report RPCs call it as its owner, after they check which offerings the caller reads. See [Reports](#reports). |

## Audit requests

An audit request is one batch of Needs fix sections from one auditor on one course file. Its `state` goes from `draft` to `sent` to `replied`, one step at a time, and never back. The migrations are `supabase/migrations/20261120050000_audit_request_values.sql` and `supabase/migrations/20261120050100_audit_requests.sql`.

1. **Draft.** Each Needs fix that an auditor records goes into their draft request for the course file, with the verdict's comment, and `record_verdict` makes the draft when they have none. Marking the section Needs fix again replaces its comment, and marking it Verified takes it out of the draft. A draft left with no sections goes. An auditor has at most one draft per course file, by the unique index `audit_requests_one_draft_idx`, so marks made at the same time share it. Only its auditor reads a draft, and nobody gets an email.
2. **Send.** The auditor sends the draft by hand. The coordinator and the lecturers of the offering get one email, listing every flagged section with its comment. Each item keeps its section's file ids at the send, as `section_contents` returns them.
3. **Checklist.** Everyone who reads the course file reads the sent request, and its sections are the staff's checklist. An item is ticked while its section holds a file that it did not hold at the send: an upload, a reuse, or a shared file uploaded or linked into the course file, such as a lecturer's timetable or the timetable of a program code ticked in section 5. A file uploaded before the send ticks nothing, and neither does deleting or reordering files. An item unticks when its new file is deleted. A switched-off section takes no uploads, so staff answer it with a comment, or switch it on and upload. The coordinator and lecturers comment on any item, and a new comment replaces the earlier one.
4. **Reply.** Once every item is ticked or commented, any coordinator or lecturer of the offering replies, with an optional message. The auditor gets an email with the message and each section's answer. Each item keeps its section's file ids at the reply, so its tick stays as staff replied. The course file page shows the reply to the auditor and to staff.
5. **New round.** The auditor checks the sections again. Any new Needs fix goes into a new draft, also while a sent request waits for its reply.

Several auditors keep their own requests on one course file. Each send, staff comment and reply adds a row to the offering's activity log.

The **Sections** tab of the course file page lists the requests that the user reads above its sections, the user's draft first, then the latest sent. An auditor sees their draft, with each flagged section's status now, and **Send to staff**. Everyone who reads the course file sees each sent request: its auditor, its checklist with each item's comment, tick and staff comment, and its reply. The coordinator and lecturers get **Comment** on each item and **Reply to auditor**, which stays disabled until every item is ticked or commented. When a step's email has not gone, the auditor of a sent request, or the staff of a replied one, get **Send the email again**.

The request's email goes to every coordinator and lecturer of the offering whose profile is active, the coordinator first, and to each address once. Deactivated staff cannot sign in to fix anything, so they get none. The reply's email goes to the request's auditor, while their profile is active. Every value a user wrote, such as names, the course code and title, comments and the message, is HTML-escaped.

Each step commits first, and its email goes after it. `audit_request_emails` records each email's delivery: the function claims it before it sends it, and marks it delivered after.

- A retry or a second click makes no second step, since a step already made changes nothing. It sends no second email, since the email is delivered or another call holds the claim.
- When the email cannot be sent, the step stays made, the claim goes, and the function answers HTTP 502 `mail_failed`. The request shows that its email is not delivered (`email_pending`), and Send or Reply again sends it once.
- If the function stops after the mail adapter sent the email and before it marked it delivered, the claim lapses after five minutes, and a retry then sends the email again. This is the only way an email goes twice.
- The step comes first so that no email is sent for a step that did not happen, and staff read a sent request in the app even when its email failed. With the email first, marks that the auditor made while the email went out would change the draft it listed.

| RPC, table or column | What it does |
| --- | --- |
| `audit_requests` | One request: the offering, the auditor, the `state`, the times of its send and reply, who replied, and the reply's message. A trigger allows only the two steps, each made by one update. Only the RPCs below write it. |
| `audit_request_items` | One flagged section of a request: the `verdict_id` of the Needs fix that flagged it, the section's file ids at the send and at the reply, and the staff comment with its author and time. The app reads the verdict's comment with `select=verdict:section_verdicts(comment)`. |
| `ticked`, `commenter_name` | Columns of `audit_request_items`: whether the item is ticked, and the name of the staff member who commented. |
| `checklist_complete`, `email_pending`, `auditor_name`, `replier_name` | Columns of `audit_requests`: whether every item is ticked or commented, whether the email of the latest step is not delivered yet, and the names of the auditor and of the staff member who replied. |
| `send_audit_request(request_id, actor_id)` | Sends the draft for the actor and logs it. A request already sent stays as it is. An actor who is not the draft's auditor, or lacks the `auditor` role or an active profile, fails with Postgres error `42501`. Only the service role may call it. |
| `comment_on_audit_item(request_id, section, comment)` | Sets the caller's comment on an item of a sent request and logs it. The comment is kept without its outer blanks, and the same comment again changes and logs nothing. A caller who does not teach the offering, a section that is not an item, or a draft or replied request fails with `42501`, and a blank comment with `23514`. |
| `reply_to_audit_request(request_id, actor_id, message)` | Replies to a sent request for the actor and logs the reply with its message. A request already replied stays as it is, and so does a request with an item neither ticked nor commented. An actor who does not teach the offering, or whose profile is not active, fails with `42501`. Only the service role may call it. |

Clients cannot call `send_audit_request` or `reply_to_audit_request`, so no step happens without its email. The app makes the two steps through the `audit-requests` function, which calls them and sends the emails.

### The audit-requests Edge Function

The app calls `supabase/functions/audit-requests/index.ts` through `sendAuditRequest` and `replyToAuditRequest` in `src/audit-requests.ts`, as the signed-in user. The function reads the request as the caller, so nobody else finds a draft. It then makes the step with the RPC as the service role, for the caller's user id, and sends the step's email if it is still owed. The JSON body has an `action` field.

| `action` | Other fields | Who may call it | What it returns |
| --- | --- | --- | --- |
| `send` | `requestId` | The request's auditor | `{ "request": { "id", "state" } }` |
| `reply` | `requestId`, and `message`, text or `null` | The coordinator and lecturers of the request's offering | `{ "request": { "id", "state" } }` |

| HTTP status | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | The body is not one of the actions above. |
| 401 | `unauthorized` | The request has no valid signed-in user. |
| 403 | `forbidden` | A `send` by anyone but the request's auditor, or a `reply` by anyone but the offering's coordinator and lecturers, whether or not the checklist is complete. A user deactivated while signed in gets it too. |
| 404 | `not_found` | The caller cannot read the request, such as another auditor's draft. |
| 409 | `checklist_incomplete` | A `reply` by the offering's staff while an item is neither ticked nor commented. |
| 502 | `mail_failed` | The step is made, but its email could not be sent. The same call again sends it. |

## Activity

The **Activity** tab of a course file page, at `/course-files/<offering id>?tab=activity`, lists the course file's activity log, newest first. Each entry says what happened in plain language, such as "Uploaded plan.pdf to 2 Teaching Plan". Below it come the text the entry carries, such as a verdict's comment, then the name of the user who did it and the time. The tab shows the newest 50 entries, and **Load more** adds the next 50 older ones.

`ACTIVITY_ACTIONS` in `src/activity.ts` holds each action's icon and description, one entry for each value of the `activity_action` enum. A test compares the two, so an action added to the log fails the tests until it has a description.

| Action | Description |
| --- | --- |
| `upload`, `delete` | Uploaded or deleted the file in the section, and for a student timetable, the program code it is for |
| `reuse` | Copied the file into the section, from the course code and semester code of the past offering |
| `switch_on`, `switch_off` | Switched the section on or off, with the reason for a switch away from the course type's setting |
| `tick`, `untick` | Ticked or unticked the program code in section 5 |
| `verified`, `needs_fix` | Marked the section Verified or Needs fix, with the comment |
| `send`, `comment`, `reply` | Sent an audit request, commented on a section of one, or replied to one, with the comment or the reply's message |

The activity of a course file holds the entries of its offering, and those of the shared files it links: the calendar and letter of its semester, the timetables of its lecturers, and the student timetables of the codes it ticks. It follows the lecturers and ticks that the offering has now, as `linked_files` does, and both read `linked_shared_keys`.

- The activity holds a lecturer's timetable entries while the lecturer teaches the offering, and drops them when the admin unassigns the lecturer. The database does not record when a lecturer was assigned, so it cannot tell which entries came from that time. A lecturer of the offering also cannot read the timetable of someone who no longer teaches with them.
- The activity holds a program code's timetable entries while the code is ticked. The tick and untick entries belong to the offering, so they stay.
- A timetable deleted while its lecturer or code is still linked keeps its entries.

The coordinator and lecturers of the offering, auditors, HoDs, deans, deputy deans and the admin read it, as `can_read_offering` says. An HoD reads every course file, whatever its department. Other lecturers and root cannot. The migrations are `supabase/migrations/20261120060000_append_only_activity_log.sql` and `supabase/migrations/20261120060100_course_file_activity.sql`.

| RPC | What it does |
| --- | --- |
| `course_file_activity(offering_id, before_created_at, before_id, page_size)` | Up to `page_size` entries (50 by default) of the course file's activity, newest first by time and then id, older than the entry with `before_created_at` and `before_id`, or the newest entries when both are null. Each has its `id`, `created_at`, `action`, `section` (null for a send or a reply), `actor_name`, `file_name`, `program_code`, `source_course_code` and `source_semester_code` of a reuse, `reason` and `comment`. A deactivated actor keeps their name. It names the past offering of a reuse only by its codes, so a lecturer still reads nothing else of it. A caller who may not read the offering, or an offering that does not exist, fails with Postgres error `42501`. |
| `linked_shared_keys(offering)` | The keys of the shared files that the offering's course file links, in its semester: no lecturer and no program code for the calendar and letter, each of its lecturers, and each code it ticks. |

`activityPage(client, offeringId, after?)` in `src/activity.ts` reads one page for the app and the tests. It asks for one entry more than it shows, to know whether there is another page. A page starts after the last entry shown, by time and id, so entries added meanwhile neither repeat an entry nor skip one.

`course_file_activity` asks `can_read_offering` once as the caller, then reads the log as its owner, from the indexes on `(offering_id, created_at, id)` and on `(semester_id, created_at, id)`. On an offering with 5,000 entries in a semester with 2,000 shared-file entries, a page took 3.6 ms through the API, the same at the top and 4,000 entries down. Reading the log as the caller runs the RLS policy's check on each entry it reads.

Nobody changes or removes an entry. Clients have no update, delete or truncate grant on `activity_log`, and neither has the service role, so the API refuses them with `42501`. Clients cannot add entries either. Grants do not bind the table's owner. The RPCs that log changes, such as `record_verdict`, run as the owner, and so do migrations and the SQL editor. A trigger therefore refuses every update, delete and truncate of the table, by any role, with `42501`.

## Reports

Four RPCs report the completeness of one semester's course files. Each takes the `semester_id`, and each counts from the same section statuses that the course file page shows. The migration is `supabase/migrations/20261120070100_reports.sql`.

| RPC | View | One row for each |
| --- | --- | --- |
| `report_faculty_summary(semester_id)` | Faculty summary | The semester, so always one row |
| `report_departments(semester_id)` | Department breakdown | Department with offerings in the semester, by department code |
| `report_offerings(semester_id)` | Offering list, section heatmap, and the lecturers' completeness view | Offering, by course code |
| `report_lecturers(semester_id)` | Lecturer view | Lecturer of an offering in the semester, the coordinators included, by full name |

The reports cover the offerings of the semester that `can_read_offering` lets the caller read. The admin, auditors, HoDs, deans and deputy deans get every offering. A lecturer gets the offerings they teach or coordinate, so their summary sums only those, and their lecturer view lists only the lecturers of those offerings, with only those offerings. Root gets Postgres error `42501`. Each report calls `can_read_offering` once for each offering of the semester, and then reads as its owner. So names show for every reader, and the RLS policy of `files` does not run on each file.

The **Reports** page shows the reports to the admin, auditors, HoDs, deans and deputy deans. You pick a semester, and the page opens on the newest semester with offerings. Its tabs are:

- **Summary**: the faculty summary as four figures, and the department breakdown below it. Each department links to its offerings on the **Offerings** tab.
- **Offerings**: the offering list, which you can filter by department and by `status`.
- **Heatmap**: one row for each offering and one column for each section. Each cell shows the section's status as a color and an icon. Below 1,024 px, Tailwind's `lg`, each offering shows its 19 sections as numbered squares under its course instead, ten to a row on a phone.
- **Lecturers**: each lecturer with their offerings and the missing sections linked to them, which you can search by name.

The semester, the tab and the filters are in the URL, such as `/reports?semester=<id>&tab=offerings&department=<id>&status=incomplete` or `/reports?semester=<id>&tab=lecturers&search=chloe`, so the filters last across tabs. Choosing another semester drops the department. A semester, tab, status or department that the page cannot show gives way to what it shows, in the URL too, so that the URL and the controls agree. A semester in which the user reads no offering gives way to the newest. Each course code links to its course file.

Each tab loads its report once. A failed load shows "Couldn't load this report" with **Try again** under the tabs. A semester whose report has no offerings shows "No offerings in" and the semester code, in place of the tab's controls.

The **My completeness** page shows lecturers each course file they teach or coordinate in one semester: its status, completeness, coordinator and last upload, and its missing sections and its sections marked Needs fix, by number and title, each linked to its section page. While the lecturer has no timetable for the semester, an alert links to the section 4 page of one of their course files, where they upload it. Its semesters are those in which they teach, newest first. A lecturer who also holds a management role sees only their own offerings there, and every offering on the **Reports** page.

### What the numbers mean

A section **counts** when `counts_toward_completeness` is true and its status is not `empty`. A switched-off section therefore counts only while its latest verdict is Needs fix, and sections 7 to 9 count once they hold a file or a verdict. A section that counts is `missing`, `pending_review`, `verified` or `needs_fix`.

| Column | What it counts |
| --- | --- |
| `counted_sections` | The sections that count |
| `uploaded_sections` | The sections that count and are not `missing`. A section marked Needs fix has its files, so it is uploaded. |
| `verified_sections`, `needs_fix_sections` | The sections that count whose status is `verified` or `needs_fix`. A verdict counts only while the section is as the auditor judged it. |
| `percent_complete` | Of one offering, `uploaded_sections` as a percentage of `counted_sections` |
| `percent_uploaded`, `percent_verified`, `percent_needs_fix` | Of a department or the faculty, the sum of `uploaded_sections`, `verified_sections` or `needs_fix_sections` over its offerings, as a percentage of the sum of their `counted_sections`. Every section weighs the same, so an offering with more sections weighs more. It is not the average of the offerings' percentages. |

Percentages have one decimal place, and are null when no section counts, as for a semester without offerings.

An offering is **complete** when no section that counts is missing, which is `percent_complete` 100. So every section that is on has at least one file, except sections 7 to 9, which never count as missing. Section 4 needs the timetable of every lecturer of the offering, the coordinator included. Section 5 needs at least one ticked program code, and a timetable for each ticked code, since a code whose timetable was deleted leaves the section missing. For example, an offering with Lecture Notes on and nothing uploaded counts 10 sections, 1 to 6, 10 and 17 to 19, and is 0% complete. Uploading every one of them makes it 100%. A file in section 7 then makes 11 that count, all uploaded.

`report_offerings` also gives each offering's `status`, which the offering list filters on:

| `status` | When |
| --- | --- |
| `incomplete` | A section that counts is missing |
| `needs_fix` | None is missing, and one is Needs fix |
| `pending_review` | None is missing or Needs fix, and one is Pending review |
| `verified` | Every section that counts is Verified |

Each `report_offerings` row also has the course, its department, the coordinator's `coordinator_name`, `missing_sections` in section order, `section_statuses`, the 19 statuses in section order for the heatmap, and `last_upload_at`. That is the latest upload or reuse into the offering's own sections, or null. The shared files it links, such as the calendar and the timetables, are left out, because each is uploaded once for many course files.

Each `report_lecturers` row has the lecturer's id, name and profile department, `timetable_missing`, which is true while they have no timetable for the semester, and `offerings`, a JSON array of their offerings by course code. Each has its `offering_id`, `course_code`, `course_title`, `coordinator`, true for the one they coordinate, and the `missing_sections` linked to the lecturer. Those are the offering's missing sections, without sections 1 and 3, which the admin uploads, and without section 4 unless the lecturer's own timetable is missing. Section 5 stays, since staff tick the codes.

The API returns at most 1,000 rows for one request (`max_rows` in `supabase/config.toml`). The app reads a report with `fetchReport(client, rpc, semesterId)` in `src/reports.ts`, which reads it with `readAll`: it asks for the rows a page at a time with `range`, sorted as the RPC sorts them, until a page comes back with fewer than 1,000 rows. A semester of 1,001 offerings takes two requests, and one of about 100 takes one. The **Reports** page reads its list of semesters, and **My completeness** the lecturer's offerings, the same way. Each page is its own query, so an offering that the admin adds while a report of more than 1,000 rows loads can show twice, or be left out, until the page loads the report again.

### Export

Each tab of the **Reports** page has one **Export** menu, at the end of the tab's row of controls, and **My completeness** has one beside the semester. It offers **Excel**, which saves an .xlsx file, and **CSV**, which saves a .csv file. A failed export says "Couldn't export. Try again." in a toast. The browser builds the file from the rows on screen, with the offering list's filters and the lecturer search applied, and saves it as the view's name and the semester code, such as `Offerings 2026-2027-1.xlsx`. The `/` of the code becomes `-`, and so would any other character that Windows, macOS or Linux refuse in a file name. The menu is disabled while the view loads and while it shows no row.

`src/report-tables.ts` describes each view as a table: its name and, for each column, the header, the kind of value and how to read it from a report row. The pages take their headers and values from these descriptions, and `exportReport` in `src/report-export.ts` writes their columns, so a file holds what the screen shows. A screen cell that shows two values is two columns in the file, so that a spreadsheet can sort and filter each one.

| View | Columns |
| --- | --- |
| Summary | Department code, Department, Offerings, Sections (that count), then Sections uploaded and Uploaded (%), Sections verified and Verified (%), and Sections needing fix and Needs fix (%). One row for each department, then the faculty as `All departments`, with no department code. |
| Offerings | Course code, Course (its title), Department code, Department (its name), Coordinator, Status, Complete (%), Missing sections, Last upload |
| My completeness | Course code, Course, Coordinator, Status, Complete (%), Missing sections, Sections needing fix, Last upload |
| Heatmap | Course code, Course, and one column for each of the 19 sections, such as `1 Academic Calendar`, with its status |
| Lecturers | Lecturer, Department code, Department, Timetable (`Missing` or `Uploaded`), Course code, Course, Role (`Coordinator` or `Lecturer`), Missing sections. The screen groups the offerings by lecturer, and the file has one row for each offering of each lecturer. |

- Statuses are the text the screen shows, such as `Needs fix`. Sections are their numbers and titles, such as `4 Lecturer Timetable, 10 Lecture Notes`.
- Counts and percentages are numbers, so a spreadsheet sorts and sums them. A percentage is the number the screen shows before its `%`, such as `82.5`, under a header that ends in `(%)`.
- Last upload is the day the screen shows, in the user's time zone. An .xlsx holds it as a date in the format `yyyy-mm-dd`, and a .csv as text such as `2026-11-20`.
- Where the screen shows a placeholder for no value, such as a dash, No uploads yet or None missing, the cell is empty.

A .csv follows RFC 4180: commas between fields, a field in double quotes when it holds a comma, a quote or a line break, a quote inside one doubled, and CRLF after each row. It starts with a UTF-8 byte order mark, so that Excel reads names outside ASCII correctly. Names, titles and department names are typed by users, so a text that starts with `=`, `+`, `-`, `@`, a tab or a carriage return starts with `'` in a .csv, and a spreadsheet shows it as text rather than run it as a formula.

An .xlsx has one sheet, named after the view, with the header row bold and frozen. The [write-excel-file](https://www.npmjs.com/package/write-excel-file) library writes it. Every text cell is a string in Excel's Text format, so Excel never reads one as a formula, not even after a user edits it, and the text keeps no `'`. The export code and the library load only on the first export, so the main bundle does not carry them: 1.9 kB and 70.3 kB (1.0 kB and 19.5 kB gzipped).

## Phones

The app is desktop first. These pages also work on a phone 360 px wide, with no sideways scroll: the course file page with its sections, audit requests and activity, each section page with its status and the auditor's verdict, the **Reports** page with its Export menus, and **My completeness**. An auditor records verdicts and sends an audit request from a phone, and the coordinator and lecturers comment on its checklist and reply.

- A long word, such as a course code with a UUID or a name with no space, breaks anywhere rather than widen the page. `overflow-wrap: anywhere` on `body` in `src/index.css` does this for the whole app, so no element needs its own rule.
- Below 640 px, Tailwind's `sm`, a table moves its secondary columns into its first cell: the course file's section status, the offering list's status and completeness, the department breakdown's offerings and percentages, and each lecturer's courses. The heatmap shows each offering's sections as numbered squares in its course cell, ten to a row.
- On a touch screen, `pointer: coarse`, the app's controls are at least 44 by 44 px, as WCAG 2.2 success criterion 2.5.5 asks. Buttons, tabs, menu items, selects, inputs and the navigation links grow to 44 px. The checkbox and the close buttons of dialogs and of the navigation keep their size and take taps on a 44 px area around them. With a mouse, the controls keep their desktop size.
- Uploading and the compiled PDF stay desktop first. They work on a phone without breaking the layout, but are not tuned for it.

## Compiled PDF

Everyone who opens a course file page sees **Download compiled PDF**. The browser asks the `files` function for the course file's manifest with the `compile-manifest` action, compiles the PDF from it with the PDF engine, and saves it as `<course code> <semester>.pdf`, such as `BITP1113 2026-2027-1.pdf`. A status line counts the files downloaded so far. If a file cannot be downloaded or read as a PDF, the page names the file and its section, and saves nothing.

- Everyone who reads the course file gets the manifest: its coordinator and lecturers, auditors, HoDs, deans, deputy deans and the admin. Other lecturers and root get HTTP 403. The function asks `can_read_offering` once as the caller, then reads the course file with the service role, so the database does not check each file's row.
- `cover` holds the course code and title, the semester code, the course's department, the coordinator's name, and the names of all lecturers, the coordinator first and then by name. Deactivated staff keep their names, and lecturers get them although they cannot read other profiles.
- `sections` lists the sections of `SECTIONS` that are on, in their order, each with its `number`, `title` and `files`. Switched-off sections are left out, even with files, and so are sections 7 to 9 while they have no files. Any other section that is on stays in with no files, so its divider shows the gap.
- A section's files are its own, by item, then by slot in `SECTION_SLOTS` order, then in the order staff set, and the shared files the course file links into it. Lecturer timetables follow the cover's order of lecturers, and student timetables the program codes in code order.
- Each file has its `id`, `name` and `url`, a download URL from the storage adapter that works for about an hour without an Authorization header.

## PDF engine

`src/pdf/` holds the PDF engine: pure functions over PDF bytes, built on pdf-lib, that run in the browser and in Node. The app loads it only when it needs it, so pdf-lib is a separate chunk of the build.

`compile(manifest, fetchBytes)` in `src/pdf/compile.ts` returns the compiled PDF of a course file. `fetchBytes` gets the bytes at a file's download URL. The PDF holds, in order:

1. A cover page with the course code and title, the semester, the department, the coordinator and every lecturer. A character that the standard Helvetica font cannot show, one outside Windows-1252, shows as `?`.
2. The table of contents: each section's number and title, and the page of its divider. One page lists 28 sections, so the 19 fit on one.
3. For each section of the manifest, a divider page with its number and title, then the pages of its files in order, each at its own size. A section without files says so on its divider.

Every page has "Page n of N" centred at its bottom, as a viewer shows the page: inside its crop box, and upright on a page with a `/Rotate`. Cover, contents and dividers are A4 portrait.

`compile` fetches and copies one file at a time, so it holds one source file besides the PDF it builds. The PDF it builds holds every copied page's streams, and saving it writes one more copy, so memory peaks at about twice the size of the output. A compile of 25 files of 19 MB each, a 477 MB PDF, peaked at 1,000 MB of array buffers and 16 MB of heap in Node 22 (`node --expose-gc`, memory sampled every 20 ms). A file that cannot be fetched, or whose pages cannot be read or copied, such as an encrypted one, stops the compile with a `CompileError` that names the file and its section.

`loadPdf(bytes)` in `src/pdf/load.ts` is how the engine reads a PDF: the compile, the merge and the browser's upload check all use it. It loads the PDF with pdf-lib and checks every page for what the compile needs to stamp page numbers: its crop box, its rotation, and a page pdf-lib can draw on, with `/Resources` a dictionary and `/Contents` a stream or an array. It rejects a protected PDF with `ProtectedPdf`, because pdf-lib cannot read encrypted PDFs, and any other PDF that pdf-lib cannot read or draw on with an error.

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
| `create-user` | `email`, `fullName`, `departmentId` (a department id or `null`), `roles`, `temporaryPassword`, and optionally `title` (a string or `null`) | Root, with `roles` set to `["admin"]`. Admins, with staff roles. | Creates the user with the temporary password and the must-change-password flag set. If a later step fails, it deletes the new user. |
| `import-users` | `csv`, the text of a CSV file | Admins | Creates the user of each valid row as `create-user` does, and rejects the other rows. See [Importing users from a CSV file](#importing-users-from-a-csv-file). |
| `reset-password` | `userId`, `temporaryPassword` | Admins, for users they manage | Sets the temporary password, then sets the must-change-password flag again. |

On success, `create-user` and `reset-password` return HTTP 200 and `{ "userId": "..." }`. `import-users` returns HTTP 200 and `{ "rows": [...] }`, one entry for each row of the file with a value. Each entry has `row`, the row number as a spreadsheet shows it with the header as row 1, and `email`. An added row also has `"status": "created"` and `userId`. A rejected row has `"status": "rejected"`, a `code` and a `reason`. A file that cannot be read as a whole, such as one without a `roles` column or with more than 300 users, gets HTTP 400 and creates nobody. A server error on one row rejects that row with `internal_error`, and the response still covers every row. On failure, the function returns `{ "code": "...", "message": "..." }`. Tests and the app can rely on the `code` values.

| HTTP status | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | The body is not one of the actions above, the title is longer than 40 characters, Supabase Auth refused a value, such as a short password, or the import file cannot be read. |
| 401 | `unauthorized` | The request has no valid signed-in user. |
| 403 | `forbidden` | The caller may not do this. |
| 409 | `email_exists` | A user with this email already exists. |

The Edge Functions import only local files in `supabase/functions/_shared`. They call the Supabase Auth and PostgREST endpoints with `fetch`. In the local edge runtime container, a remote import such as `npm:@supabase/supabase-js` fails at boot when the container cannot verify TLS through a proxy. A function without remote imports does not depend on that.

## Email

The `send-email` Edge Function, `supabase/functions/send-email/index.ts`, is the Send Email Hook of Supabase Auth: `[auth.hook.send_email]` in `supabase/config.toml`. Supabase Auth calls it in place of SMTP with every email it would send, and sends nothing through SMTP itself.

- Supabase Auth signs each call by the Standard Webhooks scheme with the hook's secret. The function checks the signature and its time, within five minutes, against `SEND_EMAIL_HOOK_SECRET`, and answers any other call with HTTP 401 and sends nothing. It checks with Web Crypto rather than the `standardwebhooks` package, because the functions import no remote modules.
- It sends password reset (`recovery`) emails. See [Password reset](#password-reset).
- It refuses every other type, such as `signup`, `invite`, `magiclink`, `email_change` and `reauthentication`, and sends nothing. The admin creates each account with a temporary password, nobody signs up, and the app has no sign-in by link and no change of one's own email. Supabase Auth then fails the request with HTTP 403 and the message "eCourseFile sends only password reset emails.", so `signInWithOtp` makes no link, and `updateUser({ email })` changes nothing.
- If the email cannot be sent, the request fails with HTTP 500, so the user knows to try again.

On the local stack, Supabase Auth reaches the function at `http://host.docker.internal:54321/functions/v1/send-email`, and `[functions.send-email]` turns off the JWT check, since the hook sends no JWT. The hook's secret in `supabase/config.toml` serves the local stack and CI only. For a hosted project, set the hook to `https://<project-ref>.supabase.co/functions/v1/send-email` with a new secret under Authentication, Hooks, and set the same secret with `npx supabase secrets set SEND_EMAIL_HOOK_SECRET=...`.

### Mail adapters

`supabase/functions/_shared/mail.ts` defines the mail adapter, with one operation: send an email to a list of recipients, with a subject and an HTML body. The `send-email` and `audit-requests` functions send through it, and escape what users wrote with `escapeHtml` in `_shared/html.ts`. `MAIL_ADAPTER` picks the implementation.

- `graph` (`_shared/graph-mail.ts`) sends from the shared mailbox in `GRAPH_MAILBOX` with Graph `sendMail`, as the Entra app in the `GRAPH_*` secrets, with an app-only token. The storage adapter signs in the same way, through `_shared/graph.ts`. Graph keeps a copy in the mailbox's Sent Items. Exchange limits the app to that mailbox through RBAC for Applications. No automated test covers it.
- `fake` (`_shared/fake-mail.ts`) records each email in `fake_mail.outbox`, with its recipients, subject, HTML and time. Only the service role can use the `fake_mail` schema. Seam 1 tests read it with the secret key. To read the latest email on the local stack, such as a reset link:

  ```sh
  curl -s 'http://127.0.0.1:54321/rest/v1/outbox?select=recipients,subject,html&order=sent_at.desc&limit=1' \
    -H "apikey: $SUPABASE_SECRET_KEY" -H 'Accept-Profile: fake_mail'
  ```

  The fake refuses an email when any recipient is listed in `fake_mail.undeliverable`, as a failed send, and records nothing. Seam 1 tests list an address there to test what a mail failure does.

`supabase/config.toml` exposes the `fake_mail` schema to the API, so the schema comes from a migration, `supabase/migrations/20261120040000_fake_mail.sql`, and exists in every database. `supabase/migrations/20261120050200_fake_mail_undeliverable.sql` adds `fake_mail.undeliverable`.

## Tests

`npm test` runs two Vitest projects.

- `unit` runs the `src/**/*.test.ts` files. These test pure functions, such as the route rules in `src/auth.ts`. They include the seam 3 tests of the PDF engine in `src/pdf/`, which merge and compile PDFs that `src/pdf/fixtures.ts` generates and read the result with pdfjs-dist, the way a viewer shows it. The tests of the report exports in `src/report-export.test.ts` export each view the way the pages do, then read the .xlsx back with read-excel-file and the .csv with csv-parse. Their rows are `src/report-fixture.ts`, what the report RPCs returned for a semester that `scripts/capture-report-fixture.ts` seeded with names and titles that start with `=`, `+`, `-`, `@`, a tab or a carriage return, hold quotes, commas or a line break, or use letters outside ASCII. After a report RPC or its row type changes, run `node scripts/capture-report-fixture.ts` on a stack where `npm test` has run, which writes the fixture again. It takes a semester from the range of `emptyReportSemester`, and prints its lecturers, whose password is `report-fixture`, so the semester can be checked in the app too. `src/copy-rules.test.ts` fails when a source file's words use a phrase from `BANNED_PHRASES` in `src/copy-rules.ts`, such as "SharePoint", "the admin" or "appears here". Comments may use them. Add a phrase there when a review turns up a new kind of filler.
- `seam1` runs the `tests/**/*.test.ts` files against the local Supabase stack through supabase-js, including the Edge Functions. The upload tests use `src/uploads.ts`, as the app does, and read the fake storage library. The password reset and audit request tests read the fake outbox with `fakeOutbox` from `tests/harness.ts`. They upload real PDFs, because the browser refuses a PDF that the engine cannot read: `sizedPdf` in `src/pdf/fixtures.ts` makes one of any size, and `protectedPdf` in `tests/harness.ts` gives `tests/fixtures/permissions-password.pdf`, a PDF with only a permissions password, made with pypdf. Before the tests run, `tests/global-setup.ts` reads the stack's keys from `npx supabase status` and seeds one user for each global role, such as `lecturer@seam1.test`. Tests sign in with `signInAs(role)` from `tests/harness.ts`.

Tests that create users give each user a new email address. You can run the tests again without a database reset. Semester codes are limited, so `pickSemester` in `tests/harness.ts` returns an existing semester once its random code is taken. A test offering can share its semester with other tests' offerings.

An upload of a semester's calendar or letter changes sections 1 and 3 of every offering in the semester, and a report counts every offering of its semester. The semesters are therefore split by start year:

- `pickSemester` and `createOffering` use the 2,400 codes with start years 2000 to 2799.
- `emptyReportSemester` uses the 300 codes with start years 2800 to 2899, and returns one that has no offerings yet. Only `tests/reports.test.ts` uses it, and `scripts/capture-report-fixture.ts` takes one of these semesters the same way. Its tests upload the calendar and letter of their own semesters, so they assert exact numbers. A run fills three semesters, one of them with 1,001 offerings to check that the app reads past the API's 1,000 rows. Offerings are never deleted, so after about 100 runs the helper finds none left and asks for a database reset.
- `semesterWithoutSharedFiles` uses the 300 codes with start years 2900 to 2999. It deletes the calendar and letter that an earlier test or run left, through the `files` function as the admin. Of the other tests, only `tests/shared-files.test.ts` uploads calendars and letters, and its tests run one after another.

A timetable changes section 4 only of the offerings its lecturer teaches in the semester. The tests in `tests/lecturer-timetables.test.ts` upload timetables only for lecturers they create, so they take semesters from `pickSemester` and change no other test's offering.

A student timetable changes section 5 only of the offerings that tick its program code. The tests in `tests/student-timetables.test.ts` upload timetables only for program codes they create, so they also take semesters from `pickSemester`. They read the pick list only for their own codes, because other tests and runs leave student timetables in the same semesters.

The tests in `tests/verdicts.test.ts` and `tests/compile-manifest.test.ts` also upload timetables only for lecturers and program codes they create, in semesters from `pickSemester`. A manifest test therefore finds no calendar or letter in sections 1 and 3, and `tests/shared-files.test.ts` tests those.

The tests in `tests/audit-requests.test.ts` create their own auditors and lecturers, so each address's fake outbox holds only the test's emails. They take semesters from `pickSemester`, and upload timetables only for lecturers and program codes they create.

The tests in `tests/activity.test.ts` create their own lecturers, auditors and program codes, and take semesters from `pickSemester`. Calendars and letters are left to `tests/shared-files.test.ts`, which also checks that they show in the activity of each course file of their semester.

The tests in `tests/reuse.test.ts` offer a course they create in four different semesters from `pickSemester`, and order them by start year and number. The picker finds past offerings by course, so other tests' offerings in the same semesters never show in it.

Tests read back the rows they create by id, never a whole table. The API returns at most 1,000 rows, and tables such as `course_types` grow with every run.

## Troubleshooting

- If the stack cannot pull images from `public.ecr.aws`, pull them from Docker Hub instead.

  ```sh
  SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io npm run stack:start
  ```

- If calls to an Edge Function fail with HTTP 404, the edge runtime started before the function existed. If they fail with HTTP 500 and `name resolution failed`, the edge runtime container is not running. In both cases, restart the stack.
- If `npm run stack:start` fails with `supabase_rest_ecoursefile unexpected status 503`, the local database is older than the `fake_storage` or `fake_mail` migration, and PostgREST does not start without an exposed schema. Start from a new local database. This deletes the local data.

  ```sh
  npx supabase stop --no-backup
  npm run stack:start
  npm run seed
  ```
