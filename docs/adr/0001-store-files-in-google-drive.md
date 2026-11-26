# Store files in Google Drive

Accepted on 2026-11-26.

## Context

eCourseFile was built to store files in a SharePoint document library through Microsoft Graph. The `graph` storage adapter needed an Entra app with the `Sites.Selected` application permission and the `write` role on one site. Only a UTeM tenant admin can grant those, and UTeM IT never granted them. The adapter could not run in testing or in production.

## Decision

Store files in the My Drive of one Google account, for testing and for production. The `drive` storage adapter signs in as that account with a refresh token for the `drive.file` scope only, so it sees and changes only the folders and files it made. The `graph` adapter and the `GRAPH_*` secrets are gone. The local stack keeps the `fake` adapter.

## Consequences

- A personal Google account has 15 GB, and its Gmail and Google Photos use the same quota.
- The account owns every file. Use an account that outlives any one staff member, and keep its sign-in details with the faculty.
- Google stops the refresh token when it goes unused for six months, when the account removes the app's access, and when the account holds more than 100 refresh tokens for the client. While the app's publishing status is Testing, a token lasts 7 days. Storage fails until someone runs `npm run google:token` and sets the new `GOOGLE_REFRESH_TOKEN`.
- Drive has no download URL that works without an Authorization header. Every compiled PDF streams each of its files through the `drive-download` Edge Function, and those bytes count toward the Supabase project's egress.
- No automated test runs against real Drive. The seam 1 tests run the `fake` adapter, which takes chunks the way a Drive upload session does. The first upload, reuse, compile and delete on a hosted project are the first check against Drive.
