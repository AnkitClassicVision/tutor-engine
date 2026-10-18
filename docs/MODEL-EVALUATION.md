# Evaluating AI grading quality

A new [100-case synthetic review pack](../eval/review-pack/README.md) is ready for human review, with an offline review studio and eight synthetic page images. Its cases are deliberately **not pre-approved**. Corpus approval and subsequent model-output review are separate steps. It does not establish the release gate.

Browser tests use deterministic responses and do not establish model quality. To evaluate a model, select a bounded set of supported provider/model presets, collect at least 100 hand-checked cases per preset, and run:

```bash
TUTOR_EVAL_PROVIDER=openai TUTOR_EVAL_MODEL=YOUR_MODEL TUTOR_EVAL_KEY=YOUR_KEY npm run evaluate:model -- /private/hand-checked.jsonl
```

Keep real child work and image paths out of Git. Store actual child-work corpora privately; only the original synthetic review pack is checked into this repository. Each JSONL entry requires `kind` and `handChecked: true`.

Grading, `higher_bloom`, and `answer_key` cases require `input: {concept, bloomLevel, prompt, key, response}` and `expectedCorrect` (boolean, or null when a key is invalid/uncertain). For `extraction` and `unreadable`, supply `imagePath`, `mime`, and offered `concepts: [{id,title}]`; extraction also requires `expectedQuestions: [{number,prompt,visibleWork}]`. Explanation cases supply `input` and need a separate human substance review. Compare extraction semantically during human review; the runner's exact transcription match is a strict diagnostic, not a substitute for that review.

The runner records counts and verdict agreement without retaining images, answers, or credentials in the report. A release signoff must establish at least 95% grading agreement, zero automatic judgments of deliberately unreadable work, correct answer keys, and sound explanations and higher-level reasoning. `gatePassed` remains false until human reviewers sign off; the runner cannot certify its own explanation quality.

Include mixed ability across topics, advanced placement, prerequisite gaps, ambiguous errors, supported corrections, repeated prompts, delayed misses, short sessions, save/resume and provider recovery in the reviewed corpus. The synthetic adaptive tests establish engine behavior only.
