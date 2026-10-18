# TDD 2 — Curriculum

## Job

The unit is the concept. v1 ships one Common Core math backbone, grades 4 through Algebra, with prerequisite edges.

## Implementation criteria

- `src/data/math-backbone.json` is the pack. Titles are original short phrases.
- Loading the pack rejects a missing prerequisite, a duplicate id, or a cycle.
- Prerequisite closure includes the roots and returns foundations first.
- Probe returns at most three failing nodes in that order. Mastered nodes are skipped.

## Test criteria

- `backbone is one acyclic math graph and polynomials rest on fraction foundations`
- `probe teaches at most three failing foundations, not a mastered prerequisite`

## Out of scope

Syllabus photo ingest. Live homework camera mapping. A science pack. Georgia standards text. Those stay a pack swap, not a new loop.
