# TDD 7 — Reflect and the parent scoreboard

## Job

The student answers three recap prompts. The parent sees a weekly scoreboard, not a daily feed.

## Implementation criteria

The scoreboard computes:

- Concepts mastered this week, by Bloom level
- Frontier, the next level and status
- Retention at 7 days and at 30 days
- Just-right ratio: share of items whose trailing six sit from 70 percent up to but not including 90 percent
- Days from the first attempt to mastery
- Error-type counts for the week
- Stuck concepts and the latest error type

A recap requires all three prompts. Saving it ends the session and opens tomorrow's sheet.

## Test criteria

- `the weekly scoreboard reports the six parent metrics` checks mastered-this-week, both retention windows, a numeric just-right ratio, time-to-mastery, the error trend, stuck, and frontier.

## Out of scope

A voice transcript of the recap. Email delivery of the Sunday scoreboard.
