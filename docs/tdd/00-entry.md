# TDD 0 — Entry

## Job

Every request is a target set on the concept graph. A dated target outranks the standing program until its date. After that date, the program is the focus again.

## Implementation criteria

- A student has one program target, created with the grade's concepts.
- A parent can add a dated target or a curiosity target.
- `activeFocus` returns the earliest open dated target, else the program, else curiosity.
- A target whose deadline is before today is ignored.
- Starting a session probes the focus closure and teaches failing foundations first.

## Test criteria

- `a 20-item mix is 60, 25, and 15, and a dated target outranks the program`
- App test creates a `program` row when a student is added.

## Out of scope

No separate "test mode" or "year mode" screen. Scope is only a target.
