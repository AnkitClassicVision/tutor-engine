# Self-hosting

Two setups are supported:

- **Vercel + Neon + Vercel Blob.** This is what the public demo runs on and what the cloud test suites cover.
- **A single server with Docker Compose and SQLite**, for a family or school that wants everything on one machine. The Compose files are included, but CI does not build them yet. Please report what you find.

Before you invite anyone else's family, read [OPERATING.md](OPERATING.md).

## Vercel + Neon + Blob

1. **Fork** this repository and import the fork into Vercel. Choose framework **Other**: `vercel.json` already sets the build (`npm run build:assets`), the function (`api/tutor.ts`), rewrites and the weekly-digest cron. Use Node 24.
2. **Database.** In the Vercel project, add **Neon** from Storage / Marketplace and connect it to Production. This sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct). Migrations in `src/migrations/` run automatically on the first request after each deploy.
3. **Private files.** Add a **Blob** store with **private** access. This sets `BLOB_READ_WRITE_TOKEN`.
4. **Email.** Parents need verification and password-recovery emails. Either add **Resend** (verify a sending domain, ideally a subdomain such as `mail.example.org`) or use any SMTP provider.
5. **Settings.** Set these for Production (all of them are explained in [.env.example](../.env.example)):

   | Variable | Value |
   |---|---|
   | `TUTOR_PUBLIC`, `TUTOR_SECURE`, `TUTOR_CLOUD` | `1` |
   | `TUTOR_STORAGE` | `blob` |
   | `TUTOR_ORIGIN` | your `https://` address, without a trailing slash |
   | `TUTOR_ENCRYPTION_KEY` | output of `openssl rand -base64 32`; **save a copy in a password manager** |
   | `CRON_SECRET` | any long random string |
   | `TUTOR_MAIL_PROVIDER`, `TUTOR_MAIL_FROM`, `RESEND_API_KEY` or `TUTOR_SMTP_URL` | your email setup |
   | `TUTOR_OPERATOR_NAME`, `TUTOR_CONTACT_EMAIL` | shown on `/privacy` and `/terms` |
   | `TUTOR_SOURCE_URL` | your fork's URL, if you changed the code |

   Public mode refuses to start if security, storage, encryption or email settings are missing.
6. **Deploy**, then open `/health`. Create a parent account, verify the email and add a child.
7. **AI.** There is nothing to register. Each family connects its own provider: OpenRouter uses OAuth with PKCE back to `TUTOR_ORIGIN`, and API keys are checked before saving. You never pay for families' AI use.

### Recommended hardening

- **Data-only database role.** By default the app connects as Neon's owner role. To run requests and jobs as a role that can read and write rows but not change the schema or create roles:

  ```bash
  vercel env pull .env.production.local --environment production
  VERCEL_SCOPE=<your-team> node --env-file=.env.production.local --experimental-strip-types scripts/create-app-role.ts
  ```

  The script creates the role with a random password and checks that schema changes are refused. It then stores `TUTOR_APP_DATABASE_URL` in Vercel without printing it. Redeploy afterwards. Migrations keep using the owner connection. Neon's integration still places owner credentials in the environment, so this limits ordinary request handling rather than removing owner access entirely.
- **Backups.** Set `TUTOR_BACKUP_KEY` (another `openssl rand -base64 32`, stored separately from the encryption key). Then, with requests paused:

  ```bash
  node --env-file=.env.production.local --experimental-strip-types scripts/cloud-backup.ts create /secure/place/backup-YYYY-MM-DD
  node --experimental-strip-types scripts/cloud-backup.ts verify /secure/place/backup-YYYY-MM-DD
  ```

  Every backup file is sealed. Restoring needs an empty, migrated database, the backup key and the original encryption key.
- **Rotating the encryption key.** Put the new key in `TUTOR_ENCRYPTION_KEY` and the old one in `TUTOR_ENCRYPTION_KEYS_PREVIOUS`, then deploy and run:

  ```bash
  node --env-file=.env.production.local --experimental-strip-types scripts/rotate-encryption-key.ts --cloud
  ```

  Run it until it reports nothing left on the old key, then remove `TUTOR_ENCRYPTION_KEYS_PREVIOUS`. Children's data is not re-encrypted: only the family keys that protect it are re-wrapped.

## One server: Docker Compose + SQLite

```bash
cp .env.production.example .env.production   # fill in TUTOR_ORIGIN, TUTOR_ENCRYPTION_KEY and email
TUTOR_DOMAIN=tutor.example.org docker compose up -d --build
```

This runs the web process, a background worker for AI jobs and PDFs, and Caddy for automatic HTTPS, with data on the `tutor-data` volume. Back it up with:

```bash
docker compose exec web node --experimental-strip-types scripts/backup.ts create /data/backups/YYYY-MM-DD
```

Copy backups off the machine, and keep `TUTOR_ENCRYPTION_KEY` somewhere other than the backup.

## Updating

Pull the upstream changes into your fork and redeploy. Migrations are additive and run automatically. Read the release notes for any step that needs you.
