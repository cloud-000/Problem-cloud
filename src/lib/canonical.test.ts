import { describe, expect, test } from "bun:test";
import {
    CANONICAL_STATE_SELECT,
    normalizeEmbeds,
    type ProblemRating,
} from "./library";
import type { ProblemProgress } from "./progress";

describe("canonical & duplicate problem resolution", () => {
    const mockProgress: ProblemProgress = {
        times_seen: 5,
        times_reviewed: 3,
        times_correct: 2,
        times_skipped: 1,
        last_submission_at: "2026-08-01T12:00:00Z",
        last_reviewed_at: "2026-08-01T12:00:00Z",
        last_correct: true,
        next_review_at: "2026-08-05T12:00:00Z",
        solved: true,
        mastery: "confident",
        engagement: "working",
    };

    const mockRating: ProblemRating = {
        rating: 1450,
        rd: 45,
        attempts: 12,
    };

    test("CANONICAL_STATE_SELECT embeds problem_progress and problem_ratings under canonical_id", () => {
        expect(CANONICAL_STATE_SELECT).toContain("canonical:canonical_id");
        expect(CANONICAL_STATE_SELECT).toContain("problem_progress");
        expect(CANONICAL_STATE_SELECT).toContain("problem_ratings");
    });

    test("standalone/canonical problem (canonical_id = null) uses its own embeds", () => {
        const canonicalProblemRow = {
            id: 101,
            n: 18,
            topic: "A",
            canonical_id: null,
            problem_progress: [mockProgress],
            problem_ratings: [{ ...mockRating, scope: "overall" }],
            canonical: null,
        };

        const normalized = normalizeEmbeds(canonicalProblemRow);

        expect(normalized.id).toBe(101);
        expect(normalized.progress).toEqual(mockProgress);
        expect(normalized.rating).toEqual(mockRating);
        expect(normalized.progress?.solved).toBe(true);
        expect(normalized.progress?.times_seen).toBe(5);
        expect(normalized.rating?.rating).toBe(1450);
    });

    test("alias duplicate problem (AMC 10 linked to AMC 12 canonical) inherits canonical progress & rating", () => {
        // AMC 10 problem #18 (id: 202) is an alias for AMC 12 problem #12 (id: 101)
        const aliasProblemRow = {
            id: 202,
            n: 18,
            topic: "A",
            canonical_id: 101,
            // Aliases have empty/null progress & rating directly attached because
            // submissions rewrite problem_id to canonical_id on insert.
            problem_progress: [],
            problem_ratings: [],
            // Supabase embed retrieves canonical's state via CANONICAL_STATE_SELECT:
            canonical: {
                problem_progress: [mockProgress],
                problem_ratings: [{ ...mockRating, scope: "overall" }],
            },
        };

        const normalized = normalizeEmbeds(aliasProblemRow);

        // The returned problem still identifies as problem 202 (AMC 10 #18)
        expect(normalized.id).toBe(202);
        // But its rating and user progress reflect the linked canonical problem (AMC 12 #12)
        expect(normalized.progress).toEqual(mockProgress);
        expect(normalized.rating).toEqual(mockRating);
        expect(normalized.progress?.solved).toBe(true);
        expect(normalized.progress?.times_correct).toBe(2);
        expect(normalized.rating?.rating).toBe(1450);
    });

    test("alias problem without canonical progress returns null progress while keeping shared metadata structure", () => {
        const unseenAliasRow = {
            id: 203,
            n: 19,
            topic: "G",
            canonical_id: 102,
            problem_progress: null,
            problem_ratings: null,
            canonical: {
                problem_progress: null,
                problem_ratings: null,
            },
        };

        const normalized = normalizeEmbeds(unseenAliasRow);

        expect(normalized.id).toBe(203);
        expect(normalized.progress).toBeNull();
        expect(normalized.rating).toBeNull();
    });
});
