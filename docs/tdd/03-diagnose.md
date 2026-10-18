# TDD 3 — Diagnose

## Job

Name the error, then pick the corrective. "Wrong, try again" is not a corrective.

## Implementation criteria

- A blank or "I forgot" is a retrieval gap.
- The same wrong answer seen before is a misconception.
- A slow miss late in the session is attention.
- A long wrong response is decoding.
- Any other miss is a procedural slip.
- Each error type has a label and a move that does not reveal the answer key.

## Test criteria

- `scoring accepts equivalent rationals and a blank is not a guess` covers the blank path.
- The session page shows the corrective label and move after a miss.

## Out of scope

Voice identification of who is at the desk. A two-minute oral warm-up judged by a live model.
