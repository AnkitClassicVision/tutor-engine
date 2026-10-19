# Design: prompt 4 output (WF-05 confirm before help)

Prompt: [AGENT-PROMPTS.md](../AGENT-PROMPTS.md) §4, Interaction and visual designer, with the shared assignment contract. Process steps: UX-05 to UX-07. Contract: [flows/WF-05.md](../flows/WF-05.md). **All pages here are labelled mockups with synthetic content.**

- **Mockup:** [wf05-confirm.html](wf05-confirm.html), built on the real `public/app.css` plus [wf05-mock.css](wf05-mock.css). That file holds mock-only helpers and the proposed production rules, which are marked.
- **Screenshots:**
  - phone 390 px: [wf05-phone.png](wf05-phone.png)
  - tablet 820 px: [wf05-tablet.png](wf05-tablet.png)
  - laptop 1280 px: [wf05-laptop.png](wf05-laptop.png)
- **Automated check at each width:** no horizontal overflow, and no button or link below 44 px (64 px for ages 5–7). All three passed after one fix: the 5–7 buttons were stretching to a 12rem height in the column layout.

## Alternatives compared (UX-05)

| Option | Shape | Kept? | Reason |
|---|---|---|---|
| A | Confirm inline on the material list (a Yes/Fix per question) | No | Several questions on a page puts many decisions on one screen. Too much for ages 5–7 (RESEARCH.md 2a, 2b). |
| **B** | **One confirm screen per question, opened from "Let's think it through"** | **Yes** | One decision at a time. Reuses the existing entry point and adds no new navigation. Help cannot start before Yes (WF-05 rule). |
| C | Confirm the whole page's text at once | No | A child cannot check a long transcription. A fix would need editing in the middle of a page. |

## States and microcopy

| State | Heading | Body | Primary | Secondary | Ages 5–7 variant |
|---|---|---|---|---|---|
| to_confirm | Is this the question? | The reading, in the question text style, with Read aloud. When confidence is under 0.7: "I might have read this wrong. Check the numbers." | Yes, help me | Fix it · Take another photo (link) | "Is this it?"; Hear this; buttons stacked; no photo link (one decision) |
| fixing | Fix the question | Label "Change anything I got wrong"; note "Your version is kept beside what I read. Your photo stays as it is." | Use this question | Cancel | Label "Fix the words"; Hear this on the label |
| unreadable | I couldn't read this one | "That's the photo, not you. You can type the question, or take a clearer photo." | Type it | Take another photo | Same, with Hear this |
| confirmed | (existing help page) | Uses the confirmed or fixed text | — | — | — |
| parent view | (material page) | "✎ Fixed by [name] before help", with the original reading under "What the photo reading said"; or "✓ Checked by [name] before help" | — | — | — |
| error | Existing banner | "That didn't save. Your words are still here." The fix text is kept as a draft (round 1, step 2 rule) | Try again | — | — |
| saving | Button shows the existing working state; repeated taps are ignored (`data-submitting`) | — | — | — | — |

Long text: the question text wraps, with no truncation. The fix textarea grows to 3 rows, then scrolls. Cramped phones stack the buttons; ages 5–7 always stack.

## Accessibility and interaction spec

- **Keyboard order:** Back link → photo (not focusable; text alternative) → Read aloud → Yes, help me → Fix it → Take another photo. On opening `fixing`, focus moves to the textarea with the caret at the end. On Cancel, focus returns to "Fix it".
- **Targets:** at least 44 px; 64 px for ages 5–7 (existing band rule). Checked automatically at three widths.
- **Non-colour cues:**
  - the low-confidence note has a ⚠ symbol and a left border;
  - "Fixed" uses ✎ and "Checked" uses ✓, plus words.
- **Screen reader:**
  - the photo has `role="img"` with an `aria-label`;
  - the low-confidence note is `role="note"`;
  - a saved fix announces through the existing status region.
- **Reduced motion:** no new animation.
- **Reading:** Hear this reads the question; reading the question aloud is access support, recorded as in round 1, step 7.
- **Contrast:** existing tokens only. The yellow tint on the note keeps the body ink colour.
- **The 5–7 hidden `.fine` rule:** the low-confidence note is a separate class, so it stays visible for ages 5–7. The existing CSS hides `.fine` for that band.
- **No client framework:** plain forms with progressive enhancement, and it works without JavaScript. "Fix it" can be a link to `?fix=1` that renders the fixing state on the server.

## Handoff to M5 (implementation notes)

- **Routes:**
  - `GET /questions/:id/help` renders `to_confirm`, `unreadable` or `fixing` (with `?fix=1`) until the question is confirmed for the current revision.
  - `POST /questions/:id/confirm` takes `{choice: yes|fix, prompt?, sendId}`. Add `/confirm` to the student allow-list for questions.
- **Storage:** migration 023 adds `material_questions.confirmed_revision`, `child_prompt` (sealed through `FAMILY_FIELDS`, owner via the material) and `confirmed_by`.
- **Guidance:** the help job uses `child_prompt` when present. The original `prompt` is never modified.
- **Parent material page:** shows the Checked or Fixed tag and the original reading.
- **Tests:** one per WF-05 acceptance case (flows/WF-05.md), in unit, HTTP and four-browser runs.
