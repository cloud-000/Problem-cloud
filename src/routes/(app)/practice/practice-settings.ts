import { DIFFICULTY_RANGE, boolToTri, triToBool } from "$lib/library";
import {
    ADAPTIVE_RANGE_DEFAULT,
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

export type PracticeSettingsForm = {
    mode: PracticeMode;
    format: SessionFormat;
    testId: number | null;
    timeLimitSeconds: number | null;
    focusMode: boolean;
    topic: string[];
    difficulty: Range;
    verifiedOnly: boolean;
    computational: PracticeTriState;
    answerAvailability: PracticeTriState;
    solutionAvailability: PracticeTriState;
    triesPerProblem: number;
    seriesIds: string[];
    counterRanges: CounterRanges;
    counterEnabled: CounterEnabled;
    lastSubmissionDays: number | null;
    lastOutcome: "any" | "correct" | "incorrect";
    includeUnscheduled: boolean;
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

export function createPracticeSettingsForm(
    raw: Partial<PracticeSettings> = {},
): PracticeSettingsForm {
    const settings = { ...defaultPracticeSettings(), ...raw };
    const counterRanges = {} as CounterRanges;
    const counterEnabled = {} as CounterEnabled;

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
        focusMode: settings.focusMode ?? false,
        topic: [...settings.topic],
        difficulty: [settings.difficulty[0], settings.difficulty[1]],
        verifiedOnly: settings.verifiedOnly,
        computational: boolToTri(settings.computational),
        answerAvailability: availabilityToTri(settings.answerAvailability),
        solutionAvailability: solutionToTri(settings.solutionAvailability),
        triesPerProblem: settings.triesPerProblem ?? 2,
        seriesIds: [...(settings.seriesIds ?? [])],
        counterRanges,
        counterEnabled,
        lastSubmissionDays: settings.lastSubmissionDays,
        lastOutcome: settings.lastOutcome,
        includeUnscheduled: settings.includeUnscheduled,
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
        focusMode: form.focusMode,
        triesPerProblem: form.triesPerProblem,
        seriesIds: [...form.seriesIds],
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
        includeUnscheduled: form.includeUnscheduled,
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

export { DIFFICULTY_RANGE };
