# Product

<!-- impeccable:product-schema 1 -->

## Platform

web (server-rendered HTML, progressive enhancement, no client framework). Children use phones, tablets and laptops in equal measure (owner, 2026-10-17); every child screen must work by touch and by keyboard at all three sizes.

## Users

- **Children aged 5–14** doing short practice missions at home, alone or beside a parent. Three age bands: 5–7 (questions read aloud, large answer tiles), 8–10, 11–14 (calmer, denser). Many cannot read long instructions; all get bored by clutter.
- **Parents** setting up classes and school context, connecting their own AI account, reading how learning is going, leaving notes, and deciding what comes next. Often on a phone, in short bursts, sometimes with the child beside them on the same device.

Both surfaces matter equally (owner, 2026-10-17).

## Product Purpose

An adaptive tutor that turns a child's real school context (classes, homework photos, test dates, teacher scores) into short missions, and counts a skill as learned only from fresh independent evidence. Success: the child finishes missions and remembers topics a week later; the parent knows in one glance what happened and what needs them.

## Positioning

- Evidence-honest: help, hints and guided steps never count as mastery; parents see the difference.
- Parent's own AI: families connect their own provider (OpenRouter, API key, later their ChatGPT plan); nothing is resold.
- School-shaped: practice follows the child's actual classes, photos and dates, not a generic curriculum alone.

## Core flows (must survive any redesign)

Child: home → today's mission (lesson card, guided, faded, independent, review beats) → answer / hint / "show me how" / read aloud / microphone → feedback and checkpoints → what's next. Topics map with evidence per topic. Schoolwork photos. A review question while new work is prepared.
Parent: one-screen overview (this week, what's next, what needs you, one action) → classes, school results, note, controls, numbers/measures, planner drawer (conversation that proposes changes, applied only on explicit Apply), AI connection, family export and deletion. Parent area is locked behind the parent password when a child is at the device.

## Constraints

- Strict CSP: no inline scripts or inline style attributes from scripts; assets self-hosted.
- WCAG 2 AA with axe audits in the browser suite; reduced-motion respected; 44px+ touch targets (64px for ages 5–7).
- No real learner data in mockups; use synthetic names.

## Brand commitments

None binding. The name "bubble", the mascot and the missions vocabulary are all open to change (owner, 2026-10-17).
