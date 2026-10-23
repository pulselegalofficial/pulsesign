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
npm run db:migrate:local   # creates the local D1 database
npm run dev                # http://localhost:4321
```

Without `RESEND_API_KEY`, emails are not sent: they are printed in the dev
server's log (`npx astro dev logs`), including sign-in links and one-time
codes, so the whole flow works offline. Sign in with any address allowed by
`STAFF_EMAILS` in `wrangler.toml` (default: anything `@pulselegal.co`).

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

1. **Sign in** with a one-time link sent by email (`/login`). The emailed link
   opens a confirmation page that signs in with a POST, so mail scanners that
   open links cannot use up the link. Sessions last 14 days. Removing someone
   from `STAFF_EMAILS` revokes their sessions at once.
2. **New document** (`/new`) is a four-step wizard: upload → signers → place
   fields → review & send. Drafts save automatically.
3. **Dashboard** (`/`) lists every document in the firm with status filters
   and search. Everyone in `STAFF_EMAILS` sees all documents.
4. **Detail** (`/docs/:id`) shows the audit trail, signer progress and hashes,
   with remind, cancel and download.

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

### Completion and evidence

When the last signer signs, the Worker stamps every field onto the original
PDF, appends a **certificate of completion** (document facts, SHA-256 of the
original, each signer's signature, time, OTP verification, IP and device, and
the full audit trail), stores the result in R2 and emails it to every signer
and the sender.

The SHA-256 of that final file is recorded and can be checked at `/verify`,
which is public. The hash is computed in the browser; the file is never
uploaded.

Every state change writes an event in the same place it happens
(`src/lib/docs.ts`), so the audit trail cannot drift from what happened.
Events are never edited or deleted.

### Security notes

- Only SHA-256 hashes of sign-in tokens, sessions, signing links and OTPs are
  stored. A database copy cannot be used to sign in or sign.
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
src/scripts/         Browser code: wizard, signer flow, PDF rendering (pdf.js)
src/test/            Unit tests
```

## Cloudflare setup (one time)

Requires **Workers Paid** ($5/month): stamping a PDF needs far more CPU time
than the Free plan's 10 ms per request.

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

4. On the Worker → **Settings → Variables and Secrets**, add
   `RESEND_API_KEY` as a **Secret**. Check `APP_URL`, `STAFF_EMAILS` and
   `EMAIL_FROM` in `wrangler.toml`.
5. Add the custom domain (`sign.pulselegal.co`) under **Settings → Domains &
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
- **No Google sign-in** for staff yet (the design shows one); sign-in is by
  email link only.
- **No retention policy.** Originals, signature images and signed PDFs are
  kept in R2 indefinitely; there is no delete for sent documents.
- **Data location.** D1 and R2 do not offer storage in Thailand. The PDPA
  notice signers see says data is encrypted at rest on Cloudflare; review it
  against the firm's cross-border transfer position.
- **Rotated pages** are handled; PDFs with form fields or existing digital
  signatures are stamped as ordinary pages (existing signatures become invalid).
