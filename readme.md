# pastebin-backend

This repository is the small Express-based backend that powers the `pastebin-UI` frontend. It is intentionally compact: Supabase is used for object storage and as the primary database, and Express routes map directly to purpose-built controllers.

This README documents the architecture, runtime configuration, and the API surface in a pragmatic, developer-friendly way — the kind of notes I'd leave for another engineer taking over maintenance.

Contents

- Purpose and high-level overview
- Tech & dependencies
- Quick start
- Environment variables
- Application architecture (files & responsibilities)
- Data model and storage
- API reference (endpoints + examples)
- Error handling, logging, and operational notes
- Deployment & tips

--

## Purpose

This service manages uploads (called "pastes"), stores file blobs in a Supabase storage bucket, and stores paste metadata in a Supabase table. It implements simple protections: password-protection, expiry, view and download limits, and deletion.

## Tech & dependencies

- Node.js (ES modules)
- Express
- Supabase JS client (`@supabase/supabase-js`) — storage + Postgres access
- Multer — single-file uploads (in-memory)
- Bcrypt — password hashing for protected pastes
- pg — (there is a small `db.js` wrapper if you want to use Postgres directly)

## Quick start

1. Copy `.env.example` to `.env` and fill values (see below).
2. Install dependencies:

```bash
npm install
```

3. Run in development:

```bash
npm run dev
```

4. Production start:

```bash
npm start
```

## Environment variables

The app loads configuration from environment variables. Minimal set used by the code:

- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_ANON_KEY` — anon/public key used by the server to talk to Supabase (current code uses anon key; consider a service role key for privileged actions)
- `DATABASE_URL` — (optional) Postgres connection string used by `src/db.js` if needed
- `BACKEND_BASE_URL` — used to build download links returned to clients (e.g. `https://api.example.com`)
- `PUBLIC_BASE_URL` — used to build view links returned to clients (e.g. `https://app.example.com`)
- `PORT` — server port (defaults to `5000`)

You already have a `.env` with `SUPABASE_URL` and `SUPABASE_ANON_KEY`. If you deploy, set the other values as appropriate.

## Application architecture

Top-level files to know

- `src/server.js` — loads env and starts the Express listener.
- `src/app.js` — configures middleware, routes, and error handling.
- `src/config/supabase.js` — Supabase client initialization (reads `SUPABASE_URL` and `SUPABASE_ANON_KEY`).
- `src/db.js` — lightweight `pg` `Pool` setup (for any raw-postgres usage; currently unused for main flows).

Routing and controllers

- Routes register under `/api/users` and `/api/pastes` in `src/app.js`.
- `src/routes/user.routes.js` — registration endpoint (`POST /api/users`).
- `src/routes/paste.routes.js` — paste-related endpoints. The router uses `multer` with memory storage and a 10MB single-file limit.
- Controller implementations live in `src/controllers/*.js`:
  - `user.controller.js` — user registration backed by `services/user.service.js`.
  - `paste.controller.js` — all paste operations (create, read, preview, download, delete, list user pastes).

Middlewares

- `src/middlewares/logger.middleware.js` — simple request logger that prints request timing and response code.
- `src/middlewares/error.middleware.js` — centralized error handler that returns a 500 with a generic message and logs the error to stdout/stderr.

Service layer

- `src/services/user.service.js` — thin service that ensures a user row exists in the `users` table.

## Data model & storage

There are two primary persistence locations:

- Supabase Storage bucket named `pastes` — holds the binary blobs.
- Supabase Postgres table named `pastes` — holds metadata with these columns:
  - `slug` (string) — short random id used in URLs
  - `user_id` (string)
  - `filename` (string)
  - `mimetype` (string)
  - `storage_path` (string) — path inside the Supabase storage bucket
  - `password_hash` (string | null)
  - `expires_at` (timestamp | null)
  - `max_views` (integer | null)
  - `max_downloads` (integer | null)
  - `view_count` (integer)
  - `download_count` (integer)
  - `created_at` (timestamp)

The `users` table expects at least: `user_id`, `email`, `nickname` (inserted by `user.service`).

Behavior notes

- Passwords: If `password` is provided in the upload request body it is hashed with `bcrypt` and `password_hash` is stored. Passwords are validated at access time.
- Expiry: `expires_at` is computed from `expires_in` (minutes) during upload. Expired pastes return `410`.
- Limits: `max_views` and `max_downloads` are enforced and return `403` when exceeded. Views and downloads increment counters on access.

## API Reference

Base path: `/api`

All responses are JSON except where file content is returned (binary) in `getPaste` and `downloadPaste`.

1. POST /api/users

- Purpose: Register a user if they don't exist. The frontend should call this to ensure a `user_id` is known to the backend.
- Body (application/json):

```json
{
  "user_id": "string", // your user id
  "email": "user@example.com",
  "nickname": "short-name"
}
```

- Responses:
  - `201` — { message: "User created successfully" }
  - `200` — { message: "User already exists" }
  - `400` — missing fields

2. POST /api/pastes

- Purpose: Upload a new paste (file). Uses `multipart/form-data` with a single `file` field.
- Form fields:
  - `file` — binary file (required)
  - `user_id` — string (required)
  - `expires_in` — number of minutes until expiry (required)
  - `password` — optional password (string)
  - `max_views` — optional integer
  - `max_downloads` — optional integer

- Multer configuration: memory storage, 10MB limit.

- Example success response (201):

```json
{
  "url": "https://api.example.com/api/pastes/abc12345",
  "protected": true
}
```

- Common errors:
  - `400` — missing `user_id`, `file`, or `expires_in` or invalid `expires_in` value.

3. GET /api/pastes/:slug

- Purpose: Serve the paste inline (sets `Content-Type` and `Content-Disposition: inline`).
- Query params:
  - `password` — when the paste is password-protected, the client must supply this.

- Responses:
  - `200` — binary content of the paste (Content-Type = stored mimetype).
  - `401` — password required for protected paste (body: { message: "Password required", protected: true })
  - `403` — invalid password or view limit reached
  - `404` — not found
  - `410` — expired

Implementation notes: view_count increments on successful access.

4. GET /api/pastes/:slug/download

- Purpose: Force a download of the paste (Content-Disposition: attachment).
- Behavior: checks expiry and `max_downloads`, increments `download_count`.

Responses: `200` binary or `403/404/410` as appropriate.

5. GET /api/pastes/:slug/preview

- Purpose: Return metadata plus the file as a base64 payload for quick previews (no counters incremented).
- Response (example):

```json
{
  "metadata": {
    /* slug, filename, mimetype, dates, counters, protected flag */
  },
  "file": "<base64 string>",
  "mimetype": "text/plain"
}
```

6. GET /api/pastes/user/:userId

- Purpose: List all pastes for a user. Returns an array of paste metadata objects (slug, filename, created_at, expires_at, urls, counters, expired flag).

7. DELETE /api/pastes/:slug

- Purpose: Delete a paste. The controller deletes the object from the Supabase storage bucket (`pastes`) and then deletes the metadata row from the DB.
- Responses:
  - `200` — { message: "File deleted successfully" }
  - `404` — paste not found
  - `500` — storage or DB delete failure

## Design Decisions

- User has to create an account for uploding / sharing files.
- A file once uploaded can only be deleted by the user who uploaded it.
- File can only be viewed by another user if the file is active / if the view count < max_view count.
- For file naming convention, text is saved as paste.txt in DB, while the pdf files have their original name.

## Limitations

- All the routes are public (major security flaw).
- Only pdf files can be uploaded right now. Support can be extended for word, excel etc.
- S3 bucket of supabase and Database is kept public to avoid authentication issues. It should be handled for better security.

## Operational notes & behavior details

- Storage: files are uploaded to the Supabase storage bucket named `pastes` at path `uploads/{slug}-{originalname}`.
- Security: the app currently uses the `SUPABASE_ANON_KEY` environment variable; for administrative operations consider using a Supabase service role key with more restricted usage and rotate it securely.
- Limits: `multer` enforces a 10MB per-file limit. Increase in `src/routes/paste.routes.js` if you need larger files.

## Error handling & logging

- The application logs each request with timing and status to stdout via `requestLogger`.
- Uncaught exceptions in routes are forwarded to `error.middleware.js`, which logs the error and returns a 500 response. For production, replace `console.error` with a structured logger and add error-reporting integration (Sentry, Logflare, etc.).

## Deployment & scaling

- This service is stateless: file blobs live in Supabase storage, metadata in Supabase Postgres. Horizontal scaling is straightforward.
- For production, running behind a reverse proxy (NGINX) or on a platform like Fly/Vercel/Heroku that supports Node services can be done. Appropriate environment variables are to be set in deployment environment, and appropriate TLS.

## Next steps

- Using a Supabase service role key for server-to-Supabase operations that require elevated privileges and keep it out of client bundles.
- Adding authentication (like access tokens) or signed upload URLs to avoid anonymous uploads for stronger user restrictions.
- Moving URL-building logic into a helper/service so the controllers only return IDs.
- Adding request validation (Joi/Zod) to centralize and simplify input checks.
- Adding unit/integration tests for controllers and middleware.
- Adding cache (like redis) for high frequency APIs like `/api/pastes/:slug/preview`.
