# Attempts, Tries, Encounters & Progress — What Counts What

Four different "how many times did the user do this?" concepts live across
`submissions` and `problem_progress`. They sound interchangeable but measure
genuinely different things, and mixing them up produces subtle analytics/rating
bugs. This doc is the disambiguation reference.

TL;DR:

| Concept | Where | Grain | Counts what | Owner |
| --- | --- | --- | --- | --- |
| **`tries_used`** | `submissions` column | within one graded row | wrong tries burned *inside the trainer UI* before this final outcome | client (trainer) |
| **`attempt`** (a) | `submissions` column | within an encounter | this row's index among **logged rows** of the same encounter | DB trigger |
| **`encounter`** (k) | `submissions` column | per (user, problem) | which *sitting* on the problem this row belongs to | DB trigger |
| **`problem_progress`** counters | aggregate table | per (user, problem), all-time | rolling totals + SM-2 schedule, folded from every logged row | DB trigger |

The golden rule: **`tries_used` counts UI tries that never became rows; everything
else counts rows.** That's the whole distinction.

---

## 1. The core asymmetry: not every attempt is a row

In multi-try practice (`triesPerProblem > 1`), a wrong answer with tries remaining
does **not** write a submission. The trainer (`submitAnswer` in `PracticeView.svelte`)
increments an in-memory `triesUsed` counter and lets the user retry. Only the
**final** outcome of the sitting — the eventual correct answer, or the last wrong
answer once tries run out — is written via `recordSubmission`.

So one "wrong, wrong, right" sitting = **one row**, `is_correct = true`.

Everything that keys off rows (`attempt`, `encounter`, `problem_progress`, the rating
pipeline) therefore never sees the two intermediate misses. The only artifact of that
struggle is `tries_used = 2` on the single row we do write. This is deliberate — see §5.

---

## 2. `tries_used` — within-sitting UI tries (analytics only)

- **Column:** `submissions.tries_used integer not null default 0`
- **Set by:** the client (trainer), from its in-memory `triesUsed` at finalize.
- **Meaning:** number of wrong attempts the user burned *in the answer UI* before this
  recorded outcome. `0` = solved/answered on the first try.
- **Used by:** progress analytics only. `progress_breakdown.first_correct` counts
  `graded_seq = 1 AND is_correct AND tries_used = 0` — i.e. "nailed on the genuine
  first try." Without it, a wrong→right sitting looks identical to a clean solve
  (single `is_correct = true` row), which is exactly why first-try% used to equal
  eventual% for everyone.
- **Ignored by:** the rating pipeline and `handle_new_submission`. It is *not* a rating
  input; ratings key off `attempt`/`encounter` (see ratings.md §5).

Because it's client-sent, it is advisory — a "did they first-try it" annotation, not a
trusted rating signal. The trigger-owned columns below cannot be forged.

---

## 3. `attempt` and `encounter` — the rating structure (row-based)

Both are filled by the `set_submission_encounter` BEFORE-INSERT trigger
(`ratings.sql`, `security definer`), by looking at the **previous graded row** for the
same `(user, problem)`. Clients can't set them; whatever they send is overwritten.

### `encounter` (k) — which sitting

A 1-based index of *sittings* on a problem. A new encounter starts when there's no
prior graded row, or the gap since the last graded row exceeds `rating_params.encounter_gap`
(default **1800 s** = 30 min). Practicing a problem today and again next week → two
encounters (`k = 1`, then `k = 2`).

### `attempt` (a) — index within the encounter

A 1-based index of **logged rows** within the current encounter. Critically, this only
climbs above 1 when multiple *rows* exist for the pair in the same sitting — which, per
§1, the trainer normally never produces. In practice `attempt` is almost always `1`;
it goes higher only with re-practice inside the gap window or seeded/synthetic data.

> **`attempt` ≠ `tries_used`.** `attempt` counts rows across the encounter; `tries_used`
> counts UI tries inside a single row. A wrong→right sitting is `attempt = 1`,
> `tries_used = 2`. Overloading `attempt` to mean "UI tries" would corrupt the rating
> math, which uses `a` for its wrong-retry weight decay (`attempt_decay^(a-1)`).

`encounter_ms` (a third trigger column) is the cumulative graded time within the
encounter up to and including this row — the rating time-effort input, again row-based.

---

## 4. `problem_progress` — the all-time rolling aggregate

One row per `(user, problem)`, maintained by the `handle_new_submission` AFTER-INSERT
trigger. Its factual counters and SM-2 fields are **derived from the same logged
rows** — a folded summary, not an independent source of truth. The table can also
hold explicit `mastery` and `engagement` values set through narrow RPCs. Those
personal fields may create a row before any submission, so **row existence does
not mean seen; `times_seen > 0` does.**

| Column | Increments on | Notes |
| --- | --- | --- |
| `times_seen` | every submission | includes skips |
| `times_reviewed` | every graded (non-skip) row | the "attempts" people usually mean |
| `times_correct` | every correct graded row | |
| `times_skipped` | every skip | |
| `last_correct` | — | outcome of the **last** graded row |
| `ease_factor` / `repetitions` / `interval_days` / `next_review_at` | graded rows | SM-2 spaced-repetition schedule |
| `solved` | generated | `times_correct > 0` |
| `mastery` | user RPC | explicit self-assessment; never inferred from repetitions |
| `engagement` | user RPC | explicit next-step plan; never inferred from skips |

Because it folds the *same rows*, it inherits §1's blind spot: a wrong→right sitting
bumps `times_reviewed = 1, times_correct = 1` — indistinguishable from a clean first-try
solve. It also can't attribute anything to a date / topic / session (it's latest-state
only), so it can't back time-ranged or topic-sliced analytics. That's why first-try%
lives in the per-row `submissions` log + `tries_used`, **not** here.

---

## 5. Why `tries_used` exists at all (and isn't `attempt`)

When first-try% == eventual% was diagnosed, the fix could have gone two ways:

- **Route A — log every wrong try as its own row.** Then `attempt`, `problem_progress`,
  and the rating pipeline would all capture the struggle naturally, *for free*. But
  each logged miss becomes a **rated Glicko loss** and an extra SM-2 step, changing live
  ratings and needing a `recompute_ratings()`. The rating design deliberately assumes
  the log holds only final outcomes (ratings.md §5/§9: a recorded miss is a *decisive*
  loss at `a = 1`, `retry_weight = 1.1`).
- **Route B — keep one row per problem; annotate it.** Chosen. The first-try fact then
  has exactly one place to live: a field on the single row. That field is `tries_used`.
  Ratings and SM-2 are untouched; the rating docs' "intermediate retries never reach the
  submission log" stays true.

So `tries_used` is not redundant with `attempt`: `attempt` is the rating system's
cross-row structure (and stays `1` under Route B), while `tries_used` is the
within-sitting counter that Route B deliberately keeps *out* of the row stream.

---

## 6. Worked example — one "wrong, wrong, right" sitting

`triesPerProblem = 3`, user misses twice then solves, all within 30 min:

```
submissions:  1 row   { is_correct = true, tries_used = 2, encounter = 1, attempt = 1 }

progress_breakdown (this problem):
  graded         = 1
  correct        = 1     → eventual accuracy 100%
  first_graded   = 1
  first_correct  = 0     (is_correct but tries_used ≠ 0) → first-try 0%   ← the fix

problem_progress:  times_reviewed = 1, times_correct = 1, solved = true
ratings:           one match, a decisive WIN at attempt a = 1 (the two misses are invisible)
```

Contrast the same three attempts under **Route A** (not what we do): 3 rows,
`attempt` 1→2→3, two rated losses then a win, `times_reviewed = 3`.

---

## 7. `answer` — the persisted free-text response

- **Column:** `submissions.answer text` (null for MCQ, whose choice is in
  `selected_choice`, and for skips).
- **What it's for:** free-response / computational problems are graded **lexically**
  by `answersMatch` (`src/lib/utils/answer-matcher.ts`) — it strips unit labels and
  normalizes LaTeX/whitespace/decimals — because a stored correct answer often
  carries a label (e.g. `"8 pies"`, `"19 cm"`) the solver won't retype. Persisting
  the raw response keeps a graded answer **auditable and re-gradable**: a later
  grading change can re-run `answersMatch` over stored answers and
  `recompute_ratings()` to repair `is_correct`. It also lets the deferred-grading
  Test **results screen show what was typed** after a reload (the review UI can't
  infer it otherwise).
- **Grading parity:** live practice (`submitAnswer`) and deferred Test grading
  (`testOutcome`/`applyTestOutcome`, `src/routes/(app)/practice/test-state.ts`) use
  the **same** `answersMatch`. (Historically the Test path used raw `===`, which
  marked label-carrying answers wrong.)

> **Historical caveat:** submissions recorded **before** this column existed have no
> stored `answer`, and Test grades written before the `answersMatch` fix used exact
> string equality. Those rows (and any rating/`problem_progress` they fed) can't be
> cleanly re-graded — the typed answer is gone — so they're left as-is.

---

## See also

- **`docs/ratings.md`** — the rating pipeline; `attempt`/`encounter`/`encounter_ms` as
  rating inputs (§4–§5), and why the log is final-outcome-only (§9).
- **`supabase/schemas/submissions.sql`** — `submissions` + `problem_progress` +
  `handle_new_submission`.
- **`supabase/schemas/progress_analytics.sql`** — `submission_facts` view +
  `progress_breakdown` RPC that consume `tries_used` and `graded_seq`.
