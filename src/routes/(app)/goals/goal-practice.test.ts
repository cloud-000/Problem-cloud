import { describe, expect, test } from "bun:test";
import type { Goal, GoalTargetData } from "$lib/goals";
import type { TrackValue } from "../practice/practice-settings";
import {
    hasRemainingSet,
    practiceSessionName,
    practiceSettingsForGoal,
} from "./goal-practice";

function goal(target: GoalTargetData): Pick<Goal, "scope" | "target"> {
    return {
        scope: {
            topic: ["G"],
            seriesIds: ["7"],
            seriesScopes: { "7": { divisions: ["12A"], formats: [] } },
        },
        target,
    };
}

describe("practice handoff", () => {
    test("hands the goal's scope to the trainer unchanged", () => {
        const settings = practiceSettingsForGoal(
            goal({ type: "attempted_count", count: 40 }),
        );
        expect(settings.topic).toEqual(["G"]);
        expect(settings.seriesIds).toEqual(["7"]);
        expect(settings.seriesScopes).toEqual({
            "7": { divisions: ["12A"], formats: [] },
        });
        // Scope ≡ Track is what makes this free — assert it structurally.
        const track: TrackValue = {
            topic: settings.topic,
            seriesIds: settings.seriesIds ?? [],
            seriesScopes: settings.seriesScopes ?? {},
        };
        expect(track.seriesScopes["7"].divisions).toEqual(["12A"]);
    });

    test("never shares arrays with the goal it came from", () => {
        const source = goal({ type: "attempted_count", count: 40 });
        const settings = practiceSettingsForGoal(source);
        settings.topic.push("A");
        settings.seriesScopes!["7"].divisions.push("12B");
        expect(source.scope.topic).toEqual(["G"]);
        expect(source.scope.seriesScopes["7"].divisions).toEqual(["12A"]);
    });

    test("an attempted goal draws only problems with no graded attempt", () => {
        for (const target of [
            { type: "attempted_count", count: 40 },
            { type: "attempted_percent", percentage: 80 },
        ] as GoalTargetData[]) {
            const settings = practiceSettingsForGoal(goal(target));
            expect(settings.mode).toBe("new");
            expect(settings.timesCorrect).toBeNull();
        }
    });

    test("a solved goal also reworks unsolved problems, never solved ones", () => {
        for (const target of [
            { type: "solved_count", count: 40 },
            { type: "solved_percent", percentage: 80 },
        ] as GoalTargetData[]) {
            const settings = practiceSettingsForGoal(goal(target));
            expect(settings.mode).toBe("mixed");
            expect(settings.timesCorrect).toEqual([0, 0]);
        }
    });

    test("event families practise the scope without a remaining filter", () => {
        for (const target of [
            { type: "volume", count: 100, period: { kind: "since_creation" } },
            { type: "accuracy", percentage: 85, sampleSize: 30 },
            { type: "speed", maxSeconds: 90, sampleSize: 30, minAccuracy: 70 },
            { type: "streak", days: 14, perDay: 5, timeZone: "UTC" },
        ] as GoalTargetData[]) {
            const settings = practiceSettingsForGoal(goal(target));
            expect(settings.mode).toBe("mixed");
            expect(settings.timesCorrect).toBeNull();
            expect(hasRemainingSet({ target })).toBe(false);
        }
        expect(hasRemainingSet({ target: { type: "solved_count", count: 1 } })).toBe(
            true,
        );
    });

    test("an unreadable target still practises the scope", () => {
        const settings = practiceSettingsForGoal({
            scope: { topic: [], seriesIds: [], seriesScopes: {} },
            target: { type: "mastery_percent" } as unknown as GoalTargetData,
        });
        expect(settings.mode).toBe("mixed");
        expect(settings.timesCorrect).toBeNull();
    });

    test("the session is named after the goal, and bounded", () => {
        expect(practiceSessionName({ title: "Cover AMC 10" })).toBe(
            "Goal: Cover AMC 10",
        );
        expect(practiceSessionName({ title: "x".repeat(120) })).toHaveLength(80);
    });
});
