# TDD 4 — Select

## Job

The session mix stays near 60 percent frontier, 25 percent review, and 15 percent stretch. The rolling last six items move difficulty. The session stops at the attention cap.

## Implementation criteria

- `mixCounts(20)` is 12 frontier, 5 review, 3 stretch.
- A 12-item queue is 3 warmup review items, 7 frontier items, and 2 interleaved stretch items.
- At least 90 percent on the last six steps up. From 70 up to but not including 90 holds. Below 70 steps down.
- The third step-down in a row changes modality: paper, then voice, then screen.
- Time over twice the student's median, or a frustration flag, opens the hint path and a two-minute break.
- Reaching the cap ends the session even if the last six were perfect.
- Fewer than six scored items holds, unless the cap or the slow-item rule fires.

## Test criteria

- `thermostat holds the 85 percent band and stops at the attention cap`
- `a 20-item mix is 60, 25, and 15, and a dated target outranks the program`
- App test: a session older than its cap ends with reason `attention` and does not take another score.

## Out of scope

A live camera reading stuck, erasing, or off-task. The frustration flag is the stand-in.
