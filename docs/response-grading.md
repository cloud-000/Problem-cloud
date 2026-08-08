# Problem Responses & Grading

Authoritative implementation plan for distinguishing what a problem asks the
student to submit from whether a reference answer is expected. This document tracks
the rollout across sessions.

The declarative schema remains the source of truth for storage and triggers. Keep
this document synchronized with changes to `supabase/schemas/problems.sql`,
`supabase/schemas/submissions.sql`, and the trainer.

## 1. Status

**Current phase:** design complete; implementation has not started.

The content layer already carries `response_kind` and `answer_status`, including
proof declarations from the scraper. The application layer does not consume either
field: it still derives input and grading behavior from `choices` and
`answer_index`.

Local database snapshot on 2026-08-07:

| Data | Count | Notes |
| --- | ---: | --- |
| Tests with `response_kind = 'proof'` | 55 | All have `answer_status = 'not_applicable'` |
| Problems with `response_kind = 'proof'` | 199 | All have statements and no lexical answer key |
| Other `not_applicable` problems with a null response kind | 89 | Must not be guessed to be proofs without source evidence |
| Proof problems currently eligible for Test format | 0 | Current eligibility requires choices plus a valid `answer_index` |

The test-level missing-answer cache is the one existing consumer of the new
semantics: `recalculate_test_answers` correctly excludes
`answer_status = 'not_applicable'`. All 55 explicitly declared proof tests therefore
have `missing_answers_count = 0`.

## 2. The model

The current feature needs two content concepts and one submission-outcome helper. Do
not add a new answer type or a grading lifecycle yet.

### 2.1 Response kind

`response_kind` says what the student is asked to submit:

```ts
type ResponseKind =
    | "mcq"
    | "short_answer"
    | "proof"
    | "construction"
    | "estimation"
    | "interactive"
    | "unknown";
```

The problem-level value is authoritative at runtime. The test-level value is a source
declaration/default from which the scraper resolves each problem. A test can contain
problem-level overrides, so the UI must not assume every problem has the test's
response kind.

### 2.2 Answer status

`answer_status` explains whether a reference answer exists or should exist:

```ts
type AnswerStatus =
    | "known"
    | "source_missing"
    | "not_applicable"
    | "needs_review";
```

- `known`: a usable answer key is available.
- `source_missing`: an answer should exist, but the source/import does not have it.
- `not_applicable`: the response does not have a short answer key, such as a proof.
- `needs_review`: imported answer coverage is ambiguous and needs curation.

`answer_index < 0` only shows that no comparable key is stored. It does not explain
why, so it cannot replace `answer_status` in user-facing behavior.

### 2.3 Submission outcome

The existing `skipped` and nullable `is_correct` columns already represent the
four outcomes needed now:

| Outcome | `skipped` | `is_correct` |
| --- | ---: | ---: |
| Skipped | `true` | `null` |
| Ungraded | `false` | `null` |
| Correct | `false` | `true` |
| Incorrect | `false` | `false` |

Use one pure helper to resolve this table wherever an outcome is displayed or folded.
Do not rely on boolean truthiness: `null` is ungraded, not incorrect.

No `grading_status`, `grading_method`, or evaluation table is required for this
phase. Those should be designed only when an asynchronous or manual grader is being
implemented.

## 3. Current bugs

The present `choices`/`answer_index` inference causes these concrete failures:

- A proof displays **Answer unavailable**, even though no short answer should exist.
- Proofs are excluded from normal practice by the default "with answer" filter.
- Every proof is dropped from Test-format sessions by lexical-key eligibility.
- The "Without answer (help answer it)" pool includes intentional no-key problems.
- A submitted ungraded response uses `is_correct = null`, but
  `handle_new_submission` coalesces it to false and advances SM-2 as incorrect.
- Results and historical review fall through from null correctness to **Incorrect**.

The rating pipeline already does the right thing: skips and null `is_correct`
submissions are not rated. Progress, results, and session aggregates must use the
same distinction.

## 4. Hard invariants

These rules require regression tests at every affected layer:

1. **Ungraded is not incorrect.** Only a non-null `is_correct` contributes a correct
   or incorrect result.
2. **Missing is not inapplicable.** Only `source_missing` and `needs_review` belong
   in missing-answer/contribution flows.
3. **Response kind controls input.** A proof receives multiline capture even when no
   grader exists.
4. **Problem metadata controls runtime behavior.** Test metadata is a
   declaration/default, not a blanket runtime assumption.
5. **Fixed tests never silently lose problems.** Unsupported capture or grading must
   be shown explicitly.
6. **Ungraded submissions do not change SM-2 or ratings.** They may count as seen,
   but not reviewed, correct, incorrect, or scheduled.
7. **Replays match live behavior.** Change the live progress trigger and
   `recompute_problem_progress` together.
8. **The scraper owns classification.** Runtime fallbacks preserve legacy usability
   but never write guessed metadata back to content.

## 5. Target behavior

| Response kind | Initial input | Initial grading | Reference-answer behavior |
| --- | --- | --- | --- |
| `mcq` | Existing choice picker | Choice key | Expected when `known` |
| `short_answer` | Existing single-line math input | Normalized `answersMatch` | Expected when `known` |
| `proof` | Multiline text/LaTeX editor | Ungraded | Normally `not_applicable` |
| `estimation` | Numeric-style input | Ungraded until tolerance metadata exists | Do not treat exact text as sufficient |
| `construction` | Explicit unsupported-response surface | Ungraded/unsupported | Evaluator-dependent |
| `interactive` | Explicit unsupported-response surface | Ungraded/unsupported | Interaction-dependent |
| `unknown` | Legacy inference, otherwise generic text | Grade only with a valid key | Preserve ambiguity |

Until proof grading exists, a submitted proof is completed but ungraded. It may
increment `times_seen`, but it does not increment `times_reviewed`, set
`last_correct`, change SM-2, or enter Glicko.

## 6. Small domain helper module

Create one pure module with plain functions. Avoid classes, stores, registries, or a
configurable grading framework.

The module should own:

```ts
resolveResponseKind(problem): ResponseKind
inputModeFor(kind): "choice" | "short-text" | "long-text" | "unsupported"
hasComparableAnswer(problem): boolean
isReferenceAnswerMissing(problem): boolean
submissionOutcome(submission): "correct" | "incorrect" | "ungraded" | "skipped"
```

Legacy response-kind resolution:

1. Use a valid non-null problem `response_kind`.
2. Otherwise infer `mcq` from more than one choice.
3. Otherwise infer `short_answer` from exactly one choice.
4. Otherwise return `unknown`.

Do not infer `proof` merely from `answer_status = 'not_applicable'`. The 89
currently untyped rows need scraper/source investigation or an explicit declaration.

Use these helpers in:

- Trainer query filters and post-query eligibility
- Fixed Test-format loading
- `PracticeView` input and immediate grading
- `Problem` / `ProblemAnswer`
- Problem badges and reporting affordances
- Test results and historical review

The existing `isMultipleChoice()` remains the safety gate for displaying the
overloaded `choices` array until answer storage is normalized. The new helper module
should call it rather than reproduce its logic.

## 7. Progress and database behavior

No new submission columns are needed now. Correct the existing fold:

```text
if skipped:
    increment seen and skipped
else if is_correct is null:
    increment seen only
else:
    increment seen and reviewed
    apply correct/incorrect counters and SM-2
```

The same three-way branch must be applied to:

- `handle_new_submission`
- Practice-session aggregate updates
- `recompute_problem_progress`
- Analytics that equate every non-skip with a graded response

Update the `submissions.is_correct` schema comment to state that null means ungraded,
including skips, rather than claiming it only means skipped.

The ratings pipeline already excludes null correctness. Preserve that behavior and
add a regression test proving an ungraded non-skip creates no rating/history row.

## 8. Filtering and fixed-test eligibility

Replace answer-index-based coverage semantics:

- **With reference answer:** `answer_status = 'known'` plus a usable comparable key.
- **Missing reference answer:** `answer_status in ('source_missing', 'needs_review')`.
- **Not applicable:** excluded from the missing-answer contribution pool.
- **Any:** no answer-status restriction.

Rename **Answer availability** if necessary so the UI clearly refers to reference
answer coverage, not whether the student can respond.

Test-format loading must retain every problem with a usable statement:

- Supported input: render the appropriate response control.
- Unsupported input: render the problem plus a clear unsupported-response state.
- Unsupported grading: store a supported response as ungraded.

Never shorten a fixed test because a problem has no `choices` or
`answer_index`.

## 9. UI and results

- Display response-kind badges where useful, especially Proof and unsupported kinds.
- Hide **Answer unavailable** when `answer_status = 'not_applicable'`.
- Show answer-contribution/report affordances only for `source_missing` or
  `needs_review`.
- Give proofs a multiline editor suitable for prose and LaTeX.
- Persist proof text in the existing `submissions.answer text` column.
- Display ungraded responses with a neutral/unsure treatment, never red Incorrect.
- Preserve the stored proof response in historical review.

Test summaries must account for every problem, for example:

```text
18 correct · 3 incorrect · 4 submitted, ungraded · 1 skipped
```

Do not label `correct / total problems` as accuracy when some problems were not
evaluated.

## 10. Data coverage

The scraper/content sync already transports both metadata fields. Complete coverage
without inventing classifications:

- Populate `mcq` and `short_answer` where source structure establishes them.
- Resolve test declarations into per-problem kinds while preserving overrides.
- Investigate the 89 `not_applicable` problems with null response kinds.
- Preserve `unknown` when evidence is insufficient.
- Recalculate test answer caches after backfill.

Database `CHECK` constraints generate `string | null` TypeScript fields. Narrow
them through app-level parsers/constants at the domain boundary. Regenerate
`src/lib/types/database.types.ts` with the Supabase CLI after schema changes; never
edit it by hand.

## 11. Implementation phases

### Phase 1 — response domain and data coverage

- [ ] Add app-level `ResponseKind` and `AnswerStatus` constants/types.
- [ ] Implement the small pure helper module.
- [ ] Test valid values, invalid values, legacy inference, and every outcome.
- [ ] Add response metadata to read models/projections that need it.
- [ ] Complete scraper classification/backfill rules.
- [ ] Investigate or explicitly preserve the 89 ambiguous rows.

### Phase 2 — ungraded progress correctness

- [ ] Fix `handle_new_submission` for non-skipped null outcomes.
- [ ] Fix practice-session aggregate updates.
- [ ] Fix `recompute_problem_progress` in the same change.
- [ ] Align affected analytics.
- [ ] Update schema comments and rating regression coverage.
- [ ] Generate the migration and regenerate database types through the Supabase CLI.
- [ ] Verify live/replay parity.

### Phase 3 — trainer, UI, and results

- [ ] Replace answer-index-based availability filtering with `answer_status`.
- [ ] Exclude `not_applicable` from answer-contribution flows.
- [ ] Retain proofs and unsupported kinds in fixed Test loading.
- [ ] Route `ProblemAnswer` through the response helpers.
- [ ] Add the proof multiline editor.
- [ ] Define explicit initial handling for estimation, construction, interactive,
      and unknown.
- [ ] Persist proof text as an ungraded response.
- [ ] Add neutral ungraded states to results, history, and summaries.
- [ ] Add trainer-level mixed-response tests.

### Deferred — AI/manual evaluation

Do not build evaluation infrastructure during Phases 1–3. When proof grading is an
active feature, separately design:

- pending/failure/re-grade states
- evaluation provenance, model, rubric, score, and feedback
- an append-only evaluation record if re-grading/audit requires it
- idempotent progress finalization
- partial-credit behavior in mastery, SM-2, and Glicko

At that point, decide whether submissions need a cached evaluation status. Do not add
both submission lifecycle columns and an evaluation table without a concrete query or
consistency requirement.

## 12. Verification gates

Each implementation phase must finish with:

- `bun run check`
- `bun test`
- Svelte MCP autofixer clean for every changed Svelte file
- Live/replay parity for trigger-owned aggregates
- Regression coverage that an ungraded non-skip is neither incorrect nor rated
- Regression coverage that a proof test retains all its problems
- Regression coverage that `not_applicable` never displays as missing
- A mixed test containing MCQ, short-answer, proof, and an unsupported kind

## 13. Product decisions

The implementation uses these defaults unless product direction changes:

- A proof may be submitted before AI grading exists and is completed but ungraded.
- Ungraded work counts as seen, not reviewed, correct, incorrect, scheduled, or rated.
- Unsupported response kinds stay visible instead of being silently removed.
- `response_kind` controls input; it does not permanently select one evaluator.
- `answer_status` controls reference-answer messaging and contribution flows.

## 14. Current checkpoint

Investigation and the simplified design are complete. No implementation schemas or
application files have changed yet.

The next session should begin with **Phase 1 only**. Re-read the actual schema and
trainer code before editing because file locations and behavior may have moved since
this investigation.

