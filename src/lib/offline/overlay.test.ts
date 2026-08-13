import { describe, expect, test } from "bun:test";
import { effectiveProgress, hasPriorActivity } from "./overlay";
import type { ProblemProgress } from "$lib/progress";
import type { LocalSubmissionV1 } from "./types";

const base: ProblemProgress = {
    times_seen: 3,
    times_correct: 1,
    times_reviewed: 2,
    times_skipped: 1,
    last_correct: false,
    last_reviewed_at: "2026-07-01T00:00:00.000Z",
    last_submission_at: "2026-07-01T00:00:00.000Z",
    next_review_at: "2026-09-01T00:00:00.000Z",
    solved: true,
    mastery: "learning",
    engagement: "working",
};

function submission(
    overrides: Partial<LocalSubmissionV1> & { sequence: number },
): LocalSubmissionV1 {
    return {
        userId: "u",
        clientKey: `k${overrides.sequence}`,
        operationId: `o${overrides.sequence}`,
        sessionId: 1,
        packageId: "p",
        canonicalId: 101,
        occurredAt: `2026-08-0${overrides.sequence}T00:00:00.000Z`,
        selectedChoice: null,
        answer: null,
        isCorrect: null,
        skipped: false,
        flagged: false,
        elapsedMs: 1000,
        triesUsed: 1,
        ...overrides,
    };
}

describe("effective progress", () => {
    test("with nothing pending, the frozen base is returned unchanged", () => {
        const result = effectiveProgress(base, [], []);
        expect(result.progress).toBe(base);
        expect(result.provisional).toBe(false);
    });

    test("a never-seen problem gains progress from its first local submission", () => {
        const result = effectiveProgress(null, [
            submission({ sequence: 1, isCorrect: true }),
        ]);
        expect(result.progress).toMatchObject({
            times_seen: 1,
            times_reviewed: 1,
            times_correct: 1,
            times_skipped: 0,
            solved: true,
            last_correct: true,
        });
        expect(result.provisional).toBe(true);
    });

    test("a skip counts as seen and skipped, never as reviewed", () => {
        const result = effectiveProgress(null, [
            submission({ sequence: 1, skipped: true }),
        ]);
        expect(result.progress).toMatchObject({
            times_seen: 1,
            times_skipped: 1,
            times_reviewed: 0,
            times_correct: 0,
            solved: false,
        });
    });

    test("the newest graded outcome wins, in sequence order not arrival order", () => {
        const result = effectiveProgress(null, [
            submission({ sequence: 2, isCorrect: false }),
            submission({ sequence: 1, isCorrect: true }),
        ]);
        expect(result.progress?.last_correct).toBe(false);
        // Both were graded, and one was right: solved is a fact, not a mood.
        expect(result.progress?.times_correct).toBe(1);
        expect(result.progress?.solved).toBe(true);
    });

    test("the frozen SM-2 schedule is preserved and flagged, never invented", () => {
        const result = effectiveProgress(base, [
            submission({ sequence: 1, isCorrect: true }),
        ]);
        expect(result.progress?.next_review_at).toBe(base.next_review_at);
        expect(result.scheduleStale).toBe(true);
    });

    test("a skip alone does not stale the schedule", () => {
        const result = effectiveProgress(base, [
            submission({ sequence: 1, skipped: true }),
        ]);
        expect(result.scheduleStale).toBe(false);
    });

    test("a local override wins over the frozen value on its own axis", () => {
        const result = effectiveProgress(
            base,
            [],
            [
                { canonicalId: 101, axis: "mastery", value: "confident", sequence: 5 },
                { canonicalId: 101, axis: "mastery", value: "needs_work", sequence: 9 },
            ],
        );
        expect(result.progress?.mastery).toBe("needs_work");
        // The other axis is untouched by a mastery change.
        expect(result.progress?.engagement).toBe("working");
    });

    test("the frozen base object is never mutated", () => {
        effectiveProgress(base, [submission({ sequence: 1, isCorrect: true })]);
        expect(base.times_seen).toBe(3);
    });
});

describe("prior activity", () => {
    test("is factual only — labelling a problem does not make it seen", () => {
        expect(hasPriorActivity({ ...base, times_seen: 0 })).toBe(false);
        expect(hasPriorActivity(null)).toBe(false);
        expect(hasPriorActivity(base)).toBe(true);
    });
});
