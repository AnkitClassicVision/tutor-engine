# Learning engine v2: from the mastery blueprint to runbooks with quality built in

Status: approved 2026-10-18; building all five phases in order. Progress is recorded at the end of this file. Source: *Learning for independent mastery — complete blueprint* (18 October 2026), checked against the current engine, the v1 spec and the runbooks in `skills/`.

## The three goals this must serve

1. **Climb Bloom, with evidence.** Children reach Evaluate and Create, not just recall. Progress toward Bloom's 2-sigma result is shown with honest evidence, never claimed.
2. **Sticky and fun.** Children come back because they want to, and the fun comes from the thinking itself.
3. **Individual.** Every child starts where they actually are and works toward targets the family chose, in any subject a parent adds.

## What the blueprint says, in one paragraph

Learning has three branches. **Design learning**: decide the purpose, the starting point and what evidence will count before choosing activities. **Build understanding**: mental models, durable memory and a correction cycle (attempt, diagnose, feedback, retry; plan, monitor, reflect). **Sustain engagement**: autonomy, competence and relatedness; quests, novelty and rewards that report real gains; easy stopping and easy return. Mastery is proven three ways: **independent** (no help doing the thinking), **delayed** (still there after 7 and 28 days) and **transfer** (works in an unfamiliar case). The work is split between three responsibilities: **Planner**, **Coach** and **Verifier**. Anything not backed by research (quest designs, timings, rewards) is a hypothesis to test, and a feature earns its place only if return goes up *and* independent learning holds.

## How the current engine compares

| Blueprint element | Today | Gap |
|---|---|---|
| Bloom demand per task | Every attempt carries a Bloom level; mastery is per level | Practice-pack runbooks cap at Bloom 4. Evaluate and Create are "further challenge" only, so few children ever reach them |
| Independent evidence | Hints or support make an attempt non-independent | Solid |
| Delayed retention | 7-day check and spaced review; "remembered a week later" measure | No 28-day check; review gaps grow with success but are not set from the goal or deadline |
| Novel transfer | An error type exists; interleaving is required for mastery | Transfer is not recorded as its own evidence or shown to parents |
| Misconceptions | Diagnosed as an error type after a miss | Not stored per concept ahead of time, so contrast cases and targeted probes can't be planned |
| Learning brief (purpose, readiness, conditions) | Readiness via placement probes; attention cap | No "why this matters to me" purpose; no session conditions (tired, short on time) |
| Knowledge dimensions | Not tracked | Facts, concepts, procedures and self-knowledge need different tasks and checks |
| Metacognition | Explain-back and recap | No predicting, rating confidence or comparing confidence with the result |
| Correction cycle | Hint ladder, worked and faded examples, retry | Solid. A retry on the *same* item can still be counted as a fix |
| Game patterns | Worlds, Bloop, missions, keepsakes | Missions are themed practice. No detective, debate or builder missions where the game *is* the higher-order thinking |
| Unusual features | "Find the planted mistake" is in the v1 spec | Teach-the-mistaken-character, museum of changed minds and bring-the-world-in are not built |
| Visible progress | Mastery map, five learning measures | Doesn't separate practiced, assisted, independent, retained and transferred |
| Any subject | Math graph built in; concept-check runbook for other topics | No research step that builds a subject map before teaching a new subject |
| Planner, Coach, Verifier | Planner and Coach runbooks; code gate for packs | No Verifier role across runbooks; no human sample review of AI judgments; 4 runbooks are single paragraphs without the standard structure |
| Honest evaluation | Measures say "not enough yet" until there's enough data | No before/after effect size, decision thresholds set in advance, or tests that compare a feature on and off |

Conclusion: the engine's core (independence, spacing, Bloom per attempt, honest measures) already matches the blueprint. The upgrade is to **reach the top of Bloom on purpose**, **add transfer and delayed evidence**, **give every subject a researched map**, **make the fun come from the thinking itself**, and **wrap every AI step in the same quality contract**.

## The plan

### 1. One runbook contract for any AI model

Every AI step becomes a runbook with the same parts, so any model (OpenAI, Claude, Grok, open models through OpenRouter) can run it and the app can check the result the same way.

| Part | What it is |
|---|---|
| `SKILL.md` | Plain instructions: purpose, what you read, steps, what good looks like, and what never to do |
| Contract | Input fields, a JSON output schema, the Bloom range and knowledge dimensions it may produce |
| Self-check | Questions the model must answer about its own output, returned in the output (e.g. "which misconception does item 3 target?") |
| Code gate | Fixed rules in code that hold whatever the model, extending today's pack quality gate: schema, arithmetic checked by the app, answers not leaked, fresh wording, reading level, Bloom verbs match the task, child safety |
| Critic rubric | A separate call (a different model where the family has one) scores the output against the runbook's rubric. Below the bar: one revision, then drop |
| Golden cases | Fixed inputs with expected properties, run in CI with a stub model and on demand against real models, with a score per model and runbook version |
| Record | Runbook version, model, gate results and critic score are saved with every decision, so a later model can continue and a bad version can be traced |

Quality layers, cheapest first: **schema → code rules → self-check → critic → real-use signals → human sample.** Real-use signals catch what review can't: an item everyone fails or everyone passes, a hint that never helps, a grade parents overturn. A parent or reviewer looks at a sample of uncertain and overturned grades. Two AI judges agreeing is a filter, not proof.

### 2. Runbook set (Planner, Coach, Verifier)

| Role | Runbook | New or upgraded |
|---|---|---|
| Planner | **research-subject**: build the subject map for any subject | New |
| Planner | **learning-brief**: purpose, readiness, conditions per child and subject | New |
| Planner | plan-course, plan-class, plan-from-uploads, update-learning-path, revise-agenda | Upgraded to the contract and the subject map |
| Planner | **design-mission**: detective, debate or builder mission at a chosen Bloom pair | New |
| Coach | coach-through-question, adapt-session | Upgraded: predict first, confidence, contrast cases from the misconception list |
| Coach | **mistaken-character**: a labelled character with a plausible wrong idea for the child to correct | New |
| Coach | pack runbooks (math procedure, word problems, vocabulary, concept check) | Upgraded: Bloom range up to Create where the subject supports it |
| Verifier | assess-learning, design-questions | Upgraded: separate fresh, delayed and transfer checks |
| Verifier | **verify-judgment**: second opinion on uncertain grading, with sample-to-human rules | New |
| Verifier | review-school-homework, read-school-material, reconcile-school-results, learner-observations | Rewritten in the standard structure |

### 3. Research step for any subject

When a parent adds a subject ("chess", "Spanish", "the Civil War", "coding in Scratch"), **research-subject** runs before any lesson and produces a **subject map**:

- the purpose and scope for this child (age, goal, deadline);
- concepts in groups of two or three (the blueprint's chunking rule), with prerequisites and the cross-links to math or reading they rely on;
- for each concept: knowledge dimension, what success looks like at each Bloom pair (Foundations, Use & investigate, Judge & produce), common misconceptions with a probe question each, a contrasting pair, a real-world mission idea and an unfamiliar transfer setting;
- sources with their provenance.

Checks: schema and coverage; every concept has a Judge & produce target and at least one misconception; sources are listed for factual claims; age fit; critic review; then **the parent approves the map** (or edits it) before teaching starts. The map is versioned, and evidence from the child's attempts can flag a concept for revision. Built-in math stays the reference map that the research step is measured against.

### 4. Evidence ladder and visible progress

Each concept shows where the child is on two axes:

- **Thinking:** Foundations → Use & investigate → Judge & produce.
- **Ownership:** practiced → assisted → independent → retained (7 days, then 28) → transferred.

The goal for a concept is **independent at Judge & produce, retained at 28 days, and transferred once**. Mastery stays per concept and per level, and still requires fresh items, two days and mixing, as today.

**Progress toward 2 sigma.** For each subject, compare fair checks at the start with checks after teaching, using fresh, unseen, independent items at the same Bloom demand. Report the gain with its uncertainty and the number of checks behind it. The parent view says "progress toward" and never claims 2 sigma without a comparison group. Decision thresholds are written down before results are looked at.

### 5. Fun that is the thinking

- **Mission patterns:** Detective (analyze), Debate panel (evaluate), Builder's workshop (create), each ending with a defend-your-reasoning step.
- **Mistaken character:** Bloop's friend confidently explains something wrong; the child fixes it and answers an objection. Always labelled as a mistake.
- **Museum of changed minds:** saves the first prediction, the evidence that changed it and the new explanation, as a keepsake.
- **Bring the world in:** a child photographs a recipe, plant or claim, and the app turns it into a mission on a concept in their map.
- **Home choices:** Continue my mission · Quick review · Bring a question.
- **Rewards:** report a real gain or unlock a harder mission. Cosmetics stay separate from evidence, with no streak penalties.

Each mechanic ships with an on/off comparison: voluntary return, help dependence and independent learning are measured together. Keep a mechanic only if return rises and learning holds.

### 6. Individual by default

- The learning brief adds the child's purpose ("I want to make my own game") and today's conditions (short on time, tired), which change the session length and the mission, not the judgment of ability.
- Three separate knobs, as the blueprint says: complexity, unfamiliarity and support.
- Confidence versus result is tracked per child, so the coach can say "you were sure and it was right: trust that" or "you were sure and it slipped: let's check why".

## Build order

1. **Runbook contract and QC harness.** Contract format, gate library, critic step, golden-case runner, decision record fields. Move the existing pack gate onto it. Proof: every current runbook passes its golden cases on the stub model, and the harness reports per-model scores.
2. **Evidence ladder.** Transfer and 28-day evidence, confidence, the two-axis progress view, the before/after gain. Proof: on synthetic families, the view separates assisted from independent, and retained from transferred.
3. **Research step and subject maps.** research-subject, learning-brief, parent approval. Proof: maps for three unlike subjects (a science topic, a language, a history topic) pass the checks, and a lesson runs from each.
4. **Top-of-Bloom missions.** design-mission, mistaken-character, museum, bring-the-world-in, pack Bloom ranges raised. Proof: a child path that reaches independent Judge & produce on a concept in the test families.
5. **Verifier and evaluation.** verify-judgment, human sample review, on/off comparisons, decision thresholds. Proof: a written evaluation plan and the first sampled-review report.

Each step ships behind the existing QA (strict TypeScript, unit, cloud, browser suites), with independent review before release.

## What stays true

Children never see unchecked AI output. Assisted success is never shown as mastery. Original attempts are never rewritten. Families' AI use stays on their own provider. Nothing in this plan claims a measured effect until the evaluation shows one.

## Progress

- **Phase 1, runbook contract and quality harness: built.** Every AI step (fresh practice, grading, curriculum, class-planning chat, lesson replies, parent planner, reading school pages, reviewing and guiding homework) runs through one contract with schema, self-check, shared code rules, bounded repairs and a blind reviewer where questions are written; practice packs record into the same run log and their reviewer now checks Bloom demand. Golden cases for every step run in CI, instruction changes are locked to versions, and `scripts/eval-runbooks.ts` scores a real model per step. See [skills/README.md](../../skills/README.md).
- **Phase 2, evidence ladder: built.** Question writers can mark a question as transfer (the idea used somewhere new); the tag travels from the stored question to the session and onto the attempt (migration 016). Children can say Sure, I think so or Guessing before checking; a sure miss and a lucky guess each get one kind line, and parents see a "Knows what they know" measure. The numbers page shows each topic's thinking band (basics, using it, judging and creating) and ownership steps (practised, with help, on their own, remembered after a week and a month, used somewhere new), and a before/after comparison on fair checks with its effect size, uncertainty and an honest note on the 2-sigma benchmark.
- **Phase 3, research step and subject maps: built.** A new subject (anything but the built-in math) is researched before it is taught: the family's AI searches the web with its own search tool when it has one (OpenAI, Anthropic, OpenRouter) and may cite only links that search returned; other connections research from knowledge and the map says so, with links removed. The map holds two to six groups of two or three concepts in prerequisite order, success at basics, using it and judging-and-creating, real misconceptions with a probe each, a mission, a transfer situation and sources. Code checks order, top-level demand, citations, safety and reading level; an independent subject-expert reviewer checks accuracy and age fit; failing concepts are dropped. The parent approves, asks for changes (a new version) or sets it aside; approval creates the topics with their prerequisites and the curriculum writer teaches from the map (migration 017, sealed per family).
- **Phase 4, top-of-Bloom missions: built, one part deferred.** A new mission pack runbook builds detective, debate and builder missions: notice, clue, fix the mix-up (a labelled wrong explanation from a friend of Bloop's, using a real misconception from the subject map when one exists), weigh it, make it and defend it under a changed condition. Asking for a challenge, case or debate routes to it in any subject, and the child's home offers a challenge mission once a topic is solved on their own at "using it". Concept-check and word-problem packs now reach Evaluate. "Fix the mix-up" and "Defend it" are teaching moves for every question writer. A miss followed by a correct higher-level explanation in the same mission is saved to the child's museum of changed minds (migration 018, sealed). Bringing the world in uses the existing "say it your way" box; turning a child's photo of a real object into a mission is deferred until the child photo flow gets its own safety review.
- **Phase 5, verifier and evaluation: built.** Evaluate and Create grades, and any grade below 0.9 confidence, get an independent second judgment (verify-judgment runbook) that never sees the first; disagreement or doubt leaves the answer for a parent. Parents can spot-check the AI's grades from the numbers page; a disputed grade stays on record but counts neither way (migration 019). A week-on, week-off comparison can be switched on per child for the confidence choice and challenge missions, judged by a rule fixed in advance. The rules are written down in [EVALUATION-PLAN.md](../EVALUATION-PLAN.md). No real-family results exist yet; the first sampled-review report will come from the spot-check page once families use it.
- **Grading hardening (2026-10-19, after live checks):** grades show their working with quoted evidence, code checks the working, every AI grade gets an independent second judgment, anything under 85% confidence or disputed is grounded in the topic's own material (ground-judgment runbook), and anything still unsure goes to the parent with the reason (migration 020). Parents see these first on the grading page and as a banner on their overview.
