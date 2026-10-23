# Pulse Sign

Electronic signatures for Pulse Legal. Lawyers upload a PDF, place signature
fields for each signer and send it out; signers verify their email with a
one-time code, consent, sign on any device, and everyone receives the signed
PDF with a certificate of completion appended. Thai and English throughout.

Runs on **Cloudflare Workers**: Astro server-rendered pages, **D1** for
documents and the audit trail, **R2** for the PDFs and signature images,
**Resend** for email.

## Quick start

```bash
npm install
cp .dev.vars.example .dev.vars   # first time only
npm run db:migrate:local         # creates the local D1 database
node scripts/fake-google.mjs &   # stand-in for Google sign-in, port 4400
npm run dev                      # http://localhost:4321
```

Locally, "Continue with Google" goes to `scripts/fake-google.mjs`, which asks
which email to sign in as; `STAFF_EMAILS` in `wrangler.toml` still decides
who gets in. Without `RESEND_API_KEY`, emails are not sent: they are printed
in the dev server's log (`npx astro dev logs`), including one-time codes, so
the whole flow works offline.

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server with local D1 and R2 |
| `npm run check` | TypeScript + Astro type checking |
| `npm test` | Unit tests |
| `npm run build` | Production build into `dist/` |
| `npm run db:migrate:remote` | Apply migrations to the production database |
| `npm run deploy` | Build, migrate production, deploy |

CI runs check, tests and build on every push and pull request.

## How it works

### Staff

1. **Sign in with Google** (`/login`), OpenID Connect code flow with PKCE and
   a state cookie (`src/lib/google.ts`). The email must be verified by Google
   and allowed by `STAFF_EMAILS`; any other account is turned away. Sessions
   last 14 days. Removing someone from `STAFF_EMAILS` revokes their sessions
   at once. There is no other way to sign in.
2. **New document** (`/new`) is a four-step wizard: upload → signers → place
   fields → review & send. Drafts save automatically.
3. **Dashboard** (`/`) lists every document in the firm with status filters
   and search. Everyone in `STAFF_EMAILS` sees all documents.
4. **Detail** (`/docs/:id`) shows the audit trail, signer progress and hashes,
   with remind, cancel, download and delete.
5. **Delete** removes a document in any status, permanently: every R2 object
   under `docs/<id>/` (original, signature images, signed PDF) and every D1
   row (signers, fields, audit trail). Anything but a draft must be confirmed
   by typing the document number. Signing and download links are revoked
   first, so a delete that fails half-way can simply be retried. Copies
   already emailed stay with the recipients and in Resend's logs.

### Signers

1. The email links to `/s/:token`, a link unique to that signer.
2. **Start** emails a 6-digit code (10 minutes, 5 attempts). The document
   itself is only served after a correct code.
3. **Consent** to electronic signature and the PDPA notice.
4. **Sign**: draw, type or upload a signature; initials likewise. Name and
   date fields are filled by the server from the signer record and the
   server clock, so they cannot be edited or back-dated.
5. Signers can **decline** with a reason; the request stops and the sender is
   emailed.

With signing order on, the next signer is emailed when the previous one
signs. Off, everyone is emailed at once.

Each signer has a language (TH/EN, chosen per signer in the wizard). Their
emails (request, code, completion) use it, and their signing page opens in it
unless they switch with the toggle. A subject or message the sender typed is
sent as written; the wizard's default subject and message are sent in each
signer's language instead. Date fields are written in the signer's language.

### Completion and evidence

When the last signer signs, the document is marked completed. Then every field
is stamped onto the original PDF and a **certificate of completion** is
appended (document facts, SHA-256 of the original, each signer's signature,
time, OTP verification, IP and device, and the full audit trail). The
certificate is always in English; names and the title stay as entered. The result
is stored in R2 and every signer and the sender get an email with it attached
(Resend fetches the attachment from a 30-day download link).

Where the stamping happens depends on `PDF_MODE`; see below.

The SHA-256 of that final file is recorded and can be checked at `/verify`,
which is public. The hash is computed in the browser; the file is never
uploaded.

Every state change writes an event in the same place it happens
(`src/lib/docs.ts`), so the audit trail cannot drift from what happened.
Events are never edited or deleted.

### Security notes

- Only SHA-256 hashes of sessions, signing links and OTPs are stored. A
  database copy cannot be used to sign in or sign. (The `login_tokens` table
  is left over from email-link sign-in and is no longer used.)
- A reminder issues a new signing link; the old one stops working. Cancel,
  decline and expiry revoke all links.
- State-changing requests from another origin are rejected (CSRF), cookies are
  HttpOnly + SameSite=Lax, and the CSP allows only this origin plus Google
  Fonts.
- Signature submissions are one D1 transaction conditioned on the signer and
  document still being open, so double submits and races are no-ops.

## Code layout

```
migrations/          D1 schema
src/lib/             Logic, no framework code
  docs.ts              Document lifecycle and audit events (start here)
  pdf.ts               Stamping and the certificate (pdf-lib)
  geometry.ts          Field coordinates → PDF space, incl. rotated pages
  auth.ts              Staff sign-in links and sessions
  signer-session.ts    Signer browser session after OTP
  mailers.ts, email.ts Email content and sending (Resend)
  i18n.ts              Every UI string, Thai and English
  format.ts            Dates (Bangkok time, Buddhist era), user agents
src/pages/           Pages and API routes
src/scripts/         Browser code: wizard, signer flow, PDF rendering (pdf.js),
                     pdfwork.ts: upload checks and final PDF in browser mode
src/test/            Unit tests
```

## Free plan vs Workers Paid (`PDF_MODE`)

Cloudflare's Free plan allows **10 ms of CPU per request**. Reading a PDF takes
a few ms; building the final signed PDF takes 150–500 ms. So `PDF_MODE` in
`wrangler.toml` decides where PDF work runs:

| | `browser` (default, Free plan) | `server` (Workers Paid, $5/month) |
|---|---|---|
| Upload check (page count, encryption) | Staff browser | Worker |
| SHA-256 of uploads | Staff browser, verified by R2 on store | Worker |
| Final signed PDF + certificate | Staff browser | Worker, right after the last signature |
| When copies are emailed | When a staff member next opens Pulse Sign (dashboard or the document) | Immediately |

In browser mode, when the last signer signs, the sender gets an "all signed"
email linking to the document. Opening it (or the dashboard) builds the PDF in
the browser with the same code the Worker would use (`src/lib/pdf.ts`),
uploads it, and the server stores it and emails everyone. R2 checks the
uploaded bytes against the hash the browser sent, and only the first upload
for a document is accepted.

The trade-off: in browser mode the final file is produced on a firm computer
rather than the server, and copies go out only once someone at the firm opens
the app. The original's hash, the signature images, the audit trail and the
timestamps are recorded on the server either way.

**To switch to server mode:** upgrade to Workers Paid, set
`PDF_MODE = "server"` in `wrangler.toml`, and redeploy. Nothing else changes.
The Worker never loads pdf-lib in browser mode.

## Cloudflare setup (one time)

1. Create the database, bucket and (unused, required by the Astro adapter) KV
   namespace, and put the two IDs into `wrangler.toml`:
   ```bash
   npx wrangler d1 create pulsesign
   npx wrangler r2 bucket create pulsesign-files
   npx wrangler kv namespace create pulsesign-session
   npm run db:migrate:remote
   ```
2. **Resend**: create an account, verify the sending domain
   (`pulselegal.co`: add the DNS records Resend shows), and create an API key.
3. Create the Worker from this repo (**Workers & Pages → Create → Import a
   repository**):

   | Setting | Value |
   |---|---|
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` |

4. **Google sign-in**: in Google Cloud Console create a project, set up the
   OAuth consent screen (External; while in *Testing*, add every staff Google
   account as a test user), then create an OAuth client of type *Web
   application* with the redirect URI
   `https://sign.pulselegal.co/api/auth/google/callback`.
5. On the Worker → **Settings → Variables and Secrets**, add as **Secrets**:
   `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Check
   `APP_URL`, `STAFF_EMAILS` and `EMAIL_FROM` in `wrangler.toml`.
6. Add the custom domain (`sign.pulselegal.co`) under **Settings → Domains &
   Routes**.

Migrations do not run on a Git-triggered deploy. After a change in
`migrations/`, run `npm run db:migrate:remote` before merging.

## Editing copy

All UI, email and certificate text is in `src/lib/i18n.ts`. The Thai
dictionary is typed against the English one, so a missing key fails the build;
a test checks both languages use the same `{placeholders}`.

## Known gaps

- **No cryptographic PDF signature (PAdES).** Integrity rests on the recorded
  SHA-256 and `/verify`, not on a certificate embedded in the PDF that Adobe
  Reader would validate on its own.
- **Email OTP is the only identity check.** No SMS, ThaiD or ID document check.
- **Google is the only way in.** If the firm's Google account is locked or
  lost, nobody can sign in until it is recovered (documents are not
  affected). A second allowed account in `STAFF_EMAILS` is a cheap fallback.
- **No automatic retention policy.** Documents stay until someone deletes
  them; nothing expires on its own.
- **Free plan headroom.** In browser mode every request should stay under
  10 ms of CPU, but very large dashboards were not measured on Cloudflare
  itself. Check **Workers → pulsesign → Metrics → CPU time** after launch.
- **Data location.** D1 and R2 do not offer storage in Thailand. The PDPA
  notice signers see says data is encrypted at rest on Cloudflare; review it
  against the firm's cross-border transfer position.
- **Rotated pages** are handled; PDFs with form fields or existing digital
  signatures are stamped as ordinary pages (existing signatures become invalid).
