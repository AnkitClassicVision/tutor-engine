# TDD 5 — Engage

## Job

Items come from the concept and the Bloom level. The hint ladder is nudge, then partial, then worked. Paper sheets are machine-readable.

## Implementation criteria

- The same concept, level, and seed always returns the same item.
- Unlike-fraction Apply prompts are `Add a/b + c/d.` with different denominators. The stored answer is the simplified sum.
- Understand items put the real example on the letter that is the answer.
- Hint 1 and hint 2 do not contain the final answer. Hint 3 does, then asks for a parallel problem.
- A sheet stores the sheet id as the QR payload, four corner marks, and one answer box per item inside a letter page.
- The printed page shows the QR and the boxes. Scoring is per box against the stored key. A photo is stored locally and is not graded by a vendor.

## Test criteria

- `unlike-fraction items match an independent sum and the hint ladder hides then shows the answer`
- `a sheet carries its id, four corner marks, and one box per item inside the page`
- App test: the sheet page contains the sheet id, an SVG, and Box 1. Another parent gets 404.

## Out of scope

On-the-fly screen mini-apps. Camera alignment of a photographed sheet. Thermal receipt printers.
