# Teaching review pack

Open [review.html](review.html) in a browser. It works offline with the adjacent `images` folder. The 100 cases and eight page images are synthetic. **None are human-approved yet.** This is test material, not model training or proof of learning gains.

The pack includes 64 grading cases, 12 higher-demand cases, eight answer-key checks, eight coaching/explanation cases, four readable pages and four deliberately unreadable pages. It spans math, reading and science with equivalent wording, short answers, explicit steps, hidden criteria, faulty keys, unsupported higher Bloom labels and instruction injection. The supplied expectations are proposals for independent review. This bounded sample is not a comprehensive curriculum or safety benchmark.

1. Inspect each prompt, response, proposed key and rationale. Recalculate keys yourself; compare photo cases directly with their images.
2. Correct mistakes with **Correct this case before approving**. Saving a correction removes approval. Use **Needs revision** when a case cannot be fairly judged.
3. Check the confirmation and approve only after reviewing it. Browser storage keeps progress when available. **Export review progress** regularly; import that file on another device to continue.
4. Put the exported `reviewed-cases.jsonl` beside the `images` folder. The evaluator rejects a corpus with fewer than 100 approved cases. Image paths resolve relative to the corpus file.
5. Evaluate each approved preset and separately review its actual keys, feedback and explanations. Corpus approval alone cannot pass the release gate. See [the model evaluation guide](../../docs/MODEL-EVALUATION.md).

No inference is triggered by opening the reviewer. Exported notes stay local; keep any reviewer identities or real learner information out of Git and board receipts. Local storage is convenience storage, not a backup. The generated page embeds the corpus so file access does not require a local server.

To rebuild the reviewer after editing the synthetic corpus or template:

```sh
node scripts/build-review-pack.mjs
```

The separate [journey checks](journey-checks.md) cover engine behavior and recovery. They do not inflate the 100 model-case count. Recorded automated map checks are in `test/strengths.test.ts`, `test/browser/strengths.spec.ts` and `test/hosted/strengths.spec.ts`.
