import { describe, expect, test } from "bun:test";
import {
    COUNTER_RANGE,
    createPracticeSettingsForm,
    practiceSettingsFromForm,
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
        expect(form.counterEnabled.seen).toBe(true);
        expect(form.counterRanges.seen).toEqual([2, 8]);
        expect(form.counterEnabled.skipped).toBe(false);
        expect(form.counterRanges.skipped).toEqual(COUNTER_RANGE);
    });

    test("round trips filters and clones every array", () => {
        const form = createPracticeSettingsForm({
            topic: ["geometry"],
            difficulty: [3, 9],
            seriesIds: ["12"],
            timesCorrect: [1, 4],
            computational: true,
            answerAvailability: "without",
            solutionAvailability: "with",
        });
        const snapshot = practiceSettingsFromForm(form);

        form.topic.push("algebra");
        form.difficulty[0] = 0;
        form.seriesIds.push("13");
        form.counterRanges.correct[0] = 0;

        expect(snapshot.topic).toEqual(["geometry"]);
        expect(snapshot.difficulty).toEqual([3, 9]);
        expect(snapshot.seriesIds).toEqual(["12"]);
        expect(snapshot.timesCorrect).toEqual([1, 4]);
        expect(snapshot.computational).toBe(true);
        expect(snapshot.answerAvailability).toBe("without");
        expect(snapshot.solutionAvailability).toBe("with");
    });

    test("disabled counters serialize as null", () => {
        const form = createPracticeSettingsForm({ timesSkipped: [3, 5] });
        form.counterEnabled.skipped = false;
        expect(practiceSettingsFromForm(form).timesSkipped).toBeNull();
    });
});
