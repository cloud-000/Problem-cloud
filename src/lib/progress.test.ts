import { describe, expect, test } from "bun:test";
import { reviewScheduleFor, statusFor, type ProblemProgress } from "./progress";

function progress(overrides: Partial<ProblemProgress> = {}): ProblemProgress {
    return {
        times_seen: 0,
        times_reviewed: 0,
        times_correct: 0,
        times_skipped: 0,
        last_submission_at: null,
        last_reviewed_at: null,
        last_correct: null,
        next_review_at: null,
        solved: false,
        mastery: null,
        engagement: null,
        ...overrides,
    };
}

describe("problem state dimensions", () => {
    test("activity uses factual counters, not mastery or plan", () => {
        expect(statusFor(null)).toBe("unseen");
        expect(statusFor(progress({ mastery: "confident", engagement: "working" }))).toBe(
            "unseen",
        );
        expect(statusFor(progress({ times_seen: 1, times_skipped: 1 }))).toBe(
            "skipped_only",
        );
        expect(statusFor(progress({ times_seen: 1, times_reviewed: 1 }))).toBe(
            "attempted",
        );
        expect(statusFor(progress({ times_seen: 1 }))).toBe("attempted");
        expect(
            statusFor(
                progress({ times_seen: 2, times_reviewed: 2, times_correct: 1, solved: true }),
            ),
        ).toBe("solved");
    });

    test("review due is derived only from next_review_at", () => {
        const now = new Date("2026-07-10T12:00:00Z").getTime();
        expect(reviewScheduleFor(progress(), now)).toBe("unscheduled");
        expect(
            reviewScheduleFor(progress({ next_review_at: "2026-07-10T11:59:00Z" }), now),
        ).toBe("due");
        expect(
            reviewScheduleFor(progress({ next_review_at: "2026-07-10T12:01:00Z" }), now),
        ).toBe("upcoming");
    });
});
