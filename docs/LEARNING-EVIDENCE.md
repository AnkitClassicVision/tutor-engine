# Learning cycle and evidence changes

The learning cycle now keeps the delivered question, its rubric and any help attached to the same revision through answering, delayed grading, retries and reports. Replaced or repeated work cannot inherit independent, mixed or transfer credit from a different question.

Fraction practice includes separate magnitude, equivalence, addition and operation-choice outcomes. Targeted teaching offers computed worked steps, completion problems and fading support before fresh independent checks. An active dated fraction target can lead through diagnostic, immediate, delayed and unfamiliar-transfer checks. The authored forms preserve outcome, thinking demand, response control and rubric identity. This establishes a bounded software comparison; it does not establish equal empirical difficulty or learning gains.

Assessments withhold teaching and correctness feedback until whole submission, including paused, interrupted and pending-grade sessions. Answer saves have matching server acknowledgments; draft, queued, running, failed and parent-review states remain distinct. Reports show sample counts and missing timing observations. Time with a question open is an estimate of active work, not a measure of thinking.

Paper work preserves the printed questions and their authored controls/rubrics. Photos belong to the family's worksheet, duplicate uploads reuse the attachment, and repeated submissions retain the first answers. Entries can recover from a lost response; blanks stay unanswered and unreadable entries require correction. A photo selection is only a temporary browser preview until the server confirms saving. Families can retain a photo in their device's camera/photos application for later upload. Paper help conditions are self-reported; unknown conditions cannot establish independent success. Generated and reopened sheets record possible exposure and are excluded from fresh follow-up questions. A disputed grade remains on record without progress credit.

## Compatibility and operation

Migrations 025–027 add evidence provenance/exposure records, revision-bound teaching fields and nullable turn timing. They retain integer flags and existing responses. They do not automatically cut over existing learners or invent historical exposure, confidence order or timing observations. New records use the shared comparison policy; incompatible task demand, response form or transfer role stays outside the comparison denominator.

`cutoverLearningEvidence` in `src/evidence-cutover.ts` is a separately invoked operator operation, not a startup or preview side effect. For an authorized cutover, first preserve and verify a matching database/file snapshot and encryption-key continuity, identify the intended family and learner, and confirm that the resource is the intended isolated or release target. The operation stores the existing state and milestone receipt and preserves that first receipt on retries. Do not run it implicitly against a preview with unknown resources.

An additive schema does not make older application readers safe for new evidence. After a cutover or new writes, retain compatible readers or restore a matching approved snapshot; rolling application code back alone can reinterpret new mixed/provenance records. Preserve drafts, pending grades, original answers, earned history and due dates throughout recovery.

Before a feature push can trigger hosting, verify database/schema and private-file isolation. A local function build establishes compilation and resource inclusion only. Hosted transport, actual migrations and affected journeys need separate verification on the deployed revision. Provider access and model/camera/microphone permissions remain separate from software installation.

## Executable verification

Use Node 24. The default checks work without private research, a model account or a cloud database:

```sh
npm ci
npm run check:public-content -- .
npm run typecheck
npm test
npm run build:assets
npx playwright install chromium firefox webkit
npm run test:browser
```

The explicit parity harness requires local PostgreSQL executables and an unprivileged user:

```sh
npm run test:provenance-parity
```

It rejects external database connection variables, starts its own disposable cluster on a private Unix socket, exercises fresh and populated/replayed migrations, compares SQLite/PostgreSQL evidence and cleans only its own fixtures. The default suite does not run it or require PostgreSQL.

The synthetic route advances an injected test clock through a nonempty comparable delayed pair and a separate unfamiliar transfer task. It also covers assessment sealing, skipped work, failed generation/checking, interrupted saves and paper retries across configured browser projects. The clock has no HTTP or environment control in the application. Synthetic grader responses make these software tests independent of paid inference.

Actual family learning, willingness to return, physical cameras/microphones, Jetson performance and physical paper completion require separate observations. The [evaluation plan](EVALUATION-PLAN.md) and [family session kit](ux/FAMILY-SESSION-KIT.md) describe the measurement boundaries. Passing software checks supplies no claim about those outcomes.
