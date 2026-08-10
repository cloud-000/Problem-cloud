/**
 * Goals: the domain types.
 *
 * `docs/goals.md` defines what a goal is; `docs/goal-target-architecture.md`
 * defines the mechanism these types implement. The short version: a target is
 * plain JSON in the database, a discriminated union here, and a registry entry
 * at runtime (see `registry.ts`), and evaluation is two-phase — a target
 * declares what data it needs, the page batches those requests across every
 * visible goal, and evaluation is then a pure function from data to result.
 *
 * Nothing in this file talks to Supabase, and nothing in it renders. That is
 * deliberate: phase one and phase three are pure TypeScript, which is where
 * most of the risk lives and where it can be unit-tested without a database.
 */

/** Per-series division/format narrowing, keyed by series id. */
export type SeriesScope = { divisions: string[]; formats: string[] };

/**
 * The slice of the catalog a goal is about.
 *
 * Structurally identical to the practice `TrackValue`
 * (`src/routes/(app)/practice/practice-settings.ts`) — that identity is what
 * makes "practice what remains" free, since the goal's scope is handed to the
 * trainer unchanged. It is re-declared here rather than imported so `$lib` does
 * not depend on a route module; `plan.test.ts` asserts the two stay assignable
 * in both directions, which is the part that actually matters.
 *
 * Each selected series is one clause carrying its own division/format
 * narrowing; clauses are OR-ed and topic narrows the result. An empty axis means
 * no narrowing on that axis, so an empty scope is the whole catalog.
 *
 * `yearRange` is accepted by the SQL resolver but no UI authors it yet — it is
 * deferred from the Track, and adding it to a goal alone would break scope ≡
 * Track (`docs/goals.md` §3).
 */
export type GoalScope = {
    topic: string[];
    seriesIds: string[];
    seriesScopes: Record<string, SeriesScope>;
    yearRange?: [number, number] | null;
};

export function createGoalScope(): GoalScope {
    return { topic: [], seriesIds: [], seriesScopes: {} };
}

/**
 * How a volume goal's period is measured. The distinction is not cosmetic:
 * since-creation and rolling goals can be achieved once and stay achieved,
 * while a calendar period re-evaluates each cycle — so the creation flow must
 * say which one the student is choosing (`docs/goals.md` §6).
 */
export type VolumePeriod =
    | { kind: "rolling"; days: number }
    | { kind: "calendar"; unit: "week" | "month"; timeZone: string }
    | { kind: "since_creation" };

/**
 * Every V1 target. Note what is *not* here: no series or topic field on any
 * member. Content selection is `GoalScope`'s job, and a target that also
 * filtered content would give the app two scope definitions and guarantee they
 * diverge.
 *
 * `timeZone` is on the streak target deliberately — a streak read from the
 * device timezone breaks or survives depending on where the student opens the
 * app.
 */
export type GoalTargetData =
    | { type: "attempted_count"; count: number }
    | { type: "attempted_percent"; percentage: number }
    | { type: "solved_count"; count: number }
    | { type: "solved_percent"; percentage: number }
    | { type: "volume"; count: number; period: VolumePeriod }
    | { type: "accuracy"; percentage: number; sampleSize: number }
    | {
          type: "speed";
          maxSeconds: number;
          sampleSize: number;
          minAccuracy: number;
      }
    | { type: "streak"; days: number; perDay: number; timeZone: string };

export type GoalTargetType = GoalTargetData["type"];

/**
 * A family is a data request shape plus a result interpretation, and it — not
 * the target type — is the unit of implementation cost. Adding a target to an
 * existing family is a registry entry; adding a family is a new query.
 */
export type GoalFamily = "set" | "window" | "accumulation" | "period";

export type Goal = {
    id: number;
    userId: string;
    title: string;
    scope: GoalScope;
    target: GoalTargetData;
    deadline: string | null;
    achievedAt: string | null;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
};

/** Derived, never stored: there is no mutable `status` column (§7). */
export type GoalStatus = "active" | "achieved" | "archived";

export function goalStatus(goal: Pick<Goal, "achievedAt" | "archivedAt">): GoalStatus {
    if (goal.archivedAt) return "archived";
    if (goal.achievedAt) return "achieved";
    return "active";
}

/* -------------------------------------------------------------------------- */
/* Data requests — phase one                                                  */
/* -------------------------------------------------------------------------- */

export type SetRequest = { scope: GoalScope };
export type WindowRequest = { scope: GoalScope; sampleSize: number };
export type AccumulationRequest = {
    scope: GoalScope;
    /** ISO instants bounding a half-open range; null means unbounded. */
    from: string | null;
    to: string | null;
};
export type PeriodRequest = {
    scope: GoalScope;
    timeZone: string;
    perDay: number;
};

export type FamilyRequest = {
    set: SetRequest;
    window: WindowRequest;
    accumulation: AccumulationRequest;
    period: PeriodRequest;
};

/** A request tagged with the family that knows how to satisfy it. */
export type DataRequest = {
    [F in GoalFamily]: { family: F; request: FamilyRequest[F] };
}[GoalFamily];

/**
 * Context a target needs to turn itself into a request but cannot know on its
 * own. `createdAt` is what makes a `since_creation` volume period expressible;
 * `now` is passed rather than read so period arithmetic stays testable.
 */
export type RequestContext = { now: Date; createdAt: string };

/* -------------------------------------------------------------------------- */
/* Family data — phase two's output                                           */
/* -------------------------------------------------------------------------- */

/** One row of `goal_set_progress`. */
export type SetData = {
    attempted: number;
    solved: number;
    eligibleTotal: number;
};

/**
 * One row of `goal_window_progress`. Three windows over the same in-scope
 * submissions, because accuracy and speed slice recency differently and a speed
 * goal needs both its own window and an accuracy floor. Counts are raw; the
 * division happens in the evaluator, which is the layer that knows when a
 * sample is too small to divide at all.
 */
export type WindowData = {
    freshSample: number;
    freshCorrect: number;
    gradedSample: number;
    gradedCorrect: number;
    timedSample: number;
    timedTotalMs: number;
};

/** One row of `goal_volume_progress`. */
export type AccumulationData = { gradedSubmissions: number };

/**
 * One row of `goal_streak_progress`. `todayCount` deliberately does not reach
 * `GoalProgressResult` — a target needing a bespoke field on the result belongs
 * in a new family. Surfaces that want it read the family data directly.
 */
export type PeriodData = { streakDays: number; todayCount: number };

export type FamilyData = {
    set: SetData;
    window: WindowData;
    accumulation: AccumulationData;
    period: PeriodData;
};

/* -------------------------------------------------------------------------- */
/* Result — phase three                                                       */
/* -------------------------------------------------------------------------- */

export type GoalDirection = "at_least" | "at_most";

export type GoalProgressUnit =
    | "problems"
    | "percent"
    | "seconds"
    | "days"
    | "submissions";

/**
 * What every surface renders from — list card, detail view, home card. A target
 * that needs a field beyond this shape is a signal it belongs in a new family.
 *
 * Two things this shape gets right and are easy to get wrong:
 *
 * `percentToTarget` measures progress toward the TARGET, not toward the
 * denominator: 50 of a 100-problem goal inside a 1,000-problem scope is 50%,
 * not 5%. For `at_most` targets it inverts, so a speed goal fills up as the
 * student gets faster.
 *
 * `status` exists so that accuracy over 7 of a required 30 attempts is reported
 * as unknown rather than as 23%. Rendering a confident bar for it is a lie the
 * student will act on.
 *
 * Achievement is NOT here: `achievedAt` is goal state, not a computed metric,
 * and the UI must be able to show "achieved 8 July" alongside "currently 78%".
 * Presentation strings are absent for the same reason — number-to-prose belongs
 * in the component, the only layer that knows how much room it has.
 */
export type GoalProgressResult = {
    status: "ok" | "insufficient_data";
    direction: GoalDirection;
    currentValue: number;
    targetValue: number;
    unit: GoalProgressUnit;
    percentToTarget: number;
    isTargetMet: boolean;
    /** Window and period families: how much data actually backed the number. */
    sampleSize?: number;
    /** Set when `status` is `insufficient_data`. */
    requiredSample?: number;
};
