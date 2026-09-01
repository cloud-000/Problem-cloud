# Goals — product definition

> Status: product spec. Replaces an earlier draft of the same name (deleted).
> This document defines what a goal **is** and which targets V1 ships.
> [`goal-target-architecture.md`](./goal-target-architecture.md) defines the
> mechanism that makes new targets cheap to add. Where the two disagree, the
> product rules here win.

## 1. What a goal is

> A commitment to reach a stated finish line on a defined slice of the catalog,
> optionally by a deadline.

Goals owns the commitment: creation, lifecycle, next action, achievement,
editing, archiving. It does **not** own the student's record — every metric is
computed from the same submissions, canonical identity, and eligibility rules
the rest of the app uses. Goals must never introduce a second definition of what
the student has done.

V1 ships **six target types across four evaluator families**, chosen because each
is expressible against today's schema without new infrastructure. Adding a
seventh should mean adding a registry entry, not a new query path.

## 2. V1 target catalog

| Target | Family | Question it answers | Source |
| --- | --- | --- | --- |
| `attempted_count` / `attempted_percent` | set | "Have I seen this material?" | `user_problem_index.times_reviewed` |
| `solved_count` / `solved_percent` | set | "Can I actually do it?" | `user_problem_index.solved` |
| `volume` | accumulation | "Am I putting in the reps?" | `submission_facts` |
| `accuracy` | window | "Am I precise on fresh problems?" | `submission_facts.graded_seq = 1` |
| `speed` | window | "Am I fast enough?" | `submission_facts.elapsed_ms` |
| `streak` | period | "Am I showing up?" | `progress_breakdown('day', tz)` |

The four families are what keep this extensible: a new target type usually joins
an existing family and inherits its data request, its budgeting, and its result
shape. Families, not types, are the unit of implementation cost.

**Deferred:** competition readiness and true retention-based mastery. §10 says
what each needs first — both are blocked on modelling work, not on effort.

## 3. Scope (shared by every target)

`GoalScope` **is** the practice Track, structurally:

```ts
// src/routes/(app)/practice/practice-settings.ts
type GoalScope = TrackValue & { yearRange: [number, number] | null };
// TrackValue = { topic: string[]; seriesIds: string[]; seriesScopes: SeriesScopes }
```

Each selected series is one clause carrying its own division/format and optional
problem-number narrowing (`problemNumbers`, a 1-based inclusive range on
`problems.n + 1`); clauses are OR-ed; topic narrows the result. A division or
`#21–25` chosen for one series must never filter another series with a different
vocabulary or number line. An empty axis — including a full `[1, L]` problem-number
slider, which is stored as absent — means no narrowing on that axis.

Scope being structurally identical to `TrackValue` is what makes "Practice
remaining" free: the goal's scope is handed to the trainer unchanged.

**Year range is user-chosen**, so `PracticeSettingsForm` gains a
`yearRange` field and the Track gains a control for it. Adding it to the Track
rather than to goals alone is what preserves scope ≡ Track: if a goal could
narrow by year and a Track could not, "Practice remaining" would silently draw
from a wider pool than the goal measures. `tests.year` already exists and the
library filters on it (`src/lib/library.ts:431`); `canonical_placements` carries
it, so no `user_problem_index` change is required.

### How scope is matched

Every family resolves scope through one object — `canonical_placements`, one row
per (canonical, placement) carrying `series_id`, `division`, `format`, `year`
and `n`, aliases included. Matching is a **semi-join**: *does this canonical have any
placement satisfying the scope?* That is already the set family's rule (§5), and
it is the only formulation that also works for event metrics, where joining
placements directly would fan one submission into N rows and break every count.

Consequently `submission_facts` needs no new columns. It carries `topic`,
`series_id` and `test_id` but not `division`/`format` (`progress_analytics.sql:21–66`);
rather than widen it, event metrics match scope against `canonical_placements`
via the submission's (already canonical) `problem_id`.

**The matching rule exists twice, and SQL is authoritative.** Goals evaluates in
SQL (§8) while the trainer builds the same OR-of-AND as PostgREST filters
(`seriesScopeFilter`, `src/lib/trainer.ts:335`). Rather than refactor the
performance-sensitive draw path, the two implementations are kept honest by a
contract test: the same scope over the same fixtures must yield the same set from
both. This mirrors how ratings already treats its client-side math — the SQL
owns the definition and the client mirror is explicitly subordinate. If they ever
disagree, SQL is right and the client is the bug.

## 4. Eligible denominator (set family only)

The denominator counts only problems the app can serve and grade:

- a non-blank `statement`, and
- a comparable reference answer: `hasComparableAnswer` (`src/lib/problem-response.ts:91`)
  — `answer_status = 'known'` and `answer_index` an integer in `[0, choices.length)`.

Answerless stubs, proofs, and anything without a gradeable key are excluded, so
they cannot make 100% unreachable.

This predicate exists in TypeScript only, and the trainer applies a PostgREST
approximation before re-checking in the client (`trainer.ts:365–390`, then
`isEligibleProblem`). Coverage must not become a third approximation.
**Eligibility is defined once, as an immutable SQL function**
(`public.is_gradeable(...)`), and exposed as a column wherever that is convenient
— on `user_problem_index` and on `canonical_placements`. The function is the
definition; a column is only an affordance.

Eligibility is evaluated on the **canonical** row, while scope membership is
evaluated across **any** placement (§5). An alias is its own `problems` row with
its own `statement` and `choices`, so the two can disagree — and since practice
always serves the canonical, the canonical's answer is the one that decides
whether the problem can be graded at all.

Denominators are **live**: corrections and new imports move them. The UI always
shows the current numerator and denominator; snapshots are deferred.

Window, accumulation and period targets have no denominator — they measure events,
not catalog membership — so eligibility does not apply to them.

## 5. Canonical identity

Set metrics count real problems, not catalog placements:

```
matching placements → coalesce(canonical_id, id) → distinct
```

A problem appearing as both AMC 10A #18 and AMC 12A #12 contributes one unit. A
canonical is in scope when **at least one** eligible placement matches.

Do not reuse the trainer's `.is("canonical_id", null)` alias exclusion
(`trainer.ts:499`). It is right for discovery draws and wrong here: with a scope
of "AMC 12 only", a problem whose AMC 12 placement is the alias would vanish from
the denominator while its progress still counts — yielding coverage above 100%.

**Event metrics inherit a subtler version of this.** Submissions are canonicalized
on insert, so `submission_facts.problem_id` is always the canonical, and
`submission_facts` joins `problems` on that id — meaning its `series_id` is the
*canonical's own* placement. An AMC-12-scoped accuracy goal would therefore miss
work on a problem whose canonical row lives under AMC 10: a silent under-report,
in the family where nobody would notice, on exactly the duplicated problems that
are hardest to spot by hand.

This is why scope is matched by semi-join against `canonical_placements` (§3)
rather than against whatever series a fact row happens to carry. Both families
then ask the same question — *does this canonical have any placement in scope?* —
and event metrics get the fix by construction rather than by remembering to
apply it.

## 6. Metric definitions

Each is stated in the columns that produce it. No metric may be reimplemented
per surface.

**Attempted** — distinct in-scope canonicals with `times_reviewed > 0`. That
column is maintained by `handle_new_submission` (`submissions.sql:171`) and
increments only for `not skipped and is_correct is not null`, so it is exactly
"at least one graded, non-skip submission". Correct and incorrect both count;
repeats add nothing; skips and ungraded interactions never count.

**Solved** — distinct in-scope canonicals with `solved = true`
(`user_problem_index.sql:47`, a stored generated column over `times_correct > 0`).
Strictly stronger than attempted, and unlike `mastery` it cannot be self-declared.

**Volume** — count of graded non-skip submissions in scope. Unlike the set
family, **repeats count** — that is the point of a volume goal. The student
chooses the period: a rolling window (last N days), a calendar week or month, or
since the goal was created. Calendar periods need a timezone for the same reason
streaks do, and take it from the same field on the goal — a week that starts on
a different day depending on where you open the app is not a week.

The period also decides whether a volume goal is finishable: since-creation and
rolling-window goals can be achieved once and stay achieved, while a calendar
period re-evaluates each cycle. Both are legitimate; the creation flow must state
which one the student is choosing.

**Accuracy** — correct ÷ total over the most recent N graded attempts in scope,
restricted to `graded_seq = 1` (each problem's *first* graded attempt). That
restriction is the fresh-problem rule, and the column already exists for exactly
this purpose (`progress_analytics.sql:52–64`); without it, re-attempting known
problems inflates the number until any accuracy goal completes itself. Below N
attempts the result is `insufficient_data`, never a percentage.

**Speed** — mean `elapsed_ms` over the most recent N *correct* graded attempts in
scope (the column is `elapsed_ms`, not `duration_ms`). Lower is better, so the
target carries `direction: "at_most"`. A speed goal must also carry an accuracy
floor: "faster" is trivially achievable by guessing, and a speed target without a
correctness condition rewards exactly that.

**Streak** — consecutive days, in the goal's stored timezone, with at least K
graded non-skip submissions in scope. The timezone is captured at creation
(`Intl.DateTimeFormat().resolvedOptions().timeZone`) and stored **on the goal**,
not read per-device — otherwise the same streak breaks or survives depending on
where the student opens the app. `progress_breakdown` already buckets by
`(created_at at time zone p_tz)::date` (`progress_analytics.sql:116`); reuse that
convention exactly.

## 7. Finish line, achievement, lifecycle

Every target states a **direction** (`at_least` or `at_most`), a **value**, and
for set targets a **unit** (`count` or `percent`, 1–100). Count targets are
positive integers and may not exceed the current denominator at creation or
material edit.

Where the student chooses a sample size or period, validation enforces floors: a
sample of three is noise, not a form reading, and a target computed over it will
swing wildly enough to make the goal meaningless. The creation flow should state
the sample in the goal's own sentence — *"85% over my next 30 fresh problems"* —
so the student can see what they picked without opening an edit screen.

Creation shows the literal interpretation before saving: *"Attempt 80% of 240
currently eligible problems in AMC 10 geometry. You have already attempted 96."*
A goal existing work already satisfies saves as achieved immediately.

**Achievement is sticky.** The first time the finish line is met, `achieved_at`
is stamped and never cleared by later catalog drift. Goal detail shows both facts
when they differ: *"Achieved 8 July"* alongside *"currently 78% of the live
scope."* A progress result carrying only `isTargetMet` cannot render this.

Window and period targets make stickiness matter *more*, not less: accuracy and
streaks go down as well as up, so a goal met in July and missed in August is
achieved-and-currently-below, never un-achieved.

**Deadline is a horizon, not a second completion condition.** Passing it does not
fail the goal, erase progress, or block later achievement. The UI may call an
active goal overdue.

**Editing:** title and deadline preserve achievement. Changing scope or the
finish line changes what the goal *means*, so an achieved goal must explicitly
reopen and clear `achieved_at`, with a warning. Archived goals stay readable but
are no longer promoted. Deletion is permanent. Status derives from `achieved_at`
/ `archived_at` and is not a mutable column.

## 8. Where evaluation runs

On load — goals list, goal detail, home cards. No evaluation inside the
submission trigger, no cached progress column, no background refresh, until the
direct path is shown to be too slow.

Evaluation runs **in SQL, not the client**: a broad denominator is thousands of
rows and PostgREST caps a page at 1,000, so counting in the browser is slow and
wrong at the boundary. Precedent exists — `problem_state_summary`
(`user_problem_index.sql:73`) and `progress_breakdown`.

**One round trip per family, not per goal.** A goals list with eight goals across
four families is four queries, because targets in a family sharing a scope share
one data request. This is the property the architecture doc's two-phase evaluator
exists to guarantee; a per-card RPC would make the list N queries and get slower
with every goal a student keeps.

The remaining-problems drill-down (set family) is a separate paged query against
the same scope, and its row count must agree with the denominator.

## 9. Data shape

```ts
type Goal = {
    id: number;
    userId: string;
    title: string;
    scope: GoalScope;          // jsonb
    target: GoalTargetData;    // jsonb, discriminated union — see architecture doc
    deadline: string | null;
    achievedAt: string | null;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
};
```

One table, RLS'd to the owner for all four verbs. `target` is jsonb so new types
need no migration — but **client-side validation is not a guard**: RLS lets an
owner PATCH `target` to anything, so shape validation belongs on the write path
(and/or a CHECK constraint), not only in `createGoalTarget`.

No generic criteria rows, weighted conditions, executable expressions, or
user-authored DSL. No goal combines two metrics, and no blended fitness score:
extensibility means *more kinds of goal*, never *one goal with more conditions*.

## 10. Deferred, and what each needs first

- **Competition readiness.** There is no `test_sessions` table — test mode is
  `practice_sessions` with `settings.format = 'test'`, and no score is stored,
  though it is derivable since blanks are recorded as `skipped = true`
  (`PracticeView.svelte:388`). Blocked on a scoring model that differs per series
  (AMC vs AIME), plus timing and incomplete-test rules. Would form a fifth
  family (per-session scores), which is why it is the most expensive of the set.
- **Retention-based mastery.** `problem_progress.mastery` is
  `needs_work | learning | confident` and is *user-declared*, explicitly never
  inferred (`submissions.sql:118`) — a goal on it is completable by clicking. SM-2
  `repetitions` is not a substitute; real retention needs spacing, elapsed-time,
  and later-miss semantics. `solved` (§6) covers the honest part of this intent
  in V1.
- Also out: natural-language creation, notifications, progress-history charts,
  frozen denominators, and focuses without a finish line.

## 11. Open decisions

None. The last one closed below.

Settled 2026-08-10, previously open:

- **The client stamps `achieved_at`**, with `... where achieved_at is null` so
  the write is idempotent and first-writer-wins across tabs
  (`markGoalAchieved`). The re-evaluating RPC was rejected on cost: it needs a
  second implementation of every evaluator in SQL — the largest single piece of
  work in the feature, and the one most likely to drift from the TypeScript
  registry — and the only thing it prevents is a student lying to themselves
  about their own private goal. Goals are RLS'd to their owner and nothing is
  scored, ranked, or rewarded on them. Revisit if a goal ever becomes visible to
  anyone else; the column-level UPDATE grant already bounds what a hand-rolled
  PATCH can touch.
- **Year range is implemented in the SQL resolver but authored by nothing.**
  Adding it to the Track means touching `PracticeSettingsForm`, the persisted
  settings snapshot, `Track.svelte` and the trainer draw, for an axis no V1
  target needs — so it is deferred as a slice. Scope ≡ Track is preserved by it
  being absent from *both*, which is why it must reach the Track and the goal
  form together or not at all.

- **Year range is in** the model, as a user-chosen field on both the goal scope
  and the practice Track (§3) — see the deferral note above for what has
  actually shipped.
- **Volume's period is user-chosen** — rolling, calendar, or since-creation (§6).
- **Accuracy and speed sample sizes are user-chosen**, with floors enforced at
  validation (§7).

- **Scope matching** lives in SQL for Goals and stays PostgREST in the trainer,
  with SQL authoritative and a contract test between them (§3).
- **Eligibility** is an immutable SQL function, surfaced as a column where
  convenient (§4).
- **`submission_facts` needs no new columns** — the `canonical_placements`
  semi-join replaced the proposal to widen it (§3).

## 12. What exists (2026-08-10)

Both halves are built: the headless layers and the `/goals` route.

| Layer | Where | State |
| --- | --- | --- |
| Eligibility, placements, scope resolver | `supabase/schemas/goal_scope.sql` | done — `is_gradeable`, `canonical_placements`, `goal_scope_canonicals` |
| Goals table + four family RPCs | `supabase/schemas/goals.sql` | done — `goal_set_progress`, `goal_window_progress`, `goal_volume_progress`, `goal_streak_progress` |
| Types, registry, batching, period math | `src/lib/goals/` | done — `types`, `registry`, `plan`, `period`, `data` |
| SQL semantics | `supabase/tests/goal_scope.test.sql`, `goal_families.test.sql` | 39 pgTAP assertions |
| Pure evaluation | `src/lib/goals/*.test.ts` | 54 unit tests |
| Trainer ≡ SQL scope contract | `src/lib/goals/scope-contract.test.ts` | 10 scope cases + fixture guards; skips without a local stack |
| UI | `src/routes/(app)/goals/` | done — list, create/edit dialog, detail, practice handoff; nav entry in `(app)/+layout.svelte` |
| Presentation, handoff, promotion | `src/lib/goals/presentation.ts`, `practice.ts`, `promote.ts` (+ tests) | 36 unit tests |
| Home integration | `src/routes/(app)/+page.svelte`, `HomeGoalRow.svelte`, `src/lib/home-next.ts` | done — one Next up card (work, commitment, action); lead goal owns the primary action; empty Goals/Focused series/Recommended next removed |

Migrations are local-only (`20260810232659_goal_scope`, `20260810233431_goals`)
and have not been pushed to the cloud.

`roadmap_goals` is an unrelated table (product roadmap voting), so `goals` is the
right name and there is no clash.

### How the route is put together

One route, two views: `/goals` lists, `/goals?goal=<id>` opens the detail — the
same query-param idiom as `/practice?session=` rather than a dynamic segment.

- **The page owns the round trips.** `+page.svelte` runs the three phases once
  for the whole list (`planGoalRequests` → `fetchGoalProgress` → `evaluateGoals`)
  and passes each card its answer. A card never fetches, which is what keeps a
  list of eight goals at one query per family (§8). The plan and its results are
  stored as one object so a plan whose results have not arrived can never
  evaluate every goal to null.
- **Achievement is stamped on load**, from `newlyAchieved` — met, unstamped,
  unarchived, and *measurable*: a family that failed to load evaluates to null,
  and absence of data is never evidence of achievement. Creation reloads through
  the same path, which is how "a goal existing work already satisfies saves as
  achieved immediately" (§7) falls out rather than being a second code path.
- **Three modules sit beside the domain layer but outside its barrel**, and the
  deeper import path is the layering made visible: `presentation.ts` reaches for
  `topicLabel`, `practice.ts` for `PracticeSettings`, and neither belongs in what
  a consumer gets from `import … from "$lib/goals"`. Anything re-exported from
  `index.ts` must stay free of both.
- **Presentation strings live in `presentation.ts`**, not in the components:
  `GoalProgressResult` deliberately carries none (architecture doc §5), and the
  awkward cases (an `at_most` speed target, an `insufficient_data` window, a
  scope with per-series narrowing, achieved-but-currently-below) are settled once
  with tests instead of three times in markup.
- **The handoff is `practice.ts`**, and it is where "remaining" is defined
  per family: attempted → `mode: "new"`; solved → `mode: "mixed"` with
  `timesCorrect: [0, 0]` so a solved problem can never come back as remaining;
  event families → mixed practice in the scope, because any work in scope moves
  them and a narrower filter would count work the goal does not.
- **Editing reopens explicitly.** The form compares `scopeKey` and the target
  JSON; a material change to an achieved goal confirms first and passes
  `reopen`, and title/deadline never do (§7). The comparison canonicalizes key
  order, because `target` is jsonb and Postgres returns its keys sorted by
  (length, bytes) — a plain `JSON.stringify` diff called every unedited streak
  goal a material change.

### Home

Home is organized around one Next up card. `decideNextUp` (`src/lib/home-next.ts`)
is the only source of the heading and the button, so they cannot disagree.

- **The primary card has three stable slots.** Current work answers *what am I
  doing now*; the lead goal (or a quiet invitation to set one) answers *why*;
  one action answers *what moves me forward next?* A lead goal owns that action
  and always starts a fresh goal-configured session. Without a goal the action
  is continue-session, then due review, then ordinary practice.
- **`promote.ts` still decides which goal is the destination** (`primaryGoal`)
  and which other commitment needs attention today (`attentionGoal`). Urgency
  never replaces the lead goal in the primary card.
- **The streak rung is why `PeriodData.todayCount` exists.** It deliberately
  never reaches `GoalProgressResult` (§9's rule: a target needing a bespoke
  result field belongs in a new family), so home reads the period row directly —
  which is exactly what the type comment says surfaces wanting it should do.
- **Home stamps achievements too**, through the same `stampAchievedGoals`: the
  student should see "Achieved" on the screen they open first, and
  `where achieved_at is null` makes two surfaces racing a non-event. One
  definition of "just crossed the line", not one per page.
- **There is no "set a finish line" card.** After Welcome, the commitment slot
  may offer a quiet invitation; Goals owns explanation and creation.
- **Goals never fail the home page.** They load on their own and fail quietly to
  the no-goal Next up path, because a full-catalog scope resolution should not
  be able to cost the student their next action.

Focused series remains a preference, not a Home section. Recommended next was
folded into Next up. Progress appears only after the first graded submission,
and only with values that exist.

Still deferred: the remaining-problems *list* (§8's paged drill-down — the detail
view states the count from the same set-family row, but does not enumerate the
problems) and the year-range control (§11).

## 13. Done when

A signed-in student can create a goal of any V1 type from a Track-based scope,
see what already counts toward it, see active / achieved / archived goals, open a
detail view stating the commitment in numbers, drill into what remains (set
family), practice remaining problems, edit/archive/delete, and have achievement
recorded when the finish line is first reached.

Correctness gates:

- canonical duplicates count once; set coverage never exceeds 100%;
- event metrics resolve scope through all placements, not the canonical's own (§5);
- per-series division/format filters keep OR-of-AND semantics on every family;
- the trainer's PostgREST scope filter and the SQL resolver return the same set
  for the same scope over the same fixtures (contract test, §3);
- preview, detail, drill-down and practice scope share one resolver;
- out-of-scope work moves nothing; repeats inflate volume only;
- skips and ungraded interactions stay in the remaining pool and out of accuracy;
- accuracy below its sample size reports `insufficient_data`, never a percentage;
- a streak is computed in the goal's stored timezone on every device;
- ineligible problems do not inflate any denominator;
- RLS prevents reading or writing another user's goals;
- changing an achieved goal's scope or finish line explicitly reopens it;
- a goals list costs one query per family, not one per goal.

Normal repository gate: `bun run check`, `bun test`, autofixer on every touched
Svelte file, and database tests for scope and metric semantics.
