# TDD 1 — Learner model, storage, and login

## Job

One persistent state per student. A parent account owns those students. Another parent cannot read them.

## Implementation criteria

- Email and password register and sign in. Passwords are scrypt hashes. Sessions are random tokens stored as sha256.
- Forms require the csrf token from the signed-in session, or from the anonymous cookie before sign-in.
- The server listens on 127.0.0.1 unless `TUTOR_HOST` is set.
- Each concept row stores bloom level, mastery, stability days, next due, error signatures, hints in the last 10, modality, and status.
- Concepts two or more grades below the student start mastered at Understand.
- A miss on that seeded mastery moves the row to review and keeps mastery at or above 0.4.

## Test criteria

- `parent accounts are isolated, hashed, and required` checks the redirect, a forged post, the hash prefix, a second parent's 404, and the seeded concept count.
- `seeded mastery survives a later miss as review, not as zero`

## Out of scope

Student passwords. Camera recognition. Cloud accounts.
