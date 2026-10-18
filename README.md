# Bubble · Tutor Engine

An open-source, adaptive tutor for children aged 5–14 and the parents beside them. It turns a child's real school life (classes, homework photos, test dates, teacher scores) into short practice missions, and it counts a skill as learned only when the child shows it on their own.

Families bring their own AI (OpenAI, Anthropic, xAI or OpenRouter). Practice missions work with no AI at all.

**Try it:** [kids-tutor-iota.vercel.app](https://kids-tutor-iota.vercel.app) is the public demo. It is early software, so read the [privacy notice](https://kids-tutor-iota.vercel.app/privacy) first.

> **Status: early release.** The learning engine, data protection and the app are tested end to end with synthetic families. The teaching has **not** yet been validated with real children at scale, and AI feedback can be wrong. A parent should stay involved. See [What is solid and what is early](#what-is-solid-and-what-is-early).

## How it teaches

The design comes from [the v1 spec](<Tutor Engine — The Shape (v1 spec).md>) and is built layer by layer (each layer has its own design note in [`docs/tdd/`](docs/tdd)):

1. **One concept graph.** Every request, whether a grade's program, a dated test or a curiosity, is a target on a graph of concepts and their prerequisites. The math backbone follows the Common Core standards ([`src/data/math-backbone.json`](src/data/math-backbone.json)).
2. **Learner model.** Each concept tracks mastery per Bloom level, a forgetting estimate, error patterns and hint use.
3. **Diagnose.** Each miss is classified (for example: a forgotten fact, a procedural slip, a misconception, a reading problem, or not carrying a skill to a new kind of question), and failing foundations are taught first.
4. **Select, "the just-right thermostat".** A mission mixes new work, review that is due and interleaved practice, and adjusts difficulty from recent results.
5. **Engage.** Each mission goes *together → guided → on your own → look back*. Help, hints and "show me how" never count as mastery.
6. **Assess.** Progress needs fresh, independent evidence: a new question, solved alone, at the right Bloom level.
7. **Reflect and report.** The child recaps the session. Parents see one screen: what happened, what was done alone, and what needs them.

**Where the AI is used:** reading homework photos, checking written answers against a rubric, explaining, and planning classes from a parent's conversation. The instructions it follows are plain Markdown in [`skills/`](skills). Every AI decision is recorded with its reason, and parents can undo the planner's changes. Practice items, scoring and mastery are computed by the engine, not the model.

## Features

- Short missions (3–25 minutes, capped by the parent) for ages 5–7, 8–10 and 11–14, with read-aloud, large touch targets and keyboard support.
- Six visual "worlds" the child picks from (Cartoon Club, 8-Bit Dreamland, Toy Box, Sticker Scrapbook, Princess Land and the calm Build Steps), with Bloop the star mascot.
- Homework and test photos → transcribed questions → guided help and targeted practice.
- Dated tests reprioritise practice until the test day, and teacher scores are recorded with their source.
- A parent planner (a conversation that proposes changes, applied only when the parent taps Apply), notes to the child, weekly email summaries, printable PDF sheets.
- Children sign in with a parent-made link and PIN, and the parent area locks when a child is at the device.
- Family export and full deletion.

## Privacy and security

Children's data is the point of this app, so it is protected by default:

- Children's names, birthdays, notes, chats and answers are **encrypted per family** (AES-256-GCM) before they reach the database. Each family's key is wrapped by a deployment key that never lives in the database, and deleting a family destroys its key.
- Passwords and PINs use scrypt. Sessions, email links and child links are stored only as hashes. AI keys are encrypted, and the deployment key can be rotated.
- Photo location and camera metadata are stripped on upload, and photos are stored privately with per-family access checks.
- There are no ads, analytics or tracking scripts.

Details: [docs/security/DATA-PROTECTION.md](docs/security/DATA-PROTECTION.md). Running it for other people? Read [docs/OPERATING.md](docs/OPERATING.md) first: you become responsible for the children's data you hold.

## Run it locally

Node 24 or later.

```bash
npm ci
npm start
# open http://127.0.0.1:8787
```

Local mode uses SQLite in `data/` and creates its own encryption key in `data/.credential-key` (back that up with the database). Connect an AI under **AI connection** once you have added a child, or skip it and use practice missions.

## Host it

The supported production setup is **Vercel + Neon Postgres + private Vercel Blob + an email provider (Resend or SMTP)**. A Docker/Compose setup with SQLite also exists for a single dedicated host. Step by step: [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md). Every setting is listed in [.env.example](.env.example).

## Develop

```bash
npm run typecheck
npm test                 # unit and integration tests (SQLite)
npx playwright install --with-deps
npm run test:browser     # ~150 browser tests across Chromium, Firefox, WebKit and a phone
```

`npm run test:cloud` runs the same flows against a real Postgres. Point `.env.vercel-production.local` at a **test** database first: it creates and drops its own schemas. Test output goes to the git-ignored `evidence/` folder.

Where things are:

| Path | What |
|---|---|
| `src/engine/` | The learning engine: graph, diagnosis, selection, mastery, scheduling |
| `skills/` | Instructions the AI follows for each job (grading, planning, coaching, reading homework) |
| `src/server.ts`, `src/journey-routes.ts` | HTTP routes (server-rendered HTML, no client framework) |
| `src/services.ts` | Sessions, answers, students, AI settings |
| `src/family-crypto.ts`, `src/secrets.ts` | Per-family encryption, credential encryption and key rotation |
| `public/` | CSS, small progressive-enhancement scripts, fonts and world art |
| `docs/tdd/` | Design note and acceptance criteria per engine layer |
| `eval/` | Synthetic review packs for checking AI grading quality |

Design system: [DESIGN.md](DESIGN.md). Product principles: [PRODUCT.md](PRODUCT.md). Shipped defaults and the reasons for them: [docs/DECISIONS.md](docs/DECISIONS.md).

## What is solid and what is early

**Solid:** accounts, child sign-in, data protection, durable jobs, photo handling, backups and restore, and the engine's rules, all with unit, integration and cross-browser tests.

**Early, where help is most welcome:**
- **Teaching quality with real children.** Do missions hold attention, and does mastery last a week later? We need classroom and parent feedback.
- **AI grading accuracy.** The [review pack](eval/review-pack/README.md) has 100 synthetic cases that are not yet human-approved.
- **Child safety of AI output.** Today it relies on keyword checks plus model instructions, not full moderation.
- **The built-in math curriculum is small** (32 concepts, grades 1–8). AI-built classes extend it for each family, but a fuller open curriculum would help everyone.
- **Subjects beyond math.** Reading and science work through photos and planning, but have no built-in curriculum yet.
- **Translations.**

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[GNU AGPL-3.0](LICENSE). You can use, change and host this freely. If you run a modified version for other people over a network, you must offer them your source code (the footer's "Source code" link does this; set `TUTOR_SOURCE_URL` to your fork). Third-party notices, including the Common Core attribution and font licenses, are in [NOTICE](NOTICE).
