import { describe, expect, test } from "bun:test";
import {
    applyPersonalProblemState,
    normalizeReviewProblem,
    reviewRowLabel,
    type SeriesReviewProblem,
    type SeriesReviewTest,
} from "./series-review";

describe("series review canonical progress", () => {
    const canonicalProgress = {
        times_seen: 3,
        times_correct: 2,
        times_reviewed: 3,
        times_skipped: 0,
        last_correct: true,
        last_reviewed_at: "2026-08-01T12:00:00Z",
        last_submission_at: "2026-08-01T12:00:00Z",
        next_review_at: "2026-08-05T12:00:00Z",
        solved: true,
        mastery: "confident" as const,
        engagement: "revisit" as const,
    };

    test("canonical placement uses its own progress", () => {
        const problem = normalizeReviewProblem({
            id: 39563,
            n: 11,
            canonical_id: null,
            problem_progress: [canonicalProgress],
            canonical: null,
        });

        expect(problem.stateProblemId).toBe(39563);
        expect(problem.progress).toEqual(canonicalProgress);
    });

    test("alias placement inherits canonical progress and ignores stale direct state", () => {
        const problem = normalizeReviewProblem({
            id: 40705,
            n: 8,
            canonical_id: 39563,
            problem_progress: [{ ...canonicalProgress, mastery: "needs_work" }],
            canonical: { problem_progress: [canonicalProgress] },
        });

        expect(problem.id).toBe(40705);
        expect(problem.stateProblemId).toBe(39563);
        expect(problem.progress).toEqual(canonicalProgress);
    });

    test("first organization choice creates local progress for every shared placement", () => {
        const alias: SeriesReviewProblem = {
            id: 40705,
            n: 8,
            stateProblemId: 39563,
            progress: null,
        };
        const updated = applyPersonalProblemState(alias, {
            problem_id: 39563,
            mastery: "learning",
            engagement: "working",
        });

        expect(updated.progress).toMatchObject({
            times_seen: 0,
            solved: false,
            mastery: "learning",
            engagement: "working",
        });
    });

    test("organization result does not alter an unrelated placement", () => {
        const problem: SeriesReviewProblem = {
            id: 1,
            n: 0,
            stateProblemId: 1,
            progress: null,
        };

        expect(
            applyPersonalProblemState(problem, {
                problem_id: 2,
                mastery: "confident",
                engagement: null,
            }),
        ).toBe(problem);
    });

    test("reviewRowLabel formats division and format, or falls back to test name", () => {
        const amcTest: SeriesReviewTest = {
            id: 1,
            name: "2024 AMC 10A",
            year: 2024,
            division: null,
            division_order: null,
            format: "A",
            format_order: 1,
            problems: [],
        };
        expect(reviewRowLabel(amcTest)).toBe("A");

        const mathcountsTest: SeriesReviewTest = {
            id: 2,
            name: "2024 Chapter Sprint",
            year: 2024,
            division: "Chapter",
            division_order: 1,
            format: "Sprint",
            format_order: 1,
            problems: [],
        };
        expect(reviewRowLabel(mathcountsTest)).toBe("Chapter · Sprint");
    });
});
