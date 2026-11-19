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

2. Start the local Supabase stack. The first start applies the migrations in `supabase/migrations/`.

   ```sh
   npx supabase start
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

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Starts the Vite dev server on port 5173. Supabase auth redirects expect this port. |
| `npm run build` | Type-checks the project and builds the static site into `dist/`. `firebase.json` serves `dist/`. |
| `npm run preview` | Serves the built `dist/` locally. |
| `npm test` | Runs all tests. The local Supabase stack must be running. |
| `npm run seed` | Runs `scripts/seed-root.ts` with the variables in `.env`. |
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

## Tests

`npm test` runs two Vitest projects.

- `unit` runs the `src/**/*.test.ts` files. These test pure functions, such as the route rules in `src/auth.ts`.
- `seam1` runs the `tests/**/*.test.ts` files against the local Supabase stack through supabase-js. Before the tests run, `tests/global-setup.ts` reads the stack's keys from `npx supabase status` and seeds one user for each global role, such as `lecturer@seam1.test`. Tests sign in with `signInAs(role)` from `tests/harness.ts`.

Tests that create users give each user a new email address. You can run the tests again without a database reset.

## Troubleshooting

- If `npx supabase start` cannot pull images from `public.ecr.aws`, set `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io` to pull from Docker Hub. To skip services that the app does not use yet, add `-x studio,imgproxy,storage-api,realtime,logflare,vector,edge-runtime,supavisor,mailpit,postgres-meta`.
