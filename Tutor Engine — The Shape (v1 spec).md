# Tutor Engine — The Shape (v1 spec)

Oct 4, 2026 · @Ankit Patel

## The reframe

This is not a lesson-delivery device. It is a learner model plus a control loop that holds a kid at about 85% success on the next-hardest thing, and only calls a concept mastered once it survives time.

Three research levers it is built on:

- **Bloom's 2 Sigma (1984).** One-on-one tutoring with mastery learning moved average students to roughly the 98th percentile. The two ingredients: never advance before mastery (formative check, corrective, retest), and immediate adaptive feedback. Later meta-analyses put tutoring closer to 0.3 to 0.8 SD, so treat 2 sigma as the ceiling, not the promise.
- **Desirable difficulty.** Learning is fastest when the task fails about 15% of the time (the 85% rule). That number is the thermostat setpoint for "just right."
- **Spacing, interleaving, retrieval.** Forgetting is the default. "Don't forget everything else" is solved by scheduling, not re-teaching: a concept counts only after it survives a gap of days and shows up mixed with other topics.

One honest correction: matching "learning styles" (visual, auditory, kinesthetic) does not survive the evidence. What is real and measurable: reading level, working-memory load, attention span, prior knowledge, and the specific errors a kid makes. The model tracks those, never labels.

The top of Bloom's is reached by production, not consumption. The kid explains it back, finds the tutor's planted mistakes, writes problems for the tutor, builds something. The device's job is to make the kid the teacher as early as possible.

&#91;embedded content: the tutor loop · 6 moves around one learner model\]

Select is the thermostat: after every item it reads the model and picks the next thing at the just-right difficulty; Assess and Reflect write back what happened.

Figures in this section are from memory and approximate; run a citation pass before this spec goes to anyone outside the family.

## Adaptive learning contract (2026-10-12)

Choose a recommended mission, due review, or exploration. Check a small goal, teach from the response, offer supported practice, then a fresh independent question. Remember later in a delayed retrieval and a different context. Short sessions can accumulate evidence; a harder probe is optional. Age and school level select initial probes and presentation, while ability is established separately for each topic. Content difficulty is separate from Bloom demand.

Supported success is a learning step, not independent mastery. Keep every original attempt and historical achievement; derive current claims from evidence provenance, support, freshness and certainty. Uncertain grading stays unresolved. Error causes are hypotheses; answer length and latency cannot establish decoding or attention problems. Adapt only from comparable evidence on the same topic and demand. Reward unique learning steps and distinct understanding, application and retention milestones once, without streak penalties, rankings or unvalidated percentile claims. Deeper reasoning and creation remain available as further challenges.

Provider calls follow the shared contract. Hosted ChatGPT approval, bounded model-test authorization and privacy controls remain separate gates. This contract does not authorize inference spend, live activation or a pilot.

## Layer 0 — Entry (any scope, one graph)

Every request, from "one test Friday" to "all of 7th-grade math," is the same object: a target set of nodes on the concept graph, with a priority and a deadline. There is no test mode and no year mode; scope is a selection, never a feature.

| Entry | Example | Target set | What the engine does |
| --- | --- | --- | --- |
| Program (standing) | "7th-grade math this year" | the backbone tagged for this year | paced by the school, interleaved review; the default when nothing else is asked |
| Target (overlay) | "Test Friday on polynomials" | the nodes on the test plus their prerequisite closure, deadline Friday | probe the closure, teach only what fails, drill the target to Apply and Analyze, then fold the nodes back into program review |
| Curiosity (frontier) | "I want to learn number theory" | nodes beyond the backbone, linked to what they rest on | same loop, lower priority than a dated target, kept alive by spaced review |

&#91;embedded content: one graph, three lenses · program, target, curiosity\]

Arrows run from a prerequisite to what it feeds; a target set always carries the nodes it rests on and the nodes it feeds.

- **Probe, do not teach, the closure.** "Polynomials" can pull half of algebra. Session zero on the closure finds the two or three prerequisites that actually fail; only those get taught. That is the mastery-learning move.
- **A dated target outranks the program until its date.** After that, its nodes are ordinary review items.
- **Nothing is ever only one test.** The kid always sees what this rests on and what it feeds ("this is why you learned factoring"), so a single test still sits inside the larger program.

## Layer 1 — Learner model

One persistent state per kid. Every other layer reads from it and writes to it; nothing lives anywhere else.

1. **Identity and setup.** Who, grade, subjects, school calendar, session cap in minutes, preferred modes (paper, voice, screen). Set once; the camera and voice recognize the kid after that.
2. **Concept graph, one per subject.** A node is a concept at standards granularity ("add fractions with unlike denominators"), with prerequisite edges. The node holds where the kid stands on it.
3. **Learner constraints, measured not asked.** Reading level, writing speed, attention block (minutes before error rate climbs), hint sensitivity, which modality each concept was mastered in.
4. **Motivation state.** Streaks, what ended sessions well, what the kid asked to do more of.

Minimum fields on a concept node:

| Field | Type | Example |
| --- | --- | --- |
| concept\_id | string | math.5.nf.a.1 |
| prereqs | list | \[math.4.nf.b.3\] |
| bloom\_level | 0 to 6 | 3 (Apply) |
| mastery | 0 to 1 | 0.72 |
| stability\_days | number | 9 |
| next\_due | date | 2026-10-11 |
| error\_signatures | list | \[procedural, misconception:common-denominator\] |
| hints\_last\_10 | number | 2 |
| mastered\_in | mode | paper |

## Layer 2 — Curriculum ingest

Neither lesson-by-lesson nor dump-the-year. Three layers, each optional, and the live assignment always wins.

1. **Backbone (preloaded, free).** The standards graph for the kid's grade and subject, in the concept graph before the kid ever touches the device. This is how the system knows "all the other stuff they're learning" with zero input.
2. **Scope (optional, once a semester).** A photo of the syllabus, textbook table of contents, or the teacher's scope-and-sequence. The device tags which backbone nodes are "this year" and in what order. Two minutes, sharpens review priority.
3. **Live work (daily, highest priority).** The worksheet or homework on the desk, through the camera. The device maps it to backbone nodes, marks them frontier, and pulls their prerequisites into the session.

The unit is the concept, never the lesson. A lesson is a cluster of concepts a teacher chose to bundle; the device unbundles it.

## Layer 3 — Diagnose

Calibration is continuous. One 10-minute session zero per subject, then every session re-calibrates in its first two minutes.

- **Who's here.** Camera and voice recognize the kid and load the model. No login, no menu.
- **Placement (per topic, continued across sessions when needed).** Adaptive placement along the backbone's prerequisite chain: short probes that span Bloom levels. The goal is to find the edge, not to grade the kid.
- **Every session.** A two-minute warm-up of due items doubles as a retention check and a read on today's state (tired, rushed, distracted).

The diagnosis chooses the corrective. "Wrong, try again" is not a corrective.

| Error type | Signal | Corrective |
| --- | --- | --- |
| Retrieval gap | blank, slow, "I forgot" | retrieval practice, spaced |
| Procedural slip | right method, wrong step | faded worked example, step-by-step check |
| Misconception | the same wrong rule every time | contrast cases that make the rule fail visibly |
| Decoding | wrong because misread | read it aloud, chunk the problem |
| Attention | errors climb with time on task | shorter block, switch modality |
| Transfer failure | right in drill, wrong in a new context | interleaved, varied-surface problems |

## Layer 4 — Select (the just-right thermostat)

Each session the scheduler picks a mix and holds difficulty at about 85% success. That setpoint, not a lesson plan, is what makes it feel just right at the least time.

Default session mix:

- 60% frontier: the current concept, next Bloom rung
- 25% review: items due by memory state, interleaved across topics and subjects
- 15% stretch: today's concept in a new context, or combined with an older one

Controller rules, evaluated on the rolling last 6 items:

| Rolling success | Action |
| --- | --- |
| 90% or above | step up: next Bloom rung, remove a scaffold, or add novelty |
| 70% to 90% | hold |
| below 70% | step down one rung, or switch to the corrective for the diagnosed error type |
| two step-downs in a row | change modality (paper to voice, voice to screen) before easing further |
| time on item above 2x the kid's median, or visible frustration | hint ladder, then a break |
| attention block reached | session ends, no exceptions, even mid-concept |

## Layer 5 — Engage

Each Bloom level has its own move and its own best surface. The tutor never hands over an answer; it climbs a hint ladder.

| Bloom level | Move | Surface |
| --- | --- | --- |
| Remember | retrieval practice, fill-in, quick recall | voice, printed strip |
| Understand | explain it back, paraphrase, example vs non-example | voice |
| Apply | worked example, then faded example, then independent set | printed sheet, camera checks |
| Analyze | find the mistake in a planted wrong solution, compare two methods | paper or screen |
| Evaluate | judge two solutions and justify, grade the tutor's work | voice plus screen |
| Create | write a problem for the tutor, design a thing, teach it back on camera | paper plus a generated screen app |

Hint ladder, in order: nudge (a question), partial (reveal only the next step), worked (show it, then immediately give a parallel problem). Every hint is logged; hints are data about the kid, not a failure.

Protégé effect: the fastest route to Evaluate and Create is making the kid the teacher. The tutor plays a confused student, plants deliberate errors, and keeps asking why.

On-the-fly screen apps are an Analyze and Create tool for spatial or procedural concepts (drag, sort, build, simulate). They are not the main surface; paper is.

## Subject packs

The loop never changes between subjects; the pack plugged into it does. One pack per subject: backbone graph, item generators per Bloom level, extra error types, modality defaults, and cross-edges into other subjects' graphs.

| Pack element | Math | Science |
| --- | --- | --- |
| Backbone | state math standards or Common Core | NGSS performance expectations plus the practices (variables, controls, graphs) |
| Dominant Bloom levels | Apply, Analyze | Understand, Analyze, Create |
| Signature item types | procedural sets, find-the-mistake, write-a-problem | predict-observe-explain, interpret a graph, design an experiment, label a diagram |
| Dominant error | procedural slip, transfer failure | misconception: intuition beats the model |
| Corrective that works | faded examples, interleaving | contrast cases, predict before you see |
| Surface | paper first | paper for diagrams and graphs; the screen matters more (sims) |
| Cross-edges | feeds physics motion, chemistry ratios | reads ratios, graphs, and algebra from math |

Keep one graph per subject with explicit cross-edges. A single all-knowledge graph never ships.

## Layer 6 — Assess and update

Mastery is declared per concept per Bloom level, and only after it survives time and mixing.

- An item scores on three things: correctness, process (did the work on paper show the steps, from the camera), and fluency (time against the kid's own baseline).
- Mastery at a level = 3 successes across at least 2 sessions on 2 different days, at least one interleaved with other topics, with zero hints or support, fresh prompts and confirmed evidence. Age and grade are provisional starting points, never automatic mastery.
- Every result updates the node's memory state. A miss on a mastered concept pulls it back into review, never back to zero.
- Hints used, time on item, and error type are logged to the learner constraints, so the model gets sharper every session.

## Layer 7 — Reflect and report

The kid does a 60-second recap by voice; the parent gets a weekly scoreboard, not a daily feed.

Kid recap, three prompts: What did you learn? What was hard? What would you tell a friend who's stuck on it? Logged as text; it is the metacognition rep and a second read on understanding.

Parent scoreboard, weekly:

| Metric | What it tells you |
| --- | --- |
| Concepts mastered this week, by Bloom level | progress |
| Frontier: what comes next | visibility |
| Retention at 7 and 30 days | whether it is sticking |
| Just-right ratio: share of items landing in the 70% to 90% band | whether the thermostat is working |
| Time-to-mastery per concept | the real speed metric |
| Error-type trend | where a human should step in |

## Device mapping

Paper is the main workspace; the camera is the tutor's eyes; voice is the tutor's mouth; the screen is a side tool. The shape above is device-agnostic, so any hardware that covers these five channels runs it.

| Channel | Layers it serves | Job |
| --- | --- | --- |
| Camera | Ingest, Diagnose, Assess | reads the worksheet, recognizes the kid, watches live work for stuck, erasing, or off-task, scores process not just answers |
| Mic and speaker | Diagnose, Engage, Reflect | Socratic dialog, explain-back, hint ladder, warm-up, recap |
| Screen | Engage (Analyze, Create) | generated mini-apps, two solutions side by side, visual sims; small and secondary |
| Printer | Engage, Reflect | worked and faded sheets, independent sets, retrieval strips, tomorrow's sheet, the weekly mastery map |
| Paper | Engage, Assess | the main workspace for math and writing; handwriting aids encoding and leaves a record |

The design choice that makes or breaks v1: print structured sheets with answer boxes and an ID code on each page, so the vision task is "read box 3 on sheet 41," not "parse a page of kid handwriting." Kid handwriting plus math notation is the hardest technical piece in the whole system; the sheet design is how you dodge it.

## App architecture: capture, judge, print

Build it as a web app; the Jetson is a kiosk that runs the same app later. Everything the device needs is a browser capability today: camera photo and video, live stream, mic and speaker, print to PDF.

&#91;embedded content: app architecture · desk, brain, models\]

The same app serves a laptop or iPad on a stand today and a Pi or Jetson kiosk later; only the model column moves on-device, and only if privacy or cost demands it. Every score the vision grader and session runner produce writes to the learner model.

Four capture modes and how each is judged:

| Mode | What happens | Judged by |
| --- | --- | --- |
| Photo submission | kid holds the finished sheet up to the camera | vision grader: align on the QR and corner marks, crop each answer box, read and score per item against the stored key |
| Video submission | 60-second teach-back or explain-back, recorded | transcript plus the rubric for that Bloom level |
| Live camera | paper under the camera while the kid works; a frame every 5 to 10 seconds, not a continuous stream | stuck, erasing, and off-task detection; triggers the hint ladder; no answer grading until the kid says "check" |
| Live oral test | tutor asks, kid answers aloud or on paper, judged on the spot | realtime voice model for speech; vision grader for the paper |

The print-and-score loop closes only because the sheet is machine-designed. Every sheet carries a QR with its ID, corner marks for alignment, and answer boxes at known coordinates; the answer key and rubric are generated with it and stored under that ID. Scoring is per box with a confidence; a low-confidence box asks the kid to say the answer instead of guessing.

Web app versus Jetson:

|  | Web app: laptop or iPad on a stand, home printer | Jetson: Orin Nano class |
| --- | --- | --- |
| Time to first working loop | days | weeks, most of them hardware and drivers |
| Camera | phone or iPad camera, excellent | camera module, adequate |
| Model quality | frontier cloud vision and voice | small local models; the tutoring brain still calls the cloud |
| Cost | roughly cents to a couple of dollars of model calls per session (approximate) | near-zero marginal, $250 to $700 up front (approximate) |
| Privacy | kids' video goes to a vendor under their terms | stays in the house |
| Offline | no | yes |
| Right for | v1 and the next six months | privacy, cost at scale, or offline, once one of those is the actual problem |

Decision: web app now, with the model calls behind one interface so they can move on-device later. Phase 2 hardware is a Pi 5 with a camera arm running the web app in kiosk mode plus a print server; Jetson only if local inference turns out to be needed.

## Session shape

Twenty-five minutes, six beats, ends on time whether or not the concept is finished.

1. **Recognize and load (1 min).** Camera sees the kid, model loads, one line of continuity: "Yesterday you got unlike-denominator fractions to Apply. Ready?"
2. **Warm-up (2 min).** Four to six due retrieval items, by voice or a printed strip. Updates memory state and reads today's state.
3. **Frontier (15 min).** Worked example, faded example, independent set, on paper with the camera watching. Hint ladder on stuck; thermostat adjusts after every item.
4. **Stretch and interleave (4 min).** Two or three items mixing today's concept with older ones on a new surface.
5. **Produce and recap (2 min).** Explain it back, or write a problem for the tutor, then the 60-second recap.
6. **Exit.** Print tomorrow's sheet, so the next session starts with paper already on the desk.

## Build order and transfer layer

Build the loop as software first; the Raspberry Pi is the last 10%. A laptop, a webcam, and any printer run v1 tonight.

Week 0, before any code: run the loop by hand for three sessions. Photograph the homework, have Claude map it to the standards and print a sheet, the kid works it, photograph it back, Claude grades and picks the next item. Zero build cost; it tests the pedagogy on your kid and tells the build which item types and sheet layouts it needs.

Three things the build would otherwise guess at, so they get specified before week 1: where the concept graph comes from (standards to machine-readable graph), the item-generator contract (node plus Bloom level in, validated item out), and the printed-sheet format the camera reads.

1. **Weeks 1 to 2: prove the loop.** One kid, one subject (math), one dated target (the next test), laptop plus webcam plus printer. Backbone, live-work ingest, thermostat, paper-and-camera loop. Proof artifact: a printed mastery map after 10 sessions showing concepts moved at least one Bloom rung and holding at 7 days.
2. **Weeks 3 to 4: add the voice.** Explain-back, hint ladder, session zero placement, parent scoreboard.
3. **Weeks 5 to 6: widen.** Second subject, interleaving across subjects, first screen mini-apps.
4. **After that: the box.** Pi or Jetson enclosure, kid recognition, built-in printer, second kid.

Transfer layer, so your weekly involvement goes down from week 3:

| Element | Decision |
| --- | --- |
| Driver | Claude Code or Codex builds from this spec; you review the proof artifact, you do not operate the build |
| Operator | the kid, daily; the parent reads the Sunday scoreboard, 10 minutes a week |
| Outcome promised | every tracked concept reaches Analyze or above and holds at 30 days |
| First visible proof | the printed mastery map after 10 sessions |
| Workflow loop | the six-beat session, daily |
| Status model per concept | unseen, frontier, mastered at level N, review due, stuck |
| Decision rules | 85% setpoint; mastery rule in Layer 6; session ends at the attention cap |
| Scoreboard | the six Layer 7 metrics |
| Cadence | daily session, weekly scoreboard, backbone re-scope each semester |
| Escalation | a concept below 70% after 3 sessions flags the parent with the diagnosed error type |
| Not yet | no year-dump UI, no custom hardware, no multi-kid, no sims, no reading/writing subjects |

## Open decisions

- [ ] Which kid and which subject for the two-week proof?
- [ ] Backbone: Georgia Standards of Excellence or Common Core?
- [ ] Confirm: web app now, Pi kiosk in phase 2, Jetson only if local inference is needed (see App architecture).
- [ ] Printer: full-page inkjet (recommended for paper-first) or thermal strip (cheap, narrow)?
- [ ] Who is the human escalation when a concept is flagged stuck: you, or a tutor you hire for that hour?
