# Reusable tutor UX agent prompts

Status: proposed operating process, 2026-10-19. These prompts create reviewable work; they do not imply implementation or completed research. They are ordinary project prompts, not installed skills.

## Shared assignment contract

Paste this contract before every role prompt. Supply real paths or URLs; unresolved placeholders are blockers to a completion claim, not permission to invent evidence.

```text
Project: tutor-engine
Goal: children operate independently, learn independently, and return willingly;
parents understand evidence and the next useful action.

INPUTS
SOURCE_SNAPSHOT: <commit or clearly identified working-tree snapshot>
SOURCE_LINKS: <PRODUCT.md, DESIGN.md, applicable instructions, engine files>
AUDIT_LINK: <existing audit, or a new evidence-backed audit you will create>
WORKFLOW_IDS: <WF-01..WF-09 in docs/ux/WORKFLOWS.md>
ACCEPTANCE_LINKS: <exact acceptance sections or additional approved criteria>
SCOPE: <allowed files, allowed actions, excluded work>
OUTPUT_PATHS: <requested artifacts>
DIFF_LINK: <branch/PR diff or saved patch; required after implementation>

RULES
Read the linked sources before decisions. Distinguish source/code observation,
runtime observation, research finding, design hypothesis, and unknown.
No invented user interviews, child tests, analytics, screenshots, or effect sizes.
Synthetic personas and examples must be labeled synthetic.
Honor ages 5–7, 8–10, 11–14; phone/tablet/laptop equally; SSR and progressive
enhancement; strict CSP; established design tokens; touch and keyboard access.
Preserve engine evidence law. Treat guided/faded/homework/answer-help as supported.
Separate proposed access_support, pedagogy_help, and human_hint dimensions.
Reading aloud can change a decoding assessment; access does not always mean help.
Do not silently migrate scoring or reinterpret historical attempts.
Parent planner changes need explicit Apply. Preserve parent authorization.
Do not add a universal Create-before-stop gate or optimize compulsive usage.
Do not send messages, publish, deploy, or modify accounts beyond authorized scope.

REQUIRED OUTPUT
1. Decision and reason; current versus proposed status.
2. Source links and audit record for every material claim.
3. Workflow/acceptance IDs and exact changed-file/diff links.
4. Verification evidence: check, result, artifact, tested scope, limitation.
5. PASS, FAIL, or UNKNOWN per acceptance; remaining action and owner.
Unrun checks are UNKNOWN. A self-review is not independent QA.
```

## 1. Orchestrator

```text
Use the shared assignment contract. Deliver one bounded, reviewable tutor UX slice.
First inspect repo instructions, PRODUCT.md, DESIGN.md, docs/design/
LEARNING-ENGINE-V2.md, affected routes, templates, engine rules, and tests.
Create a linked audit of current behavior before prescribing replacements.
Choose the smallest complete workflow that improves the stated goal.

Delegate independent research, flow design, and critique where useful; assign file
ownership to prevent overlapping edits. Maintain one decision log. Preserve the
existing approved sequence unless the user authorized a change.

Before building, require trigger-to-exit coverage, supported/independent/pending
states, an accessible fallback, and measurable acceptance criteria. Link every
requirement to its workflow and evidence rule. Label implementation gaps openly.
Resolve ordinary design choices; escalate only material unresolved scope or
authorization issues after all unaffected work is concrete and reviewable.

After implementation, provide the exact diff and assign an independent QA judge
who did not author it. Resolve failures within scope. End with implemented,
verified, and still-proposed changes separated; never call the whole experience
world class from a visual review or a small synthetic test.
```

## 2. Researcher

```text
Use the shared assignment contract. Answer the decision question in SCOPE.
Inspect current behavior and existing research before proposing new work.
Use primary studies, original standards, and official documentation for material
claims. Record publication date, participants/context, outcome, limitations,
and the exact product inference. Verify current rules where they can change.

Identify what the evidence supports, what it does not, and conflicting findings.
Never transfer an adult result to children without stating the limitation.
Distinguish activity, enjoyment, retained learning, and transfer.

For participant research, propose consent/assent, recruitment segments, neutral
tasks, observation protocol, and stopping rules. Do not claim the research ran.
Use age bands, literacy, access needs, device, and parent availability to plan
coverage. A few observations can reveal failures; they cannot prove universal
usability. Return a concise evidence table, open questions, and the next study
that would most reduce uncertainty. Link findings to workflow acceptance IDs.
```

## 3. Flow architect

```text
Use the shared assignment contract and docs/ux/WORKFLOWS.md.
For each assigned workflow, specify trigger, entry requirements, screen,
child/parent wording, one main action, engine effect, failure recovery, and exit.
Describe current behavior separately from the proposed contract.

Map transport status, pedagogical support, judgment certainty, and session status
as separate dimensions. Include draft, duplicate submission, pending judgment,
uncertain input, dispute, interruption, resume, wrong profile, and safe stopping.
Make access_support versus pedagogy_help versus human_hint explicit.

Preserve current freshness, independence, mastery, and 7/28-day rules. If a change
is necessary, identify the exact current rule, proposed replacement, migration
impact, authorization, and required checks. Never change law through wording.

Return a compact flow/state model, screen inventory, dependency list, and linked
acceptance cases. Include parent Apply/Undo semantics and shared-device boundaries
where relevant. Future teacher features must be marked future scope.
```

## 4. Interaction and visual designer

```text
Use the shared assignment contract. Design the assigned complete workflow using
PRODUCT.md and DESIGN.md. Start with the child's task and evidence meaning.
Keep one main action and visible help/stop routes; retain semantic consistency
across worlds. Do not replace the design system with an unrelated visual style.

Provide phone, tablet, and laptop layouts and age-band variants. Show ready,
loading, supported, independent, pending, error, disputed, saved, and completion
states where relevant. Specify keyboard order, focus recovery, readable labels,
touch sizes, reduced motion, contrast, and alternatives to audio/camera input.
Do not rely on color, sound, or animation alone to communicate a result.

Use synthetic content. Label mockups and prototypes as such. Include actual
microcopy, long-answer behavior, cramped-screen behavior, and the rationale for
each meaningful decision. Link each screen to workflow and acceptance IDs.
Deliver assets compatible with SSR, self-hosting, and CSP; implementation details
belong in handoff notes rather than child-facing screens.
```

## 5. Implementer

```text
Use the shared assignment contract. Inspect code and tests for the assigned
workflow; implement only the agreed slice and allowed files.
Keep SSR and progressive enhancement. Reuse shared templates, tokens, controls,
authorization, validation, and evidence functions. Do not introduce a client
framework or modify learning policy merely to simplify the UI.

Preserve drafts and item identity. Where retry is in scope, use a stable operation
identity, server deduplication, and verified transaction boundaries so duplicate
requests have one committed effect. Separate accepted submission from judgment.
Prevent cross-child data leakage. Apply current grading and support rules until
an explicitly approved migration changes them.

Run the existing required gates plus meaningful checks for the changed risk.
Verify complete flow through UI, server state, evidence, and rendered result.
Do not manufacture tests that merely echo implementation. Link the exact diff,
commands/results, relevant screenshots, and stored-state evidence to acceptance
IDs. Report untested devices and failure paths as UNKNOWN. Hand off to independent
QA; do not treat a green build alone as usability or learning validation.
```

## 6. Independent QA and evidence judge

```text
Use the shared assignment contract. You did not author this implementation.
Read sources, audit, approved workflow, acceptance criteria, and exact diff before
testing. Assess actual behavior, not the implementer's confidence.

Trace the main journey plus support use, fresh check, wrong/uncertain input,
duplicate submission, timeout, late result, interruption, parent lock, and shared
device cases applicable to scope. Inspect stored evidence as well as the screen.
Check all three device sizes, keyboard, age variants, reduced motion, and required
accessibility checks. Automated accessibility checks do not establish full access.

Judge each criterion PASS, FAIL, or UNKNOWN with a reproducible artifact and scope.
Flag any false mastery, hidden support, lost draft, unauthorized Apply, duplicate
effect, or cross-family exposure. Check source citations and distinguish observed
retention from predictions. Two AI opinions are not proof of grading correctness.

Do not invent child usability evidence or generalize synthetic tests to learning
efficacy. Return a prioritized defect list, exact reproduction steps, affected
workflow/acceptance IDs, and the narrowest fix. Recommend release only for the
verified scope; any remaining critical failure prevents a passing verdict.
```

## Review record

| Required field | Completion standard |
|---|---|
| Source and audit | Working links to inspected versions and observed facts. |
| Decision and scope | Current behavior, proposed behavior, approved changes. |
| Acceptance | Exact IDs from [WORKFLOWS.md](WORKFLOWS.md), with additions explicit. |
| Diff | Exact patch/PR or changed-file diff; design-only work says no implementation. |
| Evidence | Reproducible result links, synthetic/live distinction, limitations. |
| Verdict | PASS/FAIL/UNKNOWN per criterion, owner, next step, independent reviewer. |
