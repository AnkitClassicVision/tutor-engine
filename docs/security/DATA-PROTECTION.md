# How family data is protected

| Data | Protection |
|---|---|
| Children's names, birthdays, parent notes, planner and class chats, lesson and coaching messages, answers and drafts, recaps, test titles and notes, weekly summaries, decision details | **Encrypted per family** before they reach the database: AES-256-GCM with a random 32-byte key for each family, with the family id bound as associated data. The family key is stored only wrapped by the deployment key. Reads decrypt in the database layer (`src/family-crypto.ts`), so a copy of the database alone reveals none of this text. Deleting a family deletes its key. |
| Parent passwords, child PINs | Salted scrypt (N=2^15, r=8, p=3), upgraded automatically after the next correct sign-in when the cost rises. A production deployment cannot lower the cost. |
| AI provider keys, ChatGPT tokens, child sign-in links, queued email | AES-256-GCM under the deployment key `TUTOR_ENCRYPTION_KEY`, which is held in the host's secret settings and never in the database. Each value names its key, so the key can be rotated (`scripts/rotate-encryption-key.ts`). |
| Sign-in sessions, email links, OAuth state, child links | Looked up only by SHA-256 hashes of random tokens, so a database copy cannot sign anyone in. |
| Photos and PDFs | Private storage (Vercel Blob with private access, or a private local folder). Every read checks the family. Location and camera metadata are stripped on upload. Files are deleted with the family through a durable erasure queue. |
| Backups | Every file is sealed with AES-256-GCM under a separate `TUTOR_BACKUP_KEY`. The deployment key is never copied into a backup. |
| Database connection | TLS with certificate verification (`sslmode=verify-full`). An optional data-only database role is available for requests and jobs (`scripts/create-app-role.ts`). |

## What is sent to AI providers

Nothing is sent until a parent connects their own provider. After that, the job at hand gets the question, the child's answer, homework photos or their text, the school level and sometimes the child's first name. Decision history sent to a provider is limited to learning events and their reasons. Birthdays, parent notes and stored settings are not sent.

## Accounts and abuse

- Sign-in and recovery attempts are throttled per account and per network source, and unknown emails take the same time to check as known ones.
- The parent area locks after 15 minutes when a child is at the device and needs the parent password again.
- Children's sessions can reach only learner pages.
- Every form is protected against cross-site request forgery. Cookies are `Secure`, `HttpOnly` and `SameSite` in public mode.
- Expired sessions, one-time links and old throttle counters are purged on a schedule.
- The family export leaves out hashes, tokens, storage paths and keys.

## Known limits

- Anyone holding **both** a database copy and the deployment key can read everything. Keep the key in the host's secret store and never next to backups.
- A sealed value carries the id of the family that owns it. Someone who can write to the database could copy one family's sealed value into another family's row, and it would display there. Reading the value still needs the deployment key.
- The AI provider a family connects receives the material listed above, under that provider's terms.
- Child-safety checks on AI output are keyword tripwires plus model instructions, not full content moderation.

Found a problem? See [SECURITY.md](../../SECURITY.md).
