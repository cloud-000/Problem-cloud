# Skill Ratings — Live Per-Submission Glicko (v3)

Reference for the player/problem rating system. Source of truth is
`supabase/schemas/ratings.sql` (declarative); this doc explains **what it does, why,
and how to change it**. If you edit the SQL, update this file.

---

## 1. Concept

Every **player** and every **problem** is a Glicko competitor with a rating `R` and a
rating deviation `RD` (uncertainty). Every graded submission is a **match**: correct =
the player beat the problem, incorrect = the problem beat the player. Problem difficulty
is **not authored** — it emerges entirely from play. Everyone seeds at `R = 1500`,
`RD = 350`.

This is **Glicko-1 run with one-match periods** — the way live chess servers run it.
There are no rating-period buckets: both sides of a match update immediately off each
other's current `(R, RD)`, and staleness is continuous (`RD² += c²·Δt`, with Δt in
`period_seconds` units, applied lazily before a match).

**Ratings update live.** An `AFTER INSERT` trigger on `submissions`
(`handle_submission_rating`) rates each graded submission as it lands. The batch
`recompute_ratings()` survives as the **repair/retune path**: it replays the exact same
fold over the submission log, in `(created_at, id)` order, with identical math and
quantization — so *live state ≡ full rebuild, exactly* (verified to 0 difference, §6).
Nothing is stored that the replay cannot reconstruct.

### v2 → v3: what changed and why

v2 graded whole **encounters** (a sitting on a problem) in weekly batch periods. That
blocked live updates: an encounter stays "open" for `encounter_gap` after each attempt,
so its grade wasn't final at insert time. v3 dissolves this:

- **Each submission is its own match**, final at insert. The encounter structure
  survives as *annotations* (`k`, `a`, cumulative time — all known at insert time) and
  as match **weights**, not as a mutable grade.
- **Attempt effort moved from the score into the weight.** A wrong answer weighs
  `retry_weight · attempt_decay^(a−1)`. The trainer logs only a problem's *final* outcome
  (intermediate retries never reach the submission log), so a recorded miss is a decisive
  loss at `a=1`; `retry_weight` is **1.1** so a miss counts at least as much as a win (§5).
  `attempt_decay` only bites the rare multiple-recorded-miss case (e.g. the synthetic seed).
  (The within-sitting UI tries that *don't* become rows are captured separately by the
  analytics-only `submissions.tries_used` — **not** a rating input. See
  [`docs/attempt-concepts.md`](./attempt-concepts.md) for `tries_used` vs `attempt`/`encounter`.)
- **The time normalizer is causal.** v2 used the all-time median solve time (future data
  grading past attempts); v3 keeps a per-problem running EWMA of `ln(solve time)` —
  `exp(ln_time_ewma)` tracks the geometric-mean solve time, O(1) state, updated on each
  resolving solve.
- **The MCQ guess guard is weight-based and symmetric.** Any sub-`guess_floor_ms` MCQ
  attempt has its weight scaled by `clamp(elapsed/floor, 0.1, 1)` — wins *and* losses.
  This replaces v2's miscalibrated chars-per-second read floor (LaTeX inflated the char
  counts) and its asymmetry (v2 only guarded fast wins).

Intentional semantic shifts vs v2 (all deliberate, see plan/verification):

- A recorded miss is a **decisive** loss (weight `retry_weight` = 1.1) — since the trainer
  logs only final outcomes, a logged wrong answer means the problem beat you, so it is not
  discounted. (Originally a soft 0.3 loss; changed 2026-07-08 — see §9.)
- Multi-attempt encounters carry slightly more total weight (more attempts = more
  evidence).
- Results are order-dependent (sequential per-match updates). Fine for a practice app.
- **Ungraded attempts (`is_correct` null, e.g. answerless problems) are never rated.**
  v2 counted them as losses via a `coalesce` — under live ratings that would visibly
  penalize attempting an ungradeable problem, so v3 excludes them (annotated, not rated).

---

## 2. Signals used (and ignored)

| Signal | Source | Used? | How |
| --- | --- | --- | --- |
| Correct / incorrect | `submissions.is_correct` | ✅ | the outcome; `null` (ungraded) = not a match |
| Attempt index in encounter | `submissions.attempt` (trigger-derived) | ✅ | decays wrong-attempt weight |
| Cumulative encounter time | `submissions.encounter_ms` (trigger-derived) | ✅ | time effort `ε_t`, vs the problem's EWMA solve time |
| This attempt's time | `submissions.elapsed_ms` | ✅ | the guess guard (weight scale under the floor) |
| Encounter index | `submissions.encounter` (trigger-derived) | ✅ | repeat decay `repeat_decay^(k−1)` |
| Wall-clock idle time | `*_ratings.last_match_at` | ✅ | continuous RD inflation |
| Skips | `submissions.skipped` | ❌ | excluded (annotations nulled) |
| Attempts after a solve | derived | ❌ | same-encounter post-solve attempts are not rated |
| Selected choice / partial credit | `submissions.selected_choice` | ❌ | only the boolean matters |
| MCQ vs free-response | `problems.choices` | ✅ (guard only) | gates the fast-guess weight scale |

> `problem_progress` (SM-2 spaced repetition) is a **separate** consumer of the
> submission log (`supabase/schemas/submissions.sql`); it governs review scheduling.
> The two triggers are independent.

---

## 3. Storage

All world-readable; clients never write (only `service_role` and the security-definer
triggers/recompute do). RLS mirrors `problems`/`profiles`.

| Table | Grain | Key columns |
| --- | --- | --- |
| `player_ratings` | one row per (user, scope) | `rating`, `rd`, `matches`, `last_match_at` |
| `problem_ratings` | one row per (problem, scope) | `rating`, `rd`, `attempts`, `last_match_at` |
| `problem_rating_stats` | one row per problem | `solve_count`, `ln_time_ewma` (the causal time normalizer) |
| `rating_params` | single row | every tuning knob (§5) |
| `player_rating_history` / `problem_rating_history` | one row per rated match per side | `at`, `rating`, `rd`, `submission_id` |
| `submissions.encounter/attempt/encounter_ms` | per graded submission | trigger-derived annotations (not client-writable) |

A player's rating row is created by their **first graded submission** (no more "no
rating until a recompute runs"). `scope` is `'overall'` today; per-topic scopes remain
an additive future change. History is appended per match live and rewritten identically
by a rebuild.

---

## 4. Pipeline

### 4a. Annotation (`set_submission_encounter`, BEFORE INSERT)

For each non-skip submission, one indexed lookup of the previous graded row on the
`(user, problem)` pair decides: gap > `encounter_gap` → new encounter (`k+1`, `a=1`,
`encounter_ms = elapsed`); else same encounter (`a+1`, `encounter_ms += elapsed`).
Always overwrites what the client sent (unforgeable). Multi-row inserts (test submits)
are safe: each row's trigger sees the rows inserted before it in the same statement.

### 4b. Grading (`rating_grade`, pure)

```
med  = exp(ln_time_ewma)                        -- running geometric-mean solve time
ε_t  = 0                                         if solve_count < min_solves or no time
     = min(effort_cap, 1 − 2^(−enc_ms/med))      otherwise (cumulative encounter time)

s    = correct ? 1 − score_swing·ε_t             -- win, dragged toward draw by time
               :     score_swing·ε_t             -- loss, softened by genuine struggle

w    = repeat_decay^(k−1)                                        -- re-encounter decay
     × (correct ? 1 : retry_weight · attempt_decay^(a−1))        -- wrong attempts cheap
     × (MCQ & elapsed < guess_floor_ms                           -- symmetric guess guard
          ? clamp(elapsed/guess_floor_ms, 0.1, 1) : 1)
```

First-try-correct — the overwhelmingly common case — is graded exactly as in v2.
Missing/zero `elapsed_ms` ⇒ no time signal and no guard (degrades to binary Glicko),
as does cold start (`solve_count < min_solves`).

### 4c. The match (`glicko_rate`, pure; `glicko_g`/`glicko_e`/`glicko_inflate` helpers)

```
RD   ← min(seed_rd, sqrt(RD² + c²·idle_seconds/period_seconds))   -- both sides, lazily
info = w·g(RDⱼ)²·E·(1−E);   Δ = w·g(RDⱼ)·(s − E)                  -- problem side gets 1−s
R'   = R + (q / (1/RD² + q²·info))·Δ
RD'  = sqrt(1 / (1/RD² + q²·info)), clamped to [rd_floor, seed_rd]
```

### 4d. Live application (`handle_submission_rating`, AFTER INSERT)

Skip if skipped/ungraded or the encounter was already solved (re-solving in the same
sitting is practice, not evidence). Otherwise: upsert-seed + lock the player row then
the problem row (fixed order — no deadlocks), inflate, grade, rate both sides, bump
`matches`/`attempts`/`last_match_at`, append history, and advance the problem's
EWMA/solve count on a resolving solve. The whole body is exception-guarded down to a
`warning`: **a rating bug never blocks the submission log** — the replay repairs.
Measured cost: ~10 ms per insert (all three triggers included).

### 4e. Replay (`recompute_ratings()`)

Zero-arg, service_role-only, wrapped by `admin_recompute_ratings()` (authenticated +
in-DB `admin_rank` check; admin UI `src/routes/(app)/admin/ratings-admin.svelte`).
Steps: (1) re-derive the annotation columns from the log with window functions (keeps
them consistent after an `encounter_gap` retune); (2) reset ratings/stats/history to
seeds (TRUNCATE, not DELETE — Supabase's `safeupdate` hook); (3) fold over graded
submissions in `(created_at, id)` order using the same pure functions and the same
`real` quantization as the trigger; (4) persist. Returns
`{ players, problems, matches }`.

---

## 5. Tuning (`rating_params`, single row)

Tuning = `update rating_params set … ;` then `select recompute_ratings();` to re-grade
history under the new constants. The `rating_params()` accessor falls back to these
defaults if the row is missing (keep them in sync with the column defaults).

| Param | Default | Meaning / effect of raising it |
| --- | --- | --- |
| `period_seconds` | `604800` (1 wk) | Time unit for RD growth. `c` is "RD growth per this many idle seconds". |
| `repeat_decay` | `0.5` | Weight of the k-th encounter = `decay^(k−1)`. Higher → repeats keep counting. |
| `c` | `34.6` | RD growth per idle period. Higher → inactive ratings become movable faster. |
| `rd_floor` | `30` | Minimum RD. Higher → ratings stay responsive forever. |
| `seed_rating` / `seed_rd` | `1500` / `350` | Starting state; `seed_rd` is also the RD ceiling. |
| `encounter_gap` | `1800` (30 min) | Idle gap that splits a sitting into two encounters. |
| `attempt_decay` | `0.5` | Extra weight decay per wrong retry within an encounter. |
| `retry_weight` | `1.1` | Base weight of a recorded (final) wrong answer. `>1` → a decisive miss outweighs a win; `1.0` → symmetric; lower → misses cost less. |
| `score_swing` | `0.5` | Max score deviation from a decisive 0/1. Higher → time effort matters more. |
| `effort_cap` | `0.8` | Cap on `ε_t`; keeps wins/losses ordered (win ≥ 0.6, loss ≤ 0.4). |
| `min_solves` | `5` | Solves before the time signal (EWMA) is trusted. Below: binary Glicko. |
| `time_alpha` | `0.15` | EWMA rate of the solve-time normalizer. Higher → adapts faster, noisier. |
| `guess_floor_ms` | `2000` | MCQ attempts faster than this get weight-scaled (both outcomes). Replaces v2's chars-per-second floor. |

⚠ Changing `encounter_gap` invalidates stored annotations — the replay re-derives them,
so just recompute after.

---

## 6. Verification (2026-07-07, v3)

Fixture: `supabase/snippets/seed_synthetic_ratings.sql` (manual tool, not part of
`db reset`). It now exercises the **live path** — every insert fires the triggers — and
`recompute_ratings()` afterwards must reproduce the same state exactly.

| Mechanism | Setup | Result | ✔ |
| --- | --- | --- | --- |
| **Live ≡ replay determinism** | seed live, snapshot, full recompute, diff | **0** difference on every rating, rd, counter, stat, and history row (31 matches) | ✅ |
| Time-effort | 5 warm-ups @10s set the EWMA, then solvers at 3–60s | 1518 > 1480 > 1439 > 1407 > 1379, strictly monotonic to 25s; 60s ties/rebounds at the effort cap (same "capped tail" as v2) | ✅ |
| Struggle-then-solve | clean solve vs 3 misses + solve (time off) | clean +162 vs struggle **+28** — positive but smaller (the product decision) | ✅ |
| Repeat-decay | same problem ×3 (8 days apart) vs 3 distinct | 1707 vs 1811 | ✅ |
| Already-solved skip | re-solve 5 min after solving (same encounter) | not rated: `matches` = 3 not 4, no history row | ✅ |
| Guess guard (losses) | wrong @1.2s vs wrong @2.5s, floor 2s | −81 vs −122 — the sub-floor miss moves less | ✅ |
| Guess guard (wins) | correct @1.2s vs @2.5s | end-to-end masked at high E (faster also scores higher); function-level: `w = 0.6` vs `1.0` confirmed | ✅ |
| Ungraded exclusion | `is_correct = null` insert | no match, no history row; replay agrees | ✅ |
| Multi-row insert | 2 graded + 1 skip in one statement | both rated in order, skip annotated null | ✅ |
| Trigger cost | `explain analyze` single insert | ~10 ms total (annotate + SM-2 + rate) | ✅ |

---

## 7. Known issues / open tuning

- **Effort-cap tail ties.** Beyond ~2.3× the EWMA solve time, `ε_t` caps and extra
  slowness stops mattering; combined with the problem's rating rebounding between
  matches, very slow solvers can land within a few points of each other (25s vs 60s
  above). By design, but revisit `effort_cap` if the tail feels wrong.
- **Win-side guess-guard is real but hard to see end-to-end** against an already-crushed
  problem (E ≈ 0.9): the weight cut and the faster-time score bonus nearly cancel. The
  guard weight itself is verified at the function level.
- **No topic scopes yet.** Everything is `scope='overall'`; per-topic is additive rows.
- **Glicko-1, not Glicko-2.** No volatility term. The shared `glicko_rate()` is the only
  thing a σ upgrade would touch.
- **`retry_weight` = 1.1 is a deliberate punitive choice** (2026-07-08): the trainer logs
  only final outcomes, so a recorded miss is decisive and should sting at least as much as
  a win. Trade-off: amplifying losses biases ratings to drift down over time — revisit
  toward `1.0` if deflation shows up. `attempt_decay` stays `0.5`.

---

## 8. How to change common things

- **Tune behavior:** update the `rating_params` row, then `recompute_ratings()`. No
  code change, no signature churn (the function takes no args now).
- **Change score/effort math:** edit `rating_grade()` only — trigger and replay share
  it. `(s, w)` is the whole interface into the Glicko update.
- **Change the update math (e.g. Glicko-2):** edit `glicko_rate()` only.
- **Add a graded source signal** (partial credit, …): feed it into `s` inside
  `rating_grade()`; fractional scores are native.
- **⚠ Migration gotcha (unchanged from v2):** `supabase db diff` omits
  `REVOKE … FROM PUBLIC` when it recreates `recompute_ratings()`. Always hand-add
  `REVOKE ALL ON FUNCTION public.recompute_ratings() FROM PUBLIC;` and verify
  `select proacl from pg_proc where proname='recompute_ratings'` shows only
  `{postgres, service_role}` (done in `20260707223059_live_ratings.sql`).
- **⚠ Determinism contract:** the trigger and the replay must stay mathematically
  identical — same pure functions, same `real` quantization between matches, same
  ordering (`created_at, id` = insert order for live traffic). After ANY change to
  either path, re-run the fixture and the live-vs-replay diff (§6 row 1). If they
  drift, the replay is authoritative and the live path is the bug.

## 9. Operational status

- **Cut and applied locally.** Migration `20260707223059_live_ratings.sql` (diff +
  hand-added PUBLIC revoke, history truncation before the NOT NULL `at` columns, params
  seed row, and a closing `recompute_ratings()` that backfills the annotation columns
  on existing rows). Verified via `supabase db reset`: chain applies, `db diff` clean,
  proacl correct. `database.types.ts` regenerated; `bun run check` clean.
- App integration: rating chip after each graded answer in
  `src/routes/(app)/practice/PracticeView.svelte` (refetch after the insert resolves);
  `fetchPlayerRating` now selects `last_match_at`; admin rebuild summary dropped
  `periods`.
- The reset wiped local play data. Re-run the synthetic seed to restore the
  verification fixture (it rates live; no recompute needed).
- **2026-07-08 — `retry_weight` 0.3 → 1.1.** Because the trainer records only a problem's
  final outcome (intermediate retries in `PracticeView.submitAnswer` return before
  `recordSubmission`), the old 0.3 "cheap provisional loss" weight made every real miss
  count a third of a win — a decisive wrong answer moved a rating ~−32 where a full loss
  was ~−100. Raised to 1.1 (punitive; §5/§7) and re-graded via `recompute_ratings()`
  (40 matches). The §6 struggle-then-solve and guess-guard-loss figures were measured at
  0.3 and predate this; the live≡replay determinism (§6 row 1) is unaffected.
