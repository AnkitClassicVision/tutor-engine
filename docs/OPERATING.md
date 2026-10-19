# Running it for other families

If you host this for anyone outside your own household, you hold children's personal data and you are responsible for it. This page lists what the software already does for you and what remains your job. It is not legal advice. Laws differ by country (for example COPPA in the US, GDPR and the UK Children's Code in Europe and the UK, and student-privacy laws if a school is involved). Check what applies to you.

## What the software does

- **Only parents create accounts.** Children never sign up, give an email address or set a password. They use a link and PIN their parent makes.
- **Consent at sign-up.** The sign-up form says the person creating the account is the child's parent or guardian and agrees to the privacy notice and terms.
- **Notice.** `/privacy` and `/terms` describe the software's actual behaviour and name you (`TUTOR_OPERATOR_NAME`, `TUTOR_CONTACT_EMAIL`). If you change what is collected or where it goes, change these pages too (`src/legal.ts`).
- **Minimal data.** It holds a name the parent chooses (a nickname works), an optional birthday, school level, classes, answers, notes, schoolwork photos and learning history. Photo location and camera metadata are stripped on upload.
- **Protection.** Children's text is encrypted per family, credentials are encrypted, passwords are hashed, and files are private. See [security/DATA-PROTECTION.md](security/DATA-PROTECTION.md).
- **Parent control.** Parents can export everything, correct it, or delete the whole family. Deletion removes records and files and destroys the family's key.
- **AI is the parent's choice.** Nothing is sent to an AI provider until a parent connects one with their own account. The privacy notice tells parents what is sent.
- **No advertising, analytics or tracking.** Don't add them. Behavioural advertising to children is unlawful in many places, and it goes against the point of this project.

## What remains your job

1. **Keep the keys safe.** Store `TUTOR_ENCRYPTION_KEY` and `TUTOR_BACKUP_KEY` in a password manager, apart from each other and from backups. Losing the encryption key makes families' data unreadable. Leaking it, together with a database copy, exposes the data.
2. **Rehearse a restore.** Backups only count once you have restored one. `scripts/restore-rehearsal.ts all <private folder>` backs up the live store, restores it into a throwaway schema with fresh file copies, compares every table and file, then removes the copy. It prints counts and timings only. It needs the deployment key, which most hosts will not show you again, so keep your own copy (step 1). Run it after each schema change and at least every quarter.
3. **Get told when something breaks.** Set `TUTOR_ALERT_EMAIL`. Every 15 minutes `/cron/ops-check` looks for an unreachable database, a database behind the code's migrations, stuck or repeatedly failing jobs, and email that is not sending. It emails you once when a problem starts, daily while it lasts, and once when it clears, with counts only. `/cron/ops-check?test=1` (with the cron secret) sends a test alert. It cannot tell you the site itself is down, so also check `/health` from somewhere else; `.github/workflows/uptime.yml` does that for the upstream demo.
4. **Answer requests.** Reply to the contact address you publish. Export and deletion are self-serve, but people will still ask.
5. **Handle breaches.** If you suspect unauthorised access, rotate the keys and database credentials (see [SELF-HOSTING.md](SELF-HOSTING.md)), and inform affected parents and any authority your law requires, within its deadline.
6. **Keep it updated.** Watch this repository's security advisories and redeploy when fixes land.
7. **Retention.** Families decide how long their data stays. If you shut down, tell families first so they can export, then delete the database, Blob store and backups.
8. **Schools are different.** A school using this on behalf of pupils usually needs a written agreement (for example a data processing agreement, or a FERPA-aligned contract in the US) and its own review. The software helps with that, but it doesn't replace it.
9. **Your providers.** Your hosting, database, file storage and email providers process data for you. Use their data processing terms, and pick regions that fit your families.
