# QA round 3: prompt 6 output

Prompt: [AGENT-PROMPTS.md](AGENT-PROMPTS.md) §6, independent QA and evidence judge. Process step: UX-10. The reviewer is an AI reviewer that did not write the work and could not edit it. Scope: round 3 on private main, 2026-10-19 (WF-01 AI connection states, WF-07 stale suggestions, WF-09 shared-device safety, and the coverage work). **Code, unit, cloud and browser evidence only; no child usability or learning claims.**

## Passes

| Pass | Commit reviewed | Decision | Main findings |
|---|---|---|---|
| 1 | 536c706 | REVISE | **High:** a ChatGPT 401 (normally fixed by refreshing the token) was recorded as "revoked", which locked out grading and practice until a parent acted. **Medium:** an OpenRouter moderation 403 was treated as revoked; model wording on any status, 5xx included, was treated as "model". **Low:** a plain ChatGPT 429 was treated as used up; state writes ran outside a database scope; the used-up wording promised an automatic retry; the hosted spec title over-claimed; no browser test covered a WF-01 state; the mission page showed only a generic line. |
| 2 | 6f6b390 | **LIMITED PILOT**, once the five-project browser run passes | All findings fixed. New lows: no test of the mission-page line; the job message for a plain ChatGPT 429 still said "usage limit". Both were fixed afterwards in 5d74452. |

## Evidence

| Check | Result |
|---|---|
| Unit suite | 367 pass, 0 fail (2 cloud tests skipped without credentials), plus the mission-page test in 5d74452 |
| Cloud tests on an isolated Postgres schema, migrations through 023 | 3 / 3 (run by the author; the reviewer could not read the credentials) |
| Revoked-state browser spec | 5 / 5 projects (chromium, firefox, webkit, mobile-chromium, tablet) |
| Full browser suite on 536c706 | 226 passed, 1 skipped (desktop Safari keyboard: Safari tabs only to form fields by default) |
| Full browser suite on 6f6b390 (five projects) | 231 passed, 1 skipped (23.1 min) |
| Hosted specs against the live site | adaptive and parent-access pass; zero synthetic families remain |

## Accepted limits

- **Stale suggestions:** only a later planner change or undo makes a suggestion stale. A direct Controls edit does not.
- **Drafts on lock:** locking to student mode does not clear drafts. Drafts belong to one learner's own session or question page.
- **Keyboard on desktop Safari:** untested by default.
- **Simultaneous confirmation on Postgres:** tested on SQLite only.

## Release judge decision

**LIMITED PILOT** for WF-01, WF-07, WF-09 and the coverage work, within our own family, the five-project browser run passed (231 passed, 1 skipped); release needs the owner's yes.

**Prohibited inferences:** child usability, any learning effect, and concurrency safety on Postgres.

**Re-check if:** the error classification, the ChatGPT error kinds, the settings writes, or the planner's stale rule changes.
