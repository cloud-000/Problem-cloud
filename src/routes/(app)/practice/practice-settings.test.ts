import { describe, expect, test } from "bun:test";
import {
    COUNTER_RANGE,
    clampProblemNumbers,
    clampYearRange,
    configsForSelectedSeries,
    createPracticeSettingsForm,
    practiceSettingsFromForm,
    problemNumberRange,
    yearRange,
    type SeriesScopeConfig,
} from "./practice-settings";

describe("practice settings form", () => {
    test("hydrates old and partial snapshots over canonical defaults", () => {
        const form = createPracticeSettingsForm({
            mode: "review",
            topic: ["algebra"],
            timesSeen: [2, 8],
            adaptive: undefined,
            seriesIds: undefined,
        });

        expect(form.mode).toBe("review");
        expect(form.format).toBe("practice");
        expect(form.triesPerProblem).toBe(2);
        expect(form.adaptive).toBe(true);
        expect(form.seriesIds).toEqual([]);
        expect(form.seriesScopes).toEqual({});
        expect(form.counterEnabled.seen).toBe(true);
        expect(form.counterRanges.seen).toEqual([2, 8]);
        expect(form.counterEnabled.skipped).toBe(false);
        expect(form.counterRanges.skipped).toEqual(COUNTER_RANGE);
    });

    test("round trips filters and clones every array", () => {
        const form = createPracticeSettingsForm({
            topic: ["geometry"],
            difficulty: [800, 1600],
            seriesIds: ["12"],
            seriesScopes: {
                "12": {
                    divisions: ["State"],
                    formats: ["Sprint"],
                    problemNumbers: [21, 25],
                },
            },
            timesCorrect: [1, 4],
            computational: true,
            answerAvailability: "without",
            solutionAvailability: "with",
        });
        const snapshot = practiceSettingsFromForm(form);

        form.topic.push("algebra");
        form.difficulty[0] = 0;
        form.seriesIds.push("13");
        form.seriesScopes["12"].divisions.push("National");
        form.seriesScopes["12"].problemNumbers![0] = 1;
        form.seriesScopes["13"] = { divisions: ["Chapter"], formats: [] };
        form.counterRanges.correct[0] = 0;

        expect(snapshot.topic).toEqual(["geometry"]);
        expect(snapshot.difficulty).toEqual([800, 1600]);
        expect(snapshot.seriesIds).toEqual(["12"]);
        expect(snapshot.seriesScopes).toEqual({
            "12": {
                divisions: ["State"],
                formats: ["Sprint"],
                problemNumbers: [21, 25],
            },
        });
        expect(snapshot.timesCorrect).toEqual([1, 4]);
        expect(snapshot.computational).toBe(true);
        expect(snapshot.answerAvailability).toBe("without");
        expect(snapshot.solutionAvailability).toBe("with");
    });

    test("migrates a legacy flat divisions/formats snapshot onto its series", () => {
        const form = createPracticeSettingsForm({
            seriesIds: ["12"],
            // Legacy single-series-gate shape (pre-per-series scopes).
            divisions: ["State"],
            formats: ["Sprint"],
        } as Partial<Parameters<typeof createPracticeSettingsForm>[0]> & {
            divisions: string[];
            formats: string[];
        });
        expect(form.seriesScopes).toEqual({
            "12": { divisions: ["State"], formats: ["Sprint"] },
        });
    });

    test("does not migrate legacy tags when the series is ambiguous", () => {
        const form = createPracticeSettingsForm({
            seriesIds: ["12", "13"],
            divisions: ["State"],
        } as Partial<Parameters<typeof createPracticeSettingsForm>[0]> & {
            divisions: string[];
        });
        expect(form.seriesScopes).toEqual({});
    });

    test("disabled counters serialize as null", () => {
        const form = createPracticeSettingsForm({ timesSkipped: [3, 5] });
        form.counterEnabled.skipped = false;
        expect(practiceSettingsFromForm(form).timesSkipped).toBeNull();
    });
});

describe("configsForSelectedSeries", () => {
    const loaded: SeriesScopeConfig[] = [
        { id: "1", name: "AMC 10", divisionOptions: [], formatOptions: [] },
        { id: "2", name: "AMC 12", divisionOptions: [], formatOptions: [] },
    ];

    test("drops loaded rows the moment a series leaves the selection", () => {
        expect(configsForSelectedSeries(loaded, [])).toEqual([]);
        expect(configsForSelectedSeries(loaded, ["2"]).map((c) => c.id)).toEqual(
            ["2"],
        );
    });
});

describe("problem-number helpers", () => {
    test("a missing or full range is not a narrowing", () => {
        expect(problemNumberRange(undefined)).toBeNull();
        expect(problemNumberRange({ problemNumbers: [1, 25] }, 25)).toBeNull();
        expect(problemNumberRange({ problemNumbers: [1, 30] }, 25)).toBeNull();
        expect(problemNumberRange({ problemNumbers: [21, 25] }, 25)).toEqual([
            21, 25,
        ]);
        expect(problemNumberRange({ problemNumbers: [21, 25] })).toEqual([
            21, 25,
        ]);
    });

    test("rejects inverted or non-positive stored ranges", () => {
        expect(problemNumberRange({ problemNumbers: [5, 2] })).toBeNull();
        expect(problemNumberRange({ problemNumbers: [0, 10] })).toBeNull();
    });

    test("clamps onto a shorter number line and resets ranges past it", () => {
        expect(clampProblemNumbers([21, 25], 25)).toEqual([21, 25]);
        expect(clampProblemNumbers([1, 25], 25)).toBeUndefined();
        expect(clampProblemNumbers([1, 25], 8)).toBeUndefined();
        expect(clampProblemNumbers([21, 25], 8)).toBeUndefined();
        expect(clampProblemNumbers([5, 25], 8)).toEqual([5, 8]);
        expect(clampProblemNumbers(undefined, 25)).toBeUndefined();
    });
});

describe("year-range helpers", () => {
    test("a missing or full span is not a narrowing", () => {
        expect(yearRange(undefined)).toBeNull();
        expect(yearRange({ yearRange: [2010, 2024] }, { min: 2010, max: 2024 })).toBeNull();
        expect(yearRange({ yearRange: [1990, 2030] }, { min: 2000, max: 2020 })).toBeNull();
        expect(yearRange({ yearRange: [2015, 2018] }, { min: 2010, max: 2024 })).toEqual([
            2015, 2018,
        ]);
        expect(yearRange({ yearRange: [2015, 2018] })).toEqual([2015, 2018]);
    });

    test("rejects inverted stored ranges", () => {
        expect(yearRange({ yearRange: [2024, 2010] })).toBeNull();
    });

    test("clamps onto a shorter span and resets ranges past it", () => {
        expect(clampYearRange([2015, 2018], { min: 2010, max: 2024 })).toEqual([
            2015, 2018,
        ]);
        expect(clampYearRange([2010, 2024], { min: 2010, max: 2024 })).toBeUndefined();
        expect(clampYearRange([2020, 2024], { min: 2010, max: 2015 })).toBeUndefined();
        expect(clampYearRange([2000, 2005], { min: 2010, max: 2024 })).toBeUndefined();
        expect(clampYearRange([2008, 2012], { min: 2010, max: 2015 })).toEqual([
            2010, 2012,
        ]);
        expect(clampYearRange(undefined, { min: 2010, max: 2024 })).toBeUndefined();
    });
});
