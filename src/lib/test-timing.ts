/**
 * Client-side timing rules for Test-format sessions.
 *
 * `tests.time_limit_seconds` is unpopulated for every row today, so the
 * new-session dialog derives a sensible time default from the test's series and
 * format instead. Most tests use a plain "total minutes" slider; two MATHCOUNTS
 * formats are special and expose a *per-unit* slider (the total is derived):
 *
 *   - Target    — problems are worked in pairs, 6 minutes per pair.
 *   - Countdown — 45 seconds per problem.
 *
 * This module is pure (no Svelte, no Supabase): it maps a test's
 * series/format/problem-count to a {@link TimingRule} describing the slider, and
 * converts a chosen slider value to a total in seconds. Only that resolved total
 * is ever persisted (as `PracticeSettings.timeLimitSeconds`); the per-unit framing
 * lives entirely in the picker UI.
 *
 * When `tests.time_limit_seconds` ever becomes non-null it overrides the rule's
 * default (converted into the rule's unit), so a populated column wins without a
 * code change while the rule still defines the slider's *shape*.
 */

export type TimingSliderMode =
    | "per-problem-seconds"
    | "per-pair-minutes"
    | "total-minutes";

export type TimingRule = {
    mode: TimingSliderMode;
    /** Default slider value, expressed in the mode's unit. */
    unitDefault: number;
    unitMin: number;
    unitMax: number;
    unitStep: number;
    /**
     * Number of units the slider value is multiplied across: problems
     * (per-problem), pairs (per-pair), or 1 (whole-test total).
     */
    unitCount: number;
    /** Slider heading, e.g. "Minutes per pair" / "Seconds per problem". */
    unitLabel: string;
};

const TOTAL_MIN_BOUNDS = { unitMin: 5, unitMax: 240, unitStep: 5 };
const PAIR_MIN_BOUNDS = { unitMin: 1, unitMax: 15, unitStep: 1 };
const PROBLEM_SEC_BOUNDS = { unitMin: 15, unitMax: 120, unitStep: 5 };

const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));

const norm = (value: string | null | undefined): string =>
    (value ?? "").trim().toLowerCase();

export type ResolveTimingInput = {
    seriesName: string | null;
    format: string | null;
    problemCount: number;
    /** Non-null `tests.time_limit_seconds` overrides the rule default. */
    dbTimeLimitSeconds?: number | null;
};

/**
 * Resolve the timing rule for a test. Matchers are keyed on series name + format
 * (first match wins); anything unrecognized falls back to a 75-minute total.
 */
export function resolveTimingRule(input: ResolveTimingInput): TimingRule {
    const { seriesName, format, dbTimeLimitSeconds } = input;
    const problemCount = Math.max(1, Math.floor(input.problemCount || 0) || 1);
    const series = norm(seriesName);
    const fmt = norm(format);

    let rule: TimingRule;

    if (series === "mathcounts" && fmt === "target") {
        rule = {
            mode: "per-pair-minutes",
            unitDefault: 6,
            ...PAIR_MIN_BOUNDS,
            unitCount: Math.ceil(problemCount / 2),
            unitLabel: "Minutes per pair",
        };
    } else if (series === "mathcounts" && fmt === "countdown") {
        rule = {
            mode: "per-problem-seconds",
            unitDefault: 45,
            ...PROBLEM_SEC_BOUNDS,
            unitCount: problemCount,
            unitLabel: "Seconds per problem",
        };
    } else {
        rule = {
            mode: "total-minutes",
            unitDefault: totalMinutesDefault(series, fmt),
            ...TOTAL_MIN_BOUNDS,
            unitCount: 1,
            unitLabel: "Time limit",
        };
    }

    // A populated DB column overrides the rule's default, in the rule's own unit.
    if (dbTimeLimitSeconds != null && dbTimeLimitSeconds > 0) {
        rule.unitDefault = totalSecondsToUnit(rule, dbTimeLimitSeconds);
    }
    rule.unitDefault = snap(
        clamp(rule.unitDefault, rule.unitMin, rule.unitMax),
        rule.unitStep,
    );
    return rule;
}

/** Whole-test defaults (minutes) for known series/formats; 75 otherwise. */
function totalMinutesDefault(series: string, fmt: string): number {
    if (series === "mathcounts" && fmt === "sprint") return 40;
    if (series === "mathcounts" && fmt === "team") return 20;
    if (series === "amc 8") return 40;
    if (series === "aime") return 180;
    return 75;
}

/**
 * How a test's time is spent: one pooled clock for the whole test, or a sequence
 * of independently-timed segments where time does not carry over and you cannot
 * return to an earlier segment. Pooled is the historical behavior (AMC/AIME/…);
 * the two MATHCOUNTS formats are segmented — Target into pairs, Countdown into
 * single problems (Countdown is Target with `segmentSize = 1`).
 */
export type Pacing =
    | { kind: "pooled"; totalSeconds: number | null }
    | { kind: "segmented"; segmentSize: number; secondsPerSegment: number };

/**
 * Resolve a chosen slider value into a {@link Pacing}. Per-pair-minutes and
 * per-problem-seconds rules are segmented (2-problem / 1-problem segments); a
 * whole-test minute total is pooled. The caller substitutes `pooled` with a
 * `totalSeconds: null` when the test is set to unlimited.
 */
export function timingPacing(rule: TimingRule, unitValue: number): Pacing {
    const value = Math.round(clamp(unitValue, rule.unitMin, rule.unitMax));
    switch (rule.mode) {
        case "per-pair-minutes":
            return { kind: "segmented", segmentSize: 2, secondsPerSegment: value * 60 };
        case "per-problem-seconds":
            return { kind: "segmented", segmentSize: 1, secondsPerSegment: value };
        case "total-minutes":
            return { kind: "pooled", totalSeconds: value * 60 };
    }
}

/** Total time in seconds for a chosen slider value under a rule. */
export function timingTotalSeconds(rule: TimingRule, unitValue: number): number {
    const value = clamp(unitValue, rule.unitMin, rule.unitMax);
    switch (rule.mode) {
        case "per-problem-seconds":
            return Math.round(value) * rule.unitCount;
        case "per-pair-minutes":
            return Math.round(value) * 60 * rule.unitCount;
        case "total-minutes":
            return Math.round(value) * 60;
    }
}

/** Inverse of {@link timingTotalSeconds}: express a total in the rule's unit. */
function totalSecondsToUnit(rule: TimingRule, totalSeconds: number): number {
    switch (rule.mode) {
        case "per-problem-seconds":
            return Math.round(totalSeconds / rule.unitCount);
        case "per-pair-minutes":
            return Math.round(totalSeconds / 60 / rule.unitCount);
        case "total-minutes":
            return Math.round(totalSeconds / 60);
    }
}

function snap(value: number, step: number): number {
    if (step <= 0) return value;
    return Math.round(value / step) * step;
}

/** Format a duration as "24 min", "1 min 30 s", or "45 s". */
export function formatDuration(totalSeconds: number): string {
    const seconds = Math.max(0, Math.round(totalSeconds));
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs} s`;
    if (secs === 0) return `${mins} min`;
    return `${mins} min ${secs} s`;
}

/**
 * Human summary of the derived total for display beneath the slider, e.g.
 * "4 pairs × 6 min = 24 min" or "80 × 45s = 60 min". For a whole-test slider it
 * reduces to just the total ("40 min").
 */
export function timingSummary(rule: TimingRule, unitValue: number): string {
    const value = Math.round(clamp(unitValue, rule.unitMin, rule.unitMax));
    const total = formatDuration(timingTotalSeconds(rule, value));
    switch (rule.mode) {
        case "per-pair-minutes": {
            const pairs = rule.unitCount === 1 ? "1 pair" : `${rule.unitCount} pairs`;
            return `${pairs} × ${value} min = ${total} total`;
        }
        case "per-problem-seconds":
            return `${rule.unitCount} × ${value}s = ${total} total`;
        case "total-minutes":
            return `${total} total`;
    }
}
