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

## Seeding root again

You can run `npm run seed` more than once. The seed script sets root's password and the must-change-password flag only while root has never signed in. After root signs in, a new run only adds the `root` role back if it is missing. A new run never overwrites a password that root chose.

## Users and roles

A user can hold several global roles. The rules for who may change what are SQL functions in `supabase/migrations/20261119020000_role_management.sql`. RLS policies, the `accounts` Edge Function and the app all use these functions.

| Who | May do |
| --- | --- |
| Root | Read every user. Grant and revoke `admin`. Create users whose only role is `admin`. Nothing else. |
| Admin | Read every user. Grant and revoke `lecturer`, `auditor`, `hod`, `dean` and `deputy_dean`. Create staff users, set their department, reset their password, and deactivate or reactivate them. Add, edit and delete departments. Add and edit the catalog. Add semesters, offer courses and assign their lecturers. |
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
| `offerings` | One catalog course in one semester, at most once per semester. `coordinator_id` is the coordinator. `sections_on` is a copy of the course type's `sections_on`, taken when the offering is created. Later edits to the type, or a new type for the course, leave the offering as it was. |
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

The **Course files** page lists the offerings the user reads, grouped by semester, newest first. Each opens a course file page with the 19 sections in their fixed order. The section list is the `SECTIONS` constant in `src/sections.ts`. The page reads each section's status from the `section_statuses(offering_id)` RPC:

| Status | Sections |
| --- | --- |
| `missing` | Every section that is on, except sections 7 to 9 |
| `empty` | Sections 7 to 9, which may stay empty and never count as missing |
| `off` | Sections 10 to 16 that the offering has off |

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

The function imports nothing. It calls the Supabase Auth and PostgREST endpoints with `fetch`. In the local edge runtime container, a remote import such as `npm:@supabase/supabase-js` fails at boot when the container cannot verify TLS through a proxy. A function without imports does not depend on that.

## Tests

`npm test` runs two Vitest projects.

- `unit` runs the `src/**/*.test.ts` files. These test pure functions, such as the route rules in `src/auth.ts`.
- `seam1` runs the `tests/**/*.test.ts` files against the local Supabase stack through supabase-js, including the `accounts` Edge Function. Before the tests run, `tests/global-setup.ts` reads the stack's keys from `npx supabase status` and seeds one user for each global role, such as `lecturer@seam1.test`. Tests sign in with `signInAs(role)` from `tests/harness.ts`.

Tests that create users give each user a new email address. You can run the tests again without a database reset.

## Troubleshooting

- If the stack cannot pull images from `public.ecr.aws`, pull them from Docker Hub instead.

  ```sh
  SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io npm run stack:start
  ```

- If calls to the `accounts` function fail with HTTP 404, the edge runtime started before the function existed. If they fail with HTTP 500 and `name resolution failed`, the edge runtime container is not running. In both cases, restart the stack.
