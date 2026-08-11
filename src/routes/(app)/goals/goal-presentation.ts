/**
 * Number-to-prose for the goals surfaces.
 *
 * `GoalProgressResult` deliberately carries no presentation strings
 * (`docs/goal-target-architecture.md` §5): the domain layer does not know how
 * much room a card has. This module is that missing layer, kept pure and out of
 * the components so a card, a detail view and a future home tile all read the
 * same sentence — and so the awkward cases (an `at_most` speed target, an
 * `insufficient_data` window, a scope with per-series narrowing) are settled
 * once, with tests, rather than three times in markup.
 */

import {
    describeTarget,
    goalStatus,
    scopeKey,
    type Goal,
    type GoalProgressResult,
    type GoalProgressUnit,
    type GoalScope,
    type GoalStatus,
} from "$lib/goals";
import { topicLabel } from "$lib/library";

/** Series id (string, as the Track stores it) → display name. */
export type SeriesNames = Map<string, string>;

const MS_PER_DAY = 86_400_000;

/**
 * A metric in its own unit. Percentages and durations are rounded here rather
 * than by the caller: a 78.4% coverage and an 84.3s mean are both noise below
 * the decimal point, and rounding at the render site is how two surfaces start
 * disagreeing about the same number.
 */
export function formatMetric(value: number, unit: GoalProgressUnit): string {
    switch (unit) {
        case "percent":
            return `${Math.round(value)}%`;
        case "seconds": {
            const total = Math.round(value);
            if (total < 60) return `${total}s`;
            const minutes = Math.floor(total / 60);
            const seconds = total % 60;
            return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
        }
        default:
            return `${Math.round(value)}`;
    }
}

/** The noun that follows a bare count, singular-aware. Empty for self-labelling
 * units (a percentage and a duration already say what they are). */
export function unitNoun(unit: GoalProgressUnit, value: number): string {
    const one = Math.round(value) === 1;
    switch (unit) {
        case "problems":
            return one ? "problem" : "problems";
        case "submissions":
            return one ? "attempt" : "attempts";
        case "days":
            return one ? "day" : "days";
        default:
            return "";
    }
}

function withNoun(value: number, unit: GoalProgressUnit): string {
    const noun = unitNoun(unit, value);
    return noun ? `${formatMetric(value, unit)} ${noun}` : formatMetric(value, unit);
}

/**
 * The headline: where the student is against the finish line.
 *
 * Three shapes, because the result has three: an unmeasurable window reports
 * its sample instead of a number (never a percentage — §5 of the architecture
 * doc), an `at_most` target reads as a ceiling rather than as a fraction, and
 * everything else is "x of y".
 */
export function progressSummary(result: GoalProgressResult): string {
    if (result.status === "insufficient_data") {
        const have = result.sampleSize ?? 0;
        const need = result.requiredSample ?? 0;
        return `${have} of ${need} attempts measured`;
    }
    if (result.direction === "at_most") {
        return `${withNoun(result.currentValue, result.unit)} · target at most ${withNoun(
            result.targetValue,
            result.unit,
        )}`;
    }
    return `${formatMetric(result.currentValue, result.unit)} of ${withNoun(
        result.targetValue,
        result.unit,
    )}`;
}

/** What backed the number, for surfaces with room to say so. */
export function sampleNote(result: GoalProgressResult): string | null {
    if (result.status === "insufficient_data") {
        const need = result.requiredSample ?? 0;
        return `Not enough data yet — measured once ${need} attempts are in.`;
    }
    if (result.sampleSize === undefined) return null;
    if (result.unit === "percent" && result.direction === "at_least") {
        return `Measured over ${result.sampleSize}.`;
    }
    return `Measured over ${result.sampleSize} attempts.`;
}

/* -------------------------------------------------------------------------- */
/* Scope                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A scope in words. Each series carries its own division/format narrowing in
 * parentheses, because that narrowing applies only within that clause (§3) and
 * a flat list would read as though it applied to all of them.
 */
export function describeScope(scope: GoalScope, names: SeriesNames): string {
    const series = (scope.seriesIds ?? []).map((id) => {
        const name = names.get(id) ?? `Series ${id}`;
        const entry = scope.seriesScopes?.[id];
        const tags = [...(entry?.divisions ?? []), ...(entry?.formats ?? [])];
        return tags.length > 0 ? `${name} (${tags.join(", ")})` : name;
    });
    const topics = (scope.topic ?? []).map((code) => topicLabel(code) ?? code);
    const years = scope.yearRange
        ? `${scope.yearRange[0]}–${scope.yearRange[1]}`
        : null;

    let text: string;
    if (series.length === 0 && topics.length === 0) text = "the whole catalog";
    else if (series.length === 0) text = topics.join(", ");
    else if (topics.length === 0) text = series.join(" · ");
    else text = `${topics.join(", ")} in ${series.join(" · ")}`;

    return years ? `${text}, ${years}` : text;
}

/** The commitment in one line: what, over which slice. */
export function goalSentence(
    goal: Pick<Goal, "target" | "scope">,
    names: SeriesNames,
): string {
    return `${describeTarget(goal.target)} in ${describeScope(goal.scope, names)}`;
}

/* -------------------------------------------------------------------------- */
/* Status, dates                                                              */
/* -------------------------------------------------------------------------- */

export type StatusTone = "active" | "achieved" | "archived" | "overdue";

export function statusChip(
    goal: Pick<Goal, "achievedAt" | "archivedAt" | "deadline">,
    now: Date,
): { label: string; tone: StatusTone } {
    const status: GoalStatus = goalStatus(goal);
    if (status === "archived") return { label: "Archived", tone: "archived" };
    if (status === "achieved") return { label: "Achieved", tone: "achieved" };
    // A passed deadline is a horizon, not a failure (§7) — it changes the
    // wording and nothing else.
    const days = daysUntil(goal.deadline, now);
    if (days !== null && days < 0) return { label: "Overdue", tone: "overdue" };
    return { label: "Active", tone: "active" };
}

/**
 * Whole days from `now` to a `YYYY-MM-DD` deadline, both read as calendar dates
 * in the viewer's zone. Comparing instants instead would call a deadline
 * "tomorrow" at 23:00 and "today" an hour later.
 */
export function daysUntil(deadline: string | null, now: Date): number | null {
    if (!deadline) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(deadline);
    if (!match) return null;
    const due = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((due - today) / MS_PER_DAY);
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
});

export function formatDate(value: string | null): string | null {
    if (!value) return null;
    const date = new Date(
        /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value,
    );
    if (Number.isNaN(date.getTime())) return null;
    return DATE_FORMAT.format(date);
}

/** The deadline as the student reads it, or null when there is none. */
export function deadlineLabel(
    goal: Pick<Goal, "deadline" | "achievedAt" | "archivedAt">,
    now: Date,
): { text: string; overdue: boolean } | null {
    const days = daysUntil(goal.deadline, now);
    if (days === null) return null;
    const on = formatDate(goal.deadline) ?? "";
    // Once a goal is finished the deadline is history, not pressure.
    if (goal.achievedAt || goal.archivedAt) {
        return { text: `Due ${on}`, overdue: false };
    }
    if (days < 0) {
        const late = Math.abs(days);
        return {
            text: `${late} ${late === 1 ? "day" : "days"} past due (${on})`,
            overdue: true,
        };
    }
    if (days === 0) return { text: `Due today (${on})`, overdue: false };
    if (days === 1) return { text: `Due tomorrow (${on})`, overdue: false };
    return { text: `${days} days left (due ${on})`, overdue: false };
}

/**
 * Achievement is sticky, so a goal can be achieved AND currently below its
 * finish line (§7). This is the second line that case needs; null when the two
 * facts agree and one line already tells the truth.
 */
export function achievementNote(
    goal: Pick<Goal, "achievedAt">,
    result: GoalProgressResult | null,
): string | null {
    if (!goal.achievedAt) return null;
    const on = formatDate(goal.achievedAt);
    const achieved = on ? `Achieved ${on}` : "Achieved";
    if (!result || result.status !== "ok" || result.isTargetMet) return achieved;
    return `${achieved} · currently ${formatMetric(result.currentValue, result.unit)}`;
}

/* -------------------------------------------------------------------------- */
/* Editing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A stable string for a target, independent of key order.
 *
 * Key order matters here for an unobvious reason: `target` is a jsonb column,
 * and Postgres stores jsonb keys sorted by (length, bytes) — so a streak target
 * comes back as `{days, type, perDay, timeZone}` while the form builds
 * `{type, days, perDay, timeZone}`. A plain `JSON.stringify` comparison would
 * call every unedited streak goal a material change and offer to reopen it.
 */
export function targetKey(target: unknown): string {
    return JSON.stringify(target, (_key, value) =>
        value && typeof value === "object" && !Array.isArray(value)
            ? Object.fromEntries(
                  Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
                      a < b ? -1 : a > b ? 1 : 0,
                  ),
              )
            : value,
    );
}

/**
 * Whether an edit changes what the goal MEANS. Title and deadline preserve
 * achievement; scope and the finish line do not, so an achieved goal must
 * explicitly reopen (`docs/goals.md` §7).
 */
export function isMaterialEdit(
    goal: Pick<Goal, "scope" | "target">,
    next: { scope: GoalScope; target: unknown },
): boolean {
    return (
        scopeKey(next.scope) !== scopeKey(goal.scope) ||
        targetKey(next.target) !== targetKey(goal.target)
    );
}

/* -------------------------------------------------------------------------- */
/* Achievement stamping                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Goals whose finish line is met but whose `achieved_at` is still null — the
 * ones a surface should stamp on load (`markGoalAchieved`, which is idempotent
 * and first-writer-wins).
 *
 * An unevaluated goal (a family that failed to load) is never stamped: absence
 * of data is not evidence of achievement. Neither is an archived goal, which is
 * no longer promoted, nor an `insufficient_data` result.
 */
export function newlyAchieved(
    goals: Goal[],
    results: Map<number, GoalProgressResult | null>,
): number[] {
    const out: number[] = [];
    for (const goal of goals) {
        if (goal.achievedAt || goal.archivedAt) continue;
        const result = results.get(goal.id);
        if (!result || result.status !== "ok" || !result.isTargetMet) continue;
        out.push(goal.id);
    }
    return out;
}

/** List order: unfinished work first, then achieved, then archived; newest
 * first inside each band. */
export function sortGoals(goals: Goal[]): Goal[] {
    const rank: Record<GoalStatus, number> = {
        active: 0,
        achieved: 1,
        archived: 2,
    };
    return [...goals].sort((a, b) => {
        const byStatus = rank[goalStatus(a)] - rank[goalStatus(b)];
        if (byStatus !== 0) return byStatus;
        return b.createdAt.localeCompare(a.createdAt);
    });
}
