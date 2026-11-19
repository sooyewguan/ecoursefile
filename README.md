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
| Admin | Read every user. Grant and revoke `lecturer`, `auditor`, `hod`, `dean` and `deputy_dean`. Create staff users, set their department, reset their password, and deactivate or reactivate them. Add, edit and delete departments. Add and edit the catalog. |
| Everyone else | Read their own profile and roles, read departments, and read the catalog. |

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
