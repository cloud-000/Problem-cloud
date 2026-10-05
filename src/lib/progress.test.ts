import { describe, expect, test } from "bun:test";
import {
    reconcileSessionSubmissions,
    reviewEntryFromSubmission,
    reviewScheduleFor,
    statusFor,
    type ProblemProgress,
    type RecentSubmissionRow,
} from "./progress";
import type { ProblemRow } from "./library";

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

describe("reviewEntryFromSubmission", () => {
    const problem = { id: 7, n: 4 } as ProblemRow;

    function submission(
        overrides: Partial<RecentSubmissionRow> = {},
    ): RecentSubmissionRow {
        return {
            selected_choice: null,
            answer: null,
            is_correct: null,
            flagged: false,
            skipped: false,
            problems: problem,
            ...overrides,
        } as RecentSubmissionRow;
    }

    test("carries the stored response through unchanged", () => {
        expect(
            reviewEntryFromSubmission(
                submission({
                    selected_choice: 2,
                    answer: "42",
                    is_correct: true,
                    flagged: true,
                }),
                problem,
            ),
        ).toEqual({
            problem,
            selectedChoice: 2,
            answer: "42",
            correct: true,
            flagged: true,
            skipped: false,
        });
    });

    test("a blank stored answer is not a skip", () => {
        // Persisted submissions store no free-text answer, so inferring a skip
        // from the blank would misread a graded free-response as skipped. The
        // row's own `skipped` is the only authority.
        const entry = reviewEntryFromSubmission(
            submission({ answer: null, is_correct: false }),
            problem,
        );
        expect(entry.answer).toBe("");
        expect(entry.skipped).toBe(false);
    });

    test("an explicit skip is preserved", () => {
        expect(
            reviewEntryFromSubmission(submission({ skipped: true }), problem)
                .skipped,
        ).toBe(true);
    });
});

describe("reconcileSessionSubmissions", () => {
    test("reconciles test submissions with canonical problem IDs to test problems", () => {
        const testProblems: ProblemRow[] = [
            { id: 10, n: 0, test_id: 1 } as unknown as ProblemRow,
            { id: 20, n: 1, canonical_id: 999, test_id: 1 } as unknown as ProblemRow,
        ];
        const submissions: RecentSubmissionRow[] = [
            {
                id: 1,
                user_id: "u1",
                problem_id: 999,
                selected_choice: 3,
                is_correct: true,
                skipped: false,
                flagged: false,
                elapsed_ms: 12000,
                source: "test",
                session_id: 5,
                created_at: "2026-10-04T00:00:00Z",
                problems: { id: 999, n: 5 } as unknown as ProblemRow,
            },
            {
                id: 2,
                user_id: "u1",
                problem_id: 10,
                selected_choice: 0,
                is_correct: true,
                skipped: false,
                flagged: false,
                elapsed_ms: 8000,
                source: "test",
                session_id: 5,
                created_at: "2026-10-04T00:00:00Z",
                problems: { id: 10, n: 0 } as unknown as ProblemRow,
            },
        ];

        const reconciled = reconcileSessionSubmissions(testProblems, submissions);
        expect(reconciled).toHaveLength(2);
        // Order should match testProblems order (Problem id 10, then id 20)
        expect(reconciled[0].problem_id).toBe(10);
        expect(reconciled[0].problems?.id).toBe(10);

        expect(reconciled[1].problem_id).toBe(999);
        expect(reconciled[1].problems?.id).toBe(20);
        expect(reconciled[1].problems?.n).toBe(1);
    });

    test("falls back cleanly when testProblems is empty", () => {
        const submissions: RecentSubmissionRow[] = [
            { id: 1, problem_id: 10 } as unknown as RecentSubmissionRow,
        ];
        expect(reconcileSessionSubmissions([], submissions)).toBe(submissions);
    });
});
