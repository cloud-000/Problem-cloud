/**
 * The target registry: one entry per target type, checked exhaustively at
 * compile time.
 *
 * `TARGETS` is declared with `satisfies` over a mapped type keyed by
 * `GoalTargetType`, which is the load-bearing part — a new member of
 * `GoalTargetData` fails compilation until it is registered here. A `switch`
 * with a `default: throw` would accept an unhandled member silently and throw
 * at runtime, which is exactly how an earlier revision shipped an extensibility
 * example that did not work.
 *
 * Adding a target type: add the union member, add the entry below, add creation
 * UI for its fields, unit-test `evaluate` including its `insufficient_data`
 * boundary. If it joins an existing family, `requires` returns a request that
 * already has a query behind it — no migration, no new RPC, and no changes to
 * any surface, all of which render from `GoalProgressResult` alone.
 */

import { volumeRange } from "./period";
import type {
    DataRequest,
    FamilyData,
    GoalDirection,
    GoalFamily,
    GoalProgressResult,
    GoalProgressUnit,
    GoalScope,
    GoalTargetData,
    GoalTargetType,
    RequestContext,
} from "./types";

/**
 * A sample small enough to be noise is not a form reading: a three-attempt
 * accuracy goal swings wildly enough to make the goal meaningless, and would
 * complete itself on a lucky afternoon.
 */
export const MIN_SAMPLE_SIZE = 10;
export const MAX_SAMPLE_SIZE = 500;

/** What `validate` may consult beyond the target itself. */
export type ValidationContext = {
    /**
     * The current eligible denominator for the goal's scope, when the caller
     * has already resolved it. A count target may not exceed it (§7); when it
     * is unknown, that particular rule is skipped rather than guessed.
     */
    eligibleTotal?: number;
};

type TargetSpec<T extends GoalTargetData, F extends GoalFamily> = {
    family: F;
    requires(target: T, scope: GoalScope, ctx: RequestContext): DataRequest;
    evaluate(target: T, data: FamilyData[F]): GoalProgressResult;
    /** A human-readable reason the target is invalid, or null when it is fine. */
    validate(target: T, ctx: ValidationContext): string | null;
    describe(target: T): string;
};

/** A spec for `T` in whichever family it belongs to. */
type AnyTargetSpec<T extends GoalTargetData> = {
    [F in GoalFamily]: TargetSpec<T, F>;
}[GoalFamily];

/* -------------------------------------------------------------------------- */
/* Shared evaluation helpers                                                  */
/* -------------------------------------------------------------------------- */

function clampPercent(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.min(100, value);
}

/**
 * Progress toward the finish line, in both directions. For `at_most` the ratio
 * inverts so a speed goal fills up as the student gets faster; a current value
 * of zero on an `at_most` target means no data rather than perfection, and the
 * callers below only reach here once a sample exists.
 */
function percentToTarget(
    current: number,
    target: number,
    direction: GoalDirection,
): number {
    if (target <= 0) return 0;
    if (direction === "at_least") return clampPercent((current / target) * 100);
    if (current <= 0) return 0;
    return clampPercent((target / current) * 100);
}

function met(current: number, target: number, direction: GoalDirection): boolean {
    return direction === "at_least" ? current >= target : current <= target;
}

function ok(
    current: number,
    target: number,
    unit: GoalProgressUnit,
    direction: GoalDirection = "at_least",
    sampleSize?: number,
): GoalProgressResult {
    return {
        status: "ok",
        direction,
        currentValue: current,
        targetValue: target,
        unit,
        percentToTarget: percentToTarget(current, target, direction),
        isTargetMet: met(current, target, direction),
        ...(sampleSize === undefined ? {} : { sampleSize }),
    };
}

/**
 * The honest answer when there is not enough behind the number to state one.
 * Never a percentage: a bar rendered from seven of a required thirty attempts
 * is a claim the student will act on.
 */
function insufficient(
    target: number,
    unit: GoalProgressUnit,
    direction: GoalDirection,
    sampleSize: number,
    requiredSample: number,
): GoalProgressResult {
    return {
        status: "insufficient_data",
        direction,
        currentValue: 0,
        targetValue: target,
        unit,
        percentToTarget: 0,
        isTargetMet: false,
        sampleSize,
        requiredSample,
    };
}

function setRequest(scope: GoalScope): DataRequest {
    return { family: "set", request: { scope } };
}

/**
 * A percent target over an empty scope has no denominator to divide by.
 * Reporting 0% would be a claim about the student; `insufficient_data` says
 * what is actually true — there is nothing in scope to measure.
 */
function setPercent(
    numerator: number,
    eligibleTotal: number,
    targetPercentage: number,
): GoalProgressResult {
    if (eligibleTotal <= 0) {
        return insufficient(targetPercentage, "percent", "at_least", 0, 1);
    }
    const current = (numerator / eligibleTotal) * 100;
    return ok(current, targetPercentage, "percent", "at_least", eligibleTotal);
}

function positiveInteger(value: number, label: string): string | null {
    if (!Number.isInteger(value) || value <= 0) {
        return `${label} must be a whole number greater than zero.`;
    }
    return null;
}

function percentage(value: number, label: string): string | null {
    if (!Number.isFinite(value) || value < 1 || value > 100) {
        return `${label} must be between 1 and 100.`;
    }
    return null;
}

function sampleSize(value: number): string | null {
    if (!Number.isInteger(value) || value < MIN_SAMPLE_SIZE) {
        return `Measure over at least ${MIN_SAMPLE_SIZE} problems — a smaller sample is noise.`;
    }
    if (value > MAX_SAMPLE_SIZE) {
        return `Measure over at most ${MAX_SAMPLE_SIZE} problems.`;
    }
    return null;
}

/** Count targets may not exceed the denominator they are counted against. */
function withinDenominator(
    count: number,
    ctx: ValidationContext,
): string | null {
    if (ctx.eligibleTotal === undefined) return null;
    if (count > ctx.eligibleTotal) {
        return `Only ${ctx.eligibleTotal} problems in this scope can be graded.`;
    }
    return null;
}

function countTarget(count: number, ctx: ValidationContext): string | null {
    return positiveInteger(count, "The target") ?? withinDenominator(count, ctx);
}

/* -------------------------------------------------------------------------- */
/* The registry                                                               */
/* -------------------------------------------------------------------------- */

export const TARGETS = {
    attempted_count: {
        family: "set",
        requires: (_t, scope) => setRequest(scope),
        evaluate: (t, d) => ok(d.attempted, t.count, "problems"),
        validate: (t, ctx) => countTarget(t.count, ctx),
        describe: (t) => `Attempt ${t.count} problems`,
    },
    attempted_percent: {
        family: "set",
        requires: (_t, scope) => setRequest(scope),
        evaluate: (t, d) => setPercent(d.attempted, d.eligibleTotal, t.percentage),
        validate: (t) => percentage(t.percentage, "The target"),
        describe: (t) => `Attempt ${t.percentage}% of eligible problems`,
    },
    solved_count: {
        family: "set",
        requires: (_t, scope) => setRequest(scope),
        evaluate: (t, d) => ok(d.solved, t.count, "problems"),
        validate: (t, ctx) => countTarget(t.count, ctx),
        describe: (t) => `Solve ${t.count} problems`,
    },
    solved_percent: {
        family: "set",
        requires: (_t, scope) => setRequest(scope),
        evaluate: (t, d) => setPercent(d.solved, d.eligibleTotal, t.percentage),
        validate: (t) => percentage(t.percentage, "The target"),
        describe: (t) => `Solve ${t.percentage}% of eligible problems`,
    },

    volume: {
        family: "accumulation",
        requires: (t, scope, ctx) => ({
            family: "accumulation",
            request: { scope, ...volumeRange(t.period, ctx) },
        }),
        evaluate: (t, d) => ok(d.gradedSubmissions, t.count, "submissions"),
        validate: (t) => {
            const count = positiveInteger(t.count, "The target");
            if (count) return count;
            if (t.period.kind === "rolling") {
                return positiveInteger(t.period.days, "The number of days");
            }
            if (t.period.kind === "calendar" && !t.period.timeZone) {
                return "A calendar period needs a timezone.";
            }
            return null;
        },
        describe: (t) => {
            const when =
                t.period.kind === "rolling"
                    ? `in ${t.period.days} days`
                    : t.period.kind === "calendar"
                      ? `this ${t.period.unit}`
                      : "in total";
            return `Do ${t.count} problems ${when}`;
        },
    },

    accuracy: {
        family: "window",
        requires: (t, scope) => ({
            family: "window",
            request: { scope, sampleSize: t.sampleSize },
        }),
        evaluate: (t, d) => {
            // The fresh window only: without the first-attempt restriction,
            // re-doing problems you have already seen inflates the number until
            // any accuracy goal completes itself.
            if (d.freshSample < t.sampleSize) {
                return insufficient(
                    t.percentage,
                    "percent",
                    "at_least",
                    d.freshSample,
                    t.sampleSize,
                );
            }
            const current = (d.freshCorrect / d.freshSample) * 100;
            return ok(current, t.percentage, "percent", "at_least", d.freshSample);
        },
        validate: (t) =>
            percentage(t.percentage, "The target") ?? sampleSize(t.sampleSize),
        describe: (t) =>
            `Get ${t.percentage}% right over ${t.sampleSize} fresh problems`,
    },

    speed: {
        family: "window",
        requires: (t, scope) => ({
            family: "window",
            request: { scope, sampleSize: t.sampleSize },
        }),
        evaluate: (t, d) => {
            if (d.timedSample < t.sampleSize) {
                return insufficient(
                    t.maxSeconds,
                    "seconds",
                    "at_most",
                    d.timedSample,
                    t.sampleSize,
                );
            }
            const seconds = d.timedTotalMs / d.timedSample / 1000;
            const result = ok(
                seconds,
                t.maxSeconds,
                "seconds",
                "at_most",
                d.timedSample,
            );
            // The accuracy floor gates achievement but not the bar: progress is
            // shown on the speed axis, while "faster by guessing" is refused
            // here. A floor that cannot be measured yet is treated as unmet —
            // never as satisfied by default.
            const accuracy =
                d.gradedSample > 0
                    ? (d.gradedCorrect / d.gradedSample) * 100
                    : 0;
            return {
                ...result,
                isTargetMet: result.isTargetMet && accuracy >= t.minAccuracy,
            };
        },
        validate: (t) => {
            if (!Number.isFinite(t.maxSeconds) || t.maxSeconds <= 0) {
                return "The time limit must be greater than zero.";
            }
            return (
                sampleSize(t.sampleSize) ??
                percentage(t.minAccuracy, "The accuracy floor")
            );
        },
        describe: (t) =>
            `Average under ${t.maxSeconds}s over ${t.sampleSize} problems, at ${t.minAccuracy}%+ accuracy`,
    },

    streak: {
        family: "period",
        requires: (t, scope) => ({
            family: "period",
            request: { scope, timeZone: t.timeZone, perDay: t.perDay },
        }),
        evaluate: (t, d) => ok(d.streakDays, t.days, "days"),
        validate: (t) =>
            positiveInteger(t.days, "The number of days") ??
            positiveInteger(t.perDay, "The daily target") ??
            (t.timeZone ? null : "A streak needs a timezone."),
        describe: (t) =>
            `Practise ${t.perDay} problems a day for ${t.days} days`,
    },
} satisfies {
    [K in GoalTargetType]: AnyTargetSpec<Extract<GoalTargetData, { type: K }>>;
};

/** A stored target whose `type` we recognise. */
export function isKnownTargetType(type: string): type is GoalTargetType {
    return Object.hasOwn(TARGETS, type);
}

/**
 * Stored targets are untrusted: RLS lets an owner PATCH `target` to any JSON,
 * so a reader that assumed the union would throw a page rather than render one
 * unreadable card. Returning null is that guard — callers show the goal as
 * unreadable and offer to edit it.
 */
export function targetOf(raw: unknown): GoalTargetData | null {
    if (!raw || typeof raw !== "object") return null;
    const type = (raw as { type?: unknown }).type;
    if (typeof type !== "string" || !isKnownTargetType(type)) return null;
    return raw as GoalTargetData;
}

export function familyOf(target: GoalTargetData): GoalFamily {
    return TARGETS[target.type].family;
}

export function describeTarget(target: GoalTargetData): string {
    // The registry is keyed by the discriminator and each entry accepts exactly
    // its own member, but TypeScript cannot see that through the index — hence
    // the single cast, kept to this one dispatch point.
    const spec = TARGETS[target.type] as AnyTargetSpec<GoalTargetData>;
    return spec.describe(target);
}

export function validateTarget(
    target: GoalTargetData,
    ctx: ValidationContext = {},
): string | null {
    const spec = TARGETS[target.type] as AnyTargetSpec<GoalTargetData>;
    return spec.validate(target, ctx);
}

export function requestFor(
    target: GoalTargetData,
    scope: GoalScope,
    ctx: RequestContext,
): DataRequest {
    const spec = TARGETS[target.type] as AnyTargetSpec<GoalTargetData>;
    return spec.requires(target, scope, ctx);
}

export function evaluateTarget(
    target: GoalTargetData,
    data: FamilyData[GoalFamily],
): GoalProgressResult {
    const spec = TARGETS[target.type] as {
        evaluate(t: GoalTargetData, d: FamilyData[GoalFamily]): GoalProgressResult;
    };
    return spec.evaluate(target, data);
}
