# TDD 6 — Assess

## Job

A level is mastered only after three successes, on two sessions, on two days, with at least one interleaved success, and at most one hint on each counted success.

## Implementation criteria

- Successes with two or more hints do not count.
- Three successes on one day do not count.
- Three successes with no interleaved item do not count.
- Declared mastery sets bloom to that level and mastery to 1.
- A later miss keeps the bloom level, sets status to review due, and keeps mastery at or above 0.4.
- Three sessions in a row under 70 percent set status to stuck.
- Evaluate successes are recorded only when the parent marks the explain-back as a real success.

## Test criteria

- `mastery needs three counted successes, two sessions, two days, and one mix`
- `a miss after mastery returns the concept to review and does not zero it`
- `three weak sessions mark the concept stuck`

## Out of scope

Camera scoring of handwritten process. Fluency compared with a personal baseline beyond the time field already stored on each attempt.
