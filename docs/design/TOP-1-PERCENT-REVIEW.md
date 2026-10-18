# Top-1% review: four-model panel, 2026-10-16

The owner asked whether Bubble is a world-class (top 1%) learning and UI/UX experience. To find out, four models reviewed it independently from one shared brief and six phone screenshots:

- Gemini 4 Argon, through Antigravity
- GPT-6 Astra, through Codex
- Claude Fable 5.1
- Grok

The brief is grounded in learning-science and children's-UX research:

- Retrieval practice and spacing each show effects around g≈0.5, and interleaving g≈0.42 (Brunmair & Richter 2019; review PMC10950551).
- NN/G recommends designing for distinct age bands (3–5, 6–8, 9–12).
- Self-determination theory favours competence, autonomy and relatedness over streak pressure.

## Verdict: not yet top 1%

| Dimension | Gemini | Astra | Fable | Grok |
|---|---|---|---|---|
| Learning effectiveness | 7.5 | 7 | 7 | 7 |
| Child UX | 3.5 | 4 | 4 | 4 |
| Motivation and delight | 4.5 | 5 | 4 | 5 |
| Parent UX | 5 | 3 | 6 | 4 |
| AI tutoring quality | 6.5 | 4 | 6 | 6 |
| Trust and safety | 8.5 | 5 | 8 | 7 |

All four agree. The engine is strong (fresh independent checks across days, spacing, probes, prerequisite recovery, checked packs), but the screens put "the lab notebook on the child's desk". Points every reviewer raised:

- The correction screen showed "stored key", "Key or rubric", zero counts and a "For the teacher" block, and gave away the answer before any nudge.
- The child home ran about 8,000 px with five competing ways to start and a six-option duration picker. The parent page ran about 21,000 px.
- Sessions had no sense of momentum; the empty trail said "0 milestones".
- Picture-based teaching (fraction bars, arrays) was missing. This is the biggest learning gap for ages 5–11.

## Changed in this round

- **Corrections are nudge-first.** After a miss the child sees one question (the item's first hint, never one that contains the answer) and, if the AI judge gave a reason, that reason. The explanation, a picture and the answer stay behind "Show me how". Grading vocabulary ("stored key", "Key or rubric", "reliable verdict", "fresh independent successes") no longer appears on child screens. Answers still being checked read "We're still checking this one. It won't count against you."
- **Pictures for the idea.** `src/visuals.ts` draws fraction bars (each fraction, then both on a shared denominator) and dot arrays for multiplication facts. They appear in "Show me how" and in pack lessons, never on an independent question, so a picture never turns a check into supported work.
- **The end of a mission.** The heading is "Look what you did", with one plain sentence ("You solved 3 on your own and 1 with a little help"). "Want to talk it through?" comes next, and the teacher notes fold into "For grown-ups" (still only for an unlocked parent).
- **Momentum in a session.** Stepping stones (done, now, next) replace the text progress bar. A correct answer gets "✦ Yes! That holds." The method explainer and the time-cap sentence are gone from every question.
- **One mission first on the child home.**
  - The greeting and today's mission share one card with one big Let's go. The time sits behind "About N minutes · change". "Skip the lesson" is a quiet link.
  - Mission reasons use the child's words ("Next up on your learning path", "Getting ready for Friday's quiz").
  - The parent-mode banner is a slim strip.
  - "Choose your path" is merged into "More to do", with a "Remember this one" tile when a review is due.
  - The trail shows "Your first keepsake is waiting" instead of zero counts.
- **One button for practice.** The practice box has a single Make button and a quiet "Show me the plan first" (child) or "Show me first" (parent) checkbox. The planner sheet no longer carries a separate practice toggle.
- **Child wording everywhere.** `src/child-words.ts` turns a rubric into "A good answer says: …" (the idea only, without marking instructions) and hides grader reasons that mention the key, rubric or confidence. The grading prompt now asks for reasons written to the learner.
- **Voice note once.** The speech-service notice folds into "About voice typing".
- **Waiting.** The learning moment is open by default, the elapsed counter is small, and Stop processing is a quiet link.
- **Topics.** "Start this mission" sits right under the topic. The evidence tables (independent checks, Bloom levels, rules, connections) fold into "How we know", which is open for a parent and closed for a child.
- **Parent page.**
  - Controls and the school-result form are collapsed unless a link or `?section=` points to them; a small script opens the section an anchor targets.
  - The four counts hide until there is something to count.

## Next round (not built)

1. **Interactive manipulatives:** tap-to-split fraction bars, equal groups and number lines, as accessible SVG/HTML controls with text alternatives (Astra #3, Gemini #7).
2. **Junior beyond type size:** age bands 5–7, 8–10 and 11–14, read-aloud on arrival where browsers allow it, and multiple-choice tiles by default for probes (all four).
3. **A five-minute mission as a complete arc:** lesson, guided, faded, independent, one review, close. Probes resume across short sessions (Astra #4, Fable).
4. **Parent overview as one viewport:** three lines and one action, with Classes and Settings as their own pages and forms in sheets (all four).
5. **Retrieval while waiting:** one due-review card during a pack build (Grok #6, Fable #10).
6. **Treat a non-attempt as a non-attempt:** re-ask instead of diagnosing "99" (Astra, Grok).
7. **Measure it:** time to first question, second-try self-correction rate, hint-before-answer rate, session completion and fresh unaided retention.

## Measured on a phone (Pixel 7 screenshots)

| Screen | Before | After |
|---|---|---|
| Child home | 8,164 px | 5,478 px |
| Parent page | 21,331 px | 12,519 px |
| Correction after a miss | 8,298 px | 4,158 px |
