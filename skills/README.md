# Runbooks

Every AI step in Tutor Engine runs from a runbook: plain instructions any model can follow, wrapped in a contract that code enforces the same way whichever model wrote the reply. A weaker model produces fewer usable outputs, never unchecked ones.

## The parts

| Part | Where | What it does |
|---|---|---|
| Instructions | `skills/<name>/SKILL.md` | Purpose, what you read, steps, what good looks like, what never to do. Front matter: `name`, `description`, `version`, `role` (planner, coach or verifier). |
| Contract | next to the code that uses it, e.g. `FRESH_PRACTICE` in `src/fresh-practice.ts` | Which runbooks it loads, the reply schema, self-check questions, code rules, an optional blind reviewer, and how many repairs it may try. |
| Shared rules | `src/runbook/gates.ts` | Child safety and personal-detail requests, answer leaks, repeated or duplicate questions, reading level, Bloom wording, sources. |
| Reviewer | `src/runbook/critics.ts` | A separate call that solves each question without the key and says what Bloom demand it really makes. |
| Runner | `src/runbook/run.ts` | Write → schema → parse → rules → self-check, repair what is blocked, review, then prune or refuse. |
| Record | `runbook_runs` table, `src/runbook/record.ts` | Step, version, provider, model, outcome and the names of rules hit. Never learner text. |
| Golden cases | `eval/golden/<step>.json` | Fixed inputs with scripted replies and the outcome the checks must reach. CI runs them with a stub model. |
| Version lock | `src/runbook/versions.json` | A fingerprint of everything the model is told. Changing instructions without bumping the step's version fails the tests. |

## Adding or changing a step

1. Write or edit the `SKILL.md`.
2. Add or edit the contract and register it in `src/runbook/registry.ts`.
3. Add golden cases: at least one that passes and one that is refused for each rule you rely on. Mark realistic inputs `"live": true`.
4. If the instructions changed, bump the contract `version`, then run `node --experimental-strip-types scripts/runbook-lock.ts`.
5. `npm test`.

## Checking a real model

```bash
TUTOR_EVAL_PROVIDER=openai TUTOR_EVAL_MODEL=<model> TUTOR_EVAL_KEY=<key> \
  node --experimental-strip-types scripts/eval-runbooks.ts --confirm-spend
```

This runs every live golden case against that model and saves a score per step under `evidence/runbook-eval/`. Add `TUTOR_EVAL_CRITIC_*` to review with a different model. `scripts/runbook-health.ts` summarises recorded runs from a database.

Two AI calls agreeing is a filter, not proof. Uncertain grades stay unresolved, and a parent can review a sample.
