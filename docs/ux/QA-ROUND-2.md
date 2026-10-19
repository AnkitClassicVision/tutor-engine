# QA round 2: prompt 6 output

Prompt: [AGENT-PROMPTS.md](AGENT-PROMPTS.md) §6, Independent QA and evidence judge. Process step: UX-10. The reviewer was an AI reviewer that did not write the work under review and could not edit it. Scope: round 2 (M1–M5) on private main, 2026-10-19. **Code, unit and browser evidence only. No child usability or learning claims.**

## Passes

| Pass | Commit reviewed | Decision | Main findings |
|---|---|---|---|
| 1 | fb28052 (WF-05 build) and the M1–M4 documents | REVISE | High: the low-confidence warning could never appear, because a reading under 0.8 was already marked unreadable. Medium: the question could change after help began; a parent's check was labelled as the child's; browser tests covered case 1 only. Low: guide job did not check confirmation; edited migration 022 (safe: production at 21); extra fields sent to the model; autofocus and a short back link; old help would be asked again after deploy. Docs: two flow contracts lacked recovery sections; one mis-citation. |
| 2 | 7c8b7f8 (fixes for pass 1) | REVISE (narrow) | 8 of 9 fixed. New medium: "Hear this" was silent on the 5–7 edit screens. Low: legacy help credited to the child; an unchanged uncertain reading labelled "Fixed"; a mis-citation left in WF-07.md. |
| 3 | 6a1cf73 (fixes for pass 2) | **LIMITED PILOT** for the WF-05 slice, our own family under M7, once the owner says yes | A–D pass. New low: on the unreadable screen for ages 5–7, Hear this had nothing to read. Fixed after the pass: it now reads the box's label (browser test, four browsers, 20/20 with the device specs). |

## Evidence at the final commit

| Check | Result |
|---|---|
| Typecheck | clean |
| Unit suite | 356 pass, 0 fail (2 cloud tests skipped, no Postgres connection) |
| Full four-browser suite at 7c8b7f8 (chromium, firefox, webkit, mobile-chromium) | 196 / 196 |
| homework-confirm, journey and devices specs at 6a1cf73, four browsers | 56 / 56 |
| Production migrations (counts only) | max 21, count 21: migration 022 is unapplied everywhere |

## WF-05-A cases

| Case | Status | Evidence |
|---|---|---|
| 1 Clear question | PASS | HTTP test; browser test in student mode |
| 2 Uncertain fraction | PASS | HTTP test with realistic confidence (0.6 and 0.85); browser test, pre-filled and fixed |
| 3 Several questions | PASS (weak) | HTTP test: others still ask after one is confirmed |
| 4 Unreadable | PASS | HTTP and browser |
| 5 Repeated Yes | PASS for sequential taps | HTTP test; simultaneous taps rely on the write lock and are untested |
| 6 New reading asks again | PASS | HTTP test (revision bump simulated) |
| 7 Sibling and other family | PASS | HTTP test: 403 in student mode, not found for another family |
| 8 Camera permission reversed | PASS (existing test) | `devices.spec.ts`, run in the 56/56 set |
| 9 Interrupted upload | PASS (existing test) | `recovery.spec.ts`, in the 196/196 run |
| 10 Ages 5–7 | PASS | Browser test: measured 64 px targets, one decision, and Hear this reading the edited words |

## Known limits

- Simultaneous confirmations are not tested.
- Read-aloud on homework pages is not recorded as access support (homework help is already supported evidence).
- Tablet size and a keyboard-only journey are untested.
- No child has used this screen (M7).

## Release judge output (pass 3)

**Decision: LIMITED PILOT** for round 2's slice (WF-05 confirm before help). Limited to our own family, through the M7 family sessions.

**Reasons:** no open blocker, high or medium defect. Verified in code and tests:
- help is blocked until the question is confirmed;
- the child's text is sealed and the original reading is kept;
- other learners' questions are out of reach;
- page output is escaped.

**Still required:**
- the owner's yes, which also covers the round 1 release (M0);
- migration 022 applying on Postgres at deploy.

**Not supported by this evidence:** child usability, whether children catch misreadings, any learning effect, tablet use, keyboard-only use.

**Re-check if:** the confirm route, the read-aloud script, the confidence rule, sealing or the guide prompt changes.
