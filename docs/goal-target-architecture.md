# Goal target architecture

> Status: architecture proposal. Revised 2026-08-10 against the live schema.
> [`goals.md`](./goals.md) defines what a goal is and which targets V1 ships;
> this document defines the mechanism that makes adding a seventh target cheap.

## 1. The design in one paragraph

A target is **plain JSON in the database**, a **discriminated union in
TypeScript**, and a **registry entry at runtime**. Evaluation is two-phase: a
target declares *what data it needs*, the page batches those requests across
every visible goal, and evaluation is then a pure function from data to result.
The unit of implementation cost is the **family** (§3), not the target type —
which is why six V1 types cost four queries and adding a seventh usually costs
none.

## 2. Why two-phase

The obvious design gives every target an `eval(scope, dataset)` and calls it per
goal. It does not survive contact with six target types:

- there is no single `dataset` shape. Set targets need distinct-canonical counts,
  accuracy needs an ordered recent sample, streaks need day buckets in a
  timezone, speed needs elapsed sums. A shared type is either a god-object that
  runs every query for every goal, or a lie;
- evaluating per goal means a goals list costs N round trips and degrades with
  every goal a student keeps.

Splitting *declaring a need* from *satisfying it* fixes both:

```
targets → data requests → dedupe by (family, scope) → batch fetch → pure eval
```

Two goals over the same scope in the same family fetch once. A goal card renders
from data it did not fetch itself.

## 3. Families

A family is a data request shape plus a result interpretation. Every V1 target
belongs to one:

| Family | Data request | Targets |
| --- | --- | --- |
| `set` | distinct in-scope canonicals matching a predicate, plus the eligible denominator | `attempted_*`, `solved_*` |
| `window` | the most recent N graded attempts in scope, filtered and aggregated | `accuracy`, `speed` |
| `accumulation` | count of in-scope events over a period | `volume` |
| `period` | in-scope day buckets in a timezone | `streak` |

Adding a target to an existing family means a registry entry and an evaluator
function. Adding a *new* family means a new query and a new request type — which
is the honest cost signal, and why competition readiness (a fifth family: per-session
scores) is deferred in `goals.md` §10 rather than sketched in as if it were free.

## 4. Types

```ts
export type GoalTargetData =
    | { type: "attempted_count";   count: number }
    | { type: "attempted_percent"; percentage: number }
    | { type: "solved_count";      count: number }
    | { type: "solved_percent";    percentage: number }
    | { type: "volume";            count: number; period: VolumePeriod }
    | { type: "accuracy";          percentage: number; sampleSize: number }
    | { type: "speed";             maxSeconds: number; sampleSize: number; minAccuracy: number }
    | { type: "streak";            days: number; perDay: number; timeZone: string };

export type GoalTargetType = GoalTargetData["type"];
export type GoalFamily = "set" | "window" | "accumulation" | "period";
```

Note what is *not* here: no `seriesId` on any target. Content selection is
`GoalScope`'s job. A target that also filters content gives the app two scope
definitions and guarantees they diverge.

`timeZone` is on the streak target deliberately (`goals.md` §6) — a streak read
from the device timezone breaks or survives depending on where the student opens
the app.

## 5. Result

```ts
export type GoalProgressResult = {
    status: "ok" | "insufficient_data";
    direction: "at_least" | "at_most";
    currentValue: number;      // 78 (percent), 132 (problems), 84 (seconds)
    targetValue: number;       // the finish line in the same unit
    unit: "problems" | "percent" | "seconds" | "days" | "submissions";
    percentToTarget: number;   // 0–100, progress toward the finish line
    isTargetMet: boolean;
    sampleSize?: number;       // window/period families
    requiredSample?: number;   // set when status is "insufficient_data"
};
```

Four things this shape gets right that the previous revision did not:

**`percentToTarget` measures progress toward the target, not toward the
denominator.** The earlier `evalCoverageCount` returned `attempted / totalEligible`,
so a 50-of-100 count goal inside a 1,000-problem scope rendered a 5% bar. For
`at_most` targets it inverts (`target / current`, clamped to 100) so a speed goal
fills up as the student gets faster.

**`status` exists.** Accuracy over 7 of a required 30 attempts is not 23% — it is
unknown, and rendering a confident bar for it is a lie the student will act on.

**`direction` exists**, so speed fits at all. A single monotone `remaining` field
cannot express "at most 90 seconds".

**Achievement is not in here.** `achieved_at` is goal state, not a computed
metric, and `goals.md` §7 requires showing "achieved 8 July / currently 78%"
together. The view model composes `Goal & { progress }`; the evaluator does not
own history.

Presentation strings are also absent. The earlier revision returned a
`detailMessage` from the domain layer; number-to-prose belongs in the component,
which is the only layer that knows how much room it has.

## 6. Registry

```ts
type TargetSpec<T extends GoalTargetData> = {
    family: GoalFamily;
    requires(target: T, scope: GoalScope): DataRequest;
    evaluate(target: T, data: DataFor<T["family"]>): GoalProgressResult;
    validate(target: T, ctx: ValidationContext): string | null;
    describe(target: T): string;   // "Attempt 80% of eligible problems"
};

export const TARGETS = {
    attempted_count: { ... },
    attempted_percent: { ... },
    // …
} satisfies { [K in GoalTargetType]: TargetSpec<Extract<GoalTargetData, { type: K }>> };
```

`satisfies` over the mapped type is the load-bearing part: a new union member
fails compilation until it is registered. The previous revision used a `switch`
with `default: throw` and `(data as any).type`, which silently accepted an
unhandled member — its own extensibility example, `mastery_percent`, was in the
union and threw at runtime.

Lookup is `TARGETS[goal.target.type]`. There is no `createGoalTarget` returning a
method-carrying object, because:

**Never return a behaviour-carrying object from a SvelteKit `load`.** Load data
must be devalue-serializable and functions are not, so the earlier
`EvaluatedGoal = Goal & { targetHandler: GoalTarget }` throws the moment it
crosses SSR. Data crosses the boundary; behaviour is looked up on the other side.

## 7. Validation

`validate` runs at creation and material edit, but it is **not a guard**. RLS
lets an owner PATCH `target` to any JSON, so:

- the write path (a form action or RPC) re-validates server-side;
- a CHECK constraint enforces the minimum — `target ? 'type'` and a known
  discriminator;
- the evaluator treats stored data as untrusted: an unknown `type` renders as an
  unreadable goal, never a thrown page.

Rules worth stating once: count targets are positive integers not exceeding the
current denominator; percentages are 1–100; `sampleSize` has a floor (a 3-attempt
accuracy goal is noise); `speed.minAccuracy` is mandatory, since a speed target
without a correctness floor rewards guessing.

## 8. Where each phase runs

Phase one (`requires`) and phase three (`evaluate`) are pure TypeScript — unit
testable with no database, and the layer where most of the risk lives.

Phase two is SQL. Each family maps to one `security invoker` RPC accepting an
array of scopes and returning one row per scope, so the goals list issues one
call per family (`goals.md` §8).

Every family resolves scope the same way: a semi-join against
`canonical_placements` asking *does this canonical have any placement in scope?*
(`goals.md` §3). Set-family counting is then
`count(distinct coalesce(canonical_id, id))` over the survivors. Do not match
scope against a fact row's own `series_id` — for a duplicated problem that is
whichever test the canonical happens to live under, and the resulting
under-report is the easiest wrong number in the system (`goals.md` §5).

## 9. Adding a target type

1. Add the member to `GoalTargetData`. Compilation now fails.
2. Add the registry entry — `family`, `requires`, `evaluate`, `validate`,
   `describe`. If it joins an existing family, `requires` returns a request that
   already has a query behind it.
3. Add creation UI for its fields.
4. Unit-test `evaluate` against fixture data, including its
   `insufficient_data` boundary.

No migration, no new RPC, no changes to the goals list, detail view, or home
card — all of which render from `GoalProgressResult` alone. That property is the
whole point of the shape in §5, and any target needing a bespoke field on the
result is a signal it belongs in a new family instead.
