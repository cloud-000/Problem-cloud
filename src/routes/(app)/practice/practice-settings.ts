import { boolToTri, triToBool } from "$lib/library";
import type { Pacing } from "$lib/test-timing";
import type { DimensionOption } from "$lib/series-review";
import type { Engagement, Mastery } from "$lib/progress";
import {
    ADAPTIVE_RANGE_DEFAULT,
    RATING_RANGE,
    defaultPracticeSettings,
    type PracticeMode,
    type PracticeSettings,
    type Range,
    type SessionFormat,
} from "$lib/trainer";

export const COUNTER_RANGE: Range = [0, 25];
export const TRIES_RANGE: Range = [1, 5];

export type PracticeTriState = "on" | "off" | "neutral";
export type CounterKey = "seen" | "reviewed" | "correct" | "skipped";
export type CounterRanges = Record<CounterKey, Range>;
export type CounterEnabled = Record<CounterKey, boolean>;
/** Per-series division/format narrowing, keyed by series id (string). */
export type SeriesScope = { divisions: string[]; formats: string[] };
export type SeriesScopes = Record<string, SeriesScope>;

/**
 * A settings-panel row for narrowing one selected series by division/format.
 * Built per selected *classified* series (unclassified series get no row); the
 * option lists come from that series' tests.
 */
export type SeriesScopeConfig = {
    id: string;
    name: string;
    divisionOptions: DimensionOption[];
    formatOptions: DimensionOption[];
};

/**
 * The "what is this session about" slice of {@link PracticeSettingsForm} —
 * topic + series + division/format narrowing. Shared by the session-creation
 * dialog (`Track.svelte` in `SessionsView`) and the mid-session settings panel
 * (`Track.svelte` in `SettingsPanel`), so a full `PracticeSettingsForm`
 * structurally satisfies it with zero conversion.
 */
export type TrackValue = Pick<
    PracticeSettingsForm,
    "topic" | "seriesIds" | "seriesScopes"
>;

export function createTrackValue(): TrackValue {
    return { topic: [], seriesIds: [], seriesScopes: {} };
}

/** Deep-clone the per-series scope map so form and snapshot never share arrays. */
function cloneScopes(raw: SeriesScopes | undefined | null): SeriesScopes {
    const out: SeriesScopes = {};
    for (const [id, scope] of Object.entries(raw ?? {})) {
        out[id] = {
            divisions: [...(scope?.divisions ?? [])],
            formats: [...(scope?.formats ?? [])],
        };
    }
    return out;
}

export type PracticeSettingsForm = {
    mode: PracticeMode;
    format: SessionFormat;
    testId: number | null;
    timeLimitSeconds: number | null;
    pacing: Pacing | null;
    strictTiming: boolean;
    allowPause: boolean;
    revealPerSegment: boolean;
    focusMode: boolean;
    topic: string[];
    difficulty: Range;
    verifiedOnly: boolean;
    computational: PracticeTriState;
    answerAvailability: PracticeTriState;
    solutionAvailability: PracticeTriState;
    triesPerProblem: number;
    perProblemSeconds: number | null;
    seriesIds: string[];
    seriesScopes: SeriesScopes;
    counterRanges: CounterRanges;
    counterEnabled: CounterEnabled;
    lastSubmissionDays: number | null;
    lastOutcome: "any" | "correct" | "incorrect";
    includeUnscheduled: boolean;
    mastery: (Mastery | "unassessed")[];
    listEngagement: Engagement;
    adaptive: boolean;
    adaptiveRange: number;
};

const COUNTER_FIELDS: Record<CounterKey, keyof PracticeSettings> = {
    seen: "timesSeen",
    reviewed: "timesReviewed",
    correct: "timesCorrect",
    skipped: "timesSkipped",
};

function availabilityToTri(
    value: "with" | "without" | "any" | undefined,
): PracticeTriState {
    return value === "without" ? "on" : value === "any" ? "neutral" : "off";
}

function solutionToTri(
    value: "with" | "without" | "any" | undefined,
): PracticeTriState {
    return value === "with" ? "on" : value === "without" ? "off" : "neutral";
}

/**
 * Difficulty is now a Glicko-rating band (see {@link RATING_RANGE}). Legacy
 * snapshots stored it in the old 0–100 domain; those sit entirely below the
 * rating floor, so reset them to full range (no constraint) rather than letting
 * the slider clamp both handles to the minimum. Otherwise just clamp into bounds.
 */
function normalizeDifficulty(range: Range): Range {
    if (range[1] < RATING_RANGE[0]) return [...RATING_RANGE];
    return [
        Math.max(range[0], RATING_RANGE[0]),
        Math.min(range[1], RATING_RANGE[1]),
    ];
}

export function createPracticeSettingsForm(
    raw: Partial<PracticeSettings> = {},
): PracticeSettingsForm {
    const settings = { ...defaultPracticeSettings(), ...raw };
    const counterRanges = {} as CounterRanges;
    const counterEnabled = {} as CounterEnabled;

    // Migrate a legacy flat divisions/formats snapshot (the single-series-gate
    // era) into the per-series map: those tags implicitly belonged to the one
    // selected series, so re-key them onto it. Newer snapshots carry
    // `seriesScopes` directly and skip this.
    let seriesScopes = cloneScopes(settings.seriesScopes);
    const legacy = raw as { divisions?: string[]; formats?: string[] };
    if (
        Object.keys(seriesScopes).length === 0 &&
        ((legacy.divisions?.length ?? 0) > 0 || (legacy.formats?.length ?? 0) > 0) &&
        (settings.seriesIds?.length ?? 0) === 1
    ) {
        seriesScopes = {
            [settings.seriesIds![0]]: {
                divisions: [...(legacy.divisions ?? [])],
                formats: [...(legacy.formats ?? [])],
            },
        };
    }

    for (const key of Object.keys(COUNTER_FIELDS) as CounterKey[]) {
        const range = settings[COUNTER_FIELDS[key]] as Range | null;
        counterEnabled[key] = range != null;
        counterRanges[key] = range ? [range[0], range[1]] : [...COUNTER_RANGE];
    }

    return {
        mode: settings.mode,
        format: settings.format ?? "practice",
        testId: settings.testId ?? null,
        timeLimitSeconds: settings.timeLimitSeconds ?? null,
        pacing: settings.pacing ?? null,
        strictTiming: settings.strictTiming ?? true,
        allowPause: settings.allowPause ?? false,
        revealPerSegment: settings.revealPerSegment ?? false,
        focusMode: settings.focusMode ?? false,
        topic: [...settings.topic],
        difficulty: normalizeDifficulty(settings.difficulty),
        verifiedOnly: settings.verifiedOnly,
        computational: boolToTri(settings.computational),
        answerAvailability: availabilityToTri(settings.answerAvailability),
        solutionAvailability: solutionToTri(settings.solutionAvailability),
        triesPerProblem: settings.triesPerProblem ?? 2,
        perProblemSeconds: settings.perProblemSeconds ?? null,
        seriesIds: [...(settings.seriesIds ?? [])],
        seriesScopes,
        counterRanges,
        counterEnabled,
        lastSubmissionDays: settings.lastSubmissionDays,
        lastOutcome: settings.lastOutcome,
        includeUnscheduled: false,
        mastery: [...(settings.mastery ?? [])],
        listEngagement: settings.listEngagement ?? "working",
        adaptive: settings.adaptive ?? true,
        adaptiveRange: settings.adaptiveRange ?? ADAPTIVE_RANGE_DEFAULT,
    };
}

export function counterFilter(
    form: PracticeSettingsForm,
    key: CounterKey,
): Range | null {
    return form.counterEnabled[key] ? [...form.counterRanges[key]] : null;
}

export function practiceSettingsFromForm(
    form: PracticeSettingsForm,
): PracticeSettings {
    return {
        mode: form.mode,
        format: form.format,
        testId: form.testId,
        timeLimitSeconds: form.timeLimitSeconds,
        pacing: form.pacing,
        strictTiming: form.strictTiming,
        allowPause: form.allowPause,
        revealPerSegment: form.revealPerSegment,
        focusMode: form.focusMode,
        triesPerProblem: form.triesPerProblem,
        perProblemSeconds: form.perProblemSeconds,
        seriesIds: [...form.seriesIds],
        seriesScopes: cloneScopes(form.seriesScopes),
        topic: [...form.topic],
        difficulty: [form.difficulty[0], form.difficulty[1]],
        verifiedOnly: form.verifiedOnly,
        computational: triToBool(form.computational),
        answerAvailability:
            form.answerAvailability === "on"
                ? "without"
                : form.answerAvailability === "neutral"
                  ? "any"
                  : "with",
        solutionAvailability:
            form.solutionAvailability === "on"
                ? "with"
                : form.solutionAvailability === "off"
                  ? "without"
                  : "any",
        timesSeen: counterFilter(form, "seen"),
        timesReviewed: counterFilter(form, "reviewed"),
        timesCorrect: counterFilter(form, "correct"),
        timesSkipped: counterFilter(form, "skipped"),
        lastSubmissionDays: form.lastSubmissionDays,
        lastOutcome: form.lastOutcome,
        includeUnscheduled: false,
        mastery: [...form.mastery],
        listEngagement: form.listEngagement,
        adaptive: form.adaptive,
        adaptiveRange: form.adaptiveRange,
    };
}

export function resetPracticeSettingsForm(
    form: PracticeSettingsForm,
): void {
    const defaults = createPracticeSettingsForm({ focusMode: false });
    Object.assign(form, defaults);
}

export { RATING_RANGE };
