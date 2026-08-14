import { describe, expect, test } from "bun:test";
import {
    coverageOf,
    missingCoverage,
    newModeEligible,
    orderCandidates,
    placementMatchesScope,
    runPracticeQuery,
    runBrowseQuery,
    seededRank,
    type QueryCandidate,
} from "./query";
import { BROWSE_INTENT, type OfflinePlacementV1, type OfflineProblemV1, type PracticeQueryV1 } from "./types";

function placement(
    overrides: Partial<OfflinePlacementV1> & { placementId: number },
): OfflinePlacementV1 {
    return {
        packageRevision: "r",
        canonicalId: 1,
        testId: 1,
        problemNumber: 0,
        topic: "G",
        test: {
            name: "2024 AMC 10A",
            seriesId: 10,
            division: "A",
            format: "Sprint",
            year: 2024,
            aopsCategoryId: null,
        },
        series: { id: 10, name: "AMC 10" },
        ...overrides,
    };
}

function problem(overrides: Partial<OfflineProblemV1> = {}): OfflineProblemV1 {
    return {
        canonicalId: 1,
        contentRevision: "c",
        statement: "A statement.",
        topic: "G",
        choices: ["7"],
        answerIndex: 0,
        answerStatus: "known",
        officialSolutions: null,
        verified: true,
        isComputational: true,
        responseKind: "short_answer",
        aopsId: null,
        tags: null,
        difficulty: null,
        quality: null,
        notes: null,
        builtAt: "2026-01-01T00:00:00.000Z",
        assetKeys: [],
        ...overrides,
    };
}

function candidate(
    canonicalId: number,
    overrides: Partial<QueryCandidate> = {},
): QueryCandidate {
    return {
        canonicalId,
        sourcePackageIds: ["package-a"],
        problem: problem({ canonicalId }),
        placements: [placement({ placementId: canonicalId, canonicalId })],
        rating: null,
        progress: null,
        progressIsProvisional: false,
        ...overrides,
    };
}

const filters: PracticeQueryV1["filters"] = {
    topic: [],
    seriesIds: [],
    seriesScopes: {},
    ratingBand: null,
    verifiedOnly: false,
    computational: null,
    answerAvailability: "with",
    solutionAvailability: "any",
    mastery: [],
};

function query(overrides: Partial<PracticeQueryV1> = {}): PracticeQueryV1 {
    return {
        version: 1,
        intent: "practice-new",
        userId: "u",
        packageIds: [],
        sessionId: 1,
        mode: "new",
        filters,
        excludeCanonicalIds: [],
        order: { kind: "seeded-random", seed: "seed", ratingCenter: null },
        limit: 1,
        ...overrides,
    };
}

describe("scope matching is placement-aware", () => {
    test("a series scope narrows that series and only that series", () => {
        const amc10a = placement({ placementId: 1 });
        const amc12b = placement({
            placementId: 2,
            test: {
                name: "2024 AMC 12B",
                seriesId: 20,
                division: "B",
                format: "Sprint",
                year: 2024,
                aopsCategoryId: null,
            },
            series: { id: 20, name: "AMC 12" },
        });
        const scoped = {
            topic: [],
            seriesIds: ["10", "20"],
            // Only series 10 is narrowed to division A; series 20 is unrestricted.
            seriesScopes: { "10": { divisions: ["A"], formats: [] } },
        };
        expect(placementMatchesScope(amc10a, scoped)).toBe(true);
        expect(placementMatchesScope(amc12b, scoped)).toBe(true);

        const amc10b = placement({
            placementId: 3,
            test: { ...amc10a.test!, division: "B" },
        });
        // Series 10's own narrowing applies; series 20's absence of one does not
        // leak division A onto it, and B is not A.
        expect(placementMatchesScope(amc10b, scoped)).toBe(false);
    });

    test("a canonical enters through any one of its placements", () => {
        const alias = candidate(102, {
            placements: [
                placement({ placementId: 1, canonicalId: 102, topic: "G" }),
                placement({
                    placementId: 2,
                    canonicalId: 102,
                    test: {
                        name: "2024 AMC 12A",
                        seriesId: 20,
                        division: "A",
                        format: "Sprint",
                        year: 2024,
                        aopsCategoryId: null,
                    },
                    series: { id: 20, name: "AMC 12" },
                }),
            ],
        });
        const result = runPracticeQuery([alias], query({
            filters: { ...filters, seriesIds: ["20"] },
        }));
        // Matching the canonical's own first placement would have missed this.
        expect(result.problems.map((entry) => entry.canonicalId)).toEqual([102]);
    });
});

describe("New-mode eligibility", () => {
    test("excludes a problem with any prior factual activity", () => {
        const seen = candidate(1, {
            progress: {
                times_seen: 1,
                times_correct: 0,
                times_reviewed: 1,
                times_skipped: 0,
                last_correct: false,
                last_reviewed_at: null,
                last_submission_at: null,
                next_review_at: null,
                solved: false,
                mastery: null,
                engagement: null,
            },
        });
        expect(newModeEligible(seen, filters)).toBe(false);
    });

    test("excludes an ignored problem, and a blank statement", () => {
        expect(
            newModeEligible(
                candidate(1, {
                    progress: {
                        times_seen: 0,
                        times_correct: 0,
                        times_reviewed: 0,
                        times_skipped: 0,
                        last_correct: null,
                        last_reviewed_at: null,
                        last_submission_at: null,
                        next_review_at: null,
                        solved: false,
                        mastery: null,
                        engagement: "ignored",
                    },
                }),
                filters,
            ),
        ).toBe(false);
        expect(
            newModeEligible(candidate(1, { problem: problem({ statement: "  " }) }), filters),
        ).toBe(false);
    });

    test("requires a comparable answer unless the query asks for answerless work", () => {
        const answerless = candidate(1, {
            problem: problem({ answerStatus: "source_missing", choices: null, answerIndex: null }),
        });
        expect(newModeEligible(answerless, filters)).toBe(false);
        expect(
            newModeEligible(answerless, { ...filters, answerAvailability: "without" }),
        ).toBe(true);
    });

    test("an answer_index outside the choices array is not a comparable answer", () => {
        const broken = candidate(1, {
            problem: problem({ choices: ["7"], answerIndex: 3 }),
        });
        expect(newModeEligible(broken, filters)).toBe(false);
    });
});

describe("deterministic ordering", () => {
    test("is stable for (seed, id) and does not collapse to id order", () => {
        const ids = [1, 2, 3, 4, 5, 6, 7, 8];
        const candidates = ids.map((id) => candidate(id));
        const first = orderCandidates(candidates, {
            kind: "seeded-random",
            seed: "abc",
            ratingCenter: null,
        }, null).map((entry) => entry.canonicalId);
        const again = orderCandidates([...candidates].reverse(), {
            kind: "seeded-random",
            seed: "abc",
            ratingCenter: null,
        }, null).map((entry) => entry.canonicalId);

        expect(again).toEqual(first);
        expect(first).not.toEqual(ids);
        expect(seededRank("abc", 1)).toBe(seededRank("abc", 1));
        expect(seededRank("abc", 1)).not.toBe(seededRank("abd", 1));
    });

    test("nearest-rating prefers the band, then the nearest rated, then unrated", () => {
        const inBand = candidate(1, { rating: { canonicalId: 1, rating: 1210, rd: 60, attempts: 5 } });
        const outside = candidate(2, { rating: { canonicalId: 2, rating: 1600, rd: 60, attempts: 5 } });
        const unrated = candidate(3);
        const ordered = orderCandidates(
            [unrated, outside, inBand],
            { kind: "nearest-rating", seed: "s", ratingCenter: 1200 },
            [1100, 1300],
        );
        expect(ordered.map((entry) => entry.canonicalId)).toEqual([1, 2, 3]);
    });

    test("an empty band still ends at the nearest rated problem, not a dead end", () => {
        const far = candidate(2, { rating: { canonicalId: 2, rating: 1600, rd: 60, attempts: 5 } });
        const ordered = orderCandidates(
            [far],
            { kind: "nearest-rating", seed: "s", ratingCenter: 1200 },
            [1100, 1300],
        );
        expect(ordered.map((entry) => entry.canonicalId)).toEqual([2]);
    });
});

describe("coverage", () => {
    test("a topic no package contains is missing, not exhausted", () => {
        const coverage = coverageOf([candidate(1)]);
        expect(missingCoverage({ topic: ["A"], seriesIds: [] }, coverage)).toEqual({
            topic: ["A"],
            seriesIds: [],
        });
        expect(missingCoverage({ topic: ["G"], seriesIds: ["10"] }, coverage)).toEqual({
            topic: [],
            seriesIds: [],
        });
    });
});

describe("the draw", () => {
    test("honors excludeCanonicalIds and the limit", () => {
        const result = runPracticeQuery(
            [candidate(1), candidate(2), candidate(3)],
            query({ excludeCanonicalIds: [2], limit: 2 }),
        );
        expect(result.availableCount).toBe(2);
        expect(result.problems).toHaveLength(2);
        expect(result.problems.map((entry) => entry.canonicalId)).not.toContain(2);
    });

    test("mastery filters read the effective value, including unassessed", () => {
        const unassessed = candidate(1);
        const confident = candidate(2, {
            progress: {
                times_seen: 0,
                times_correct: 0,
                times_reviewed: 0,
                times_skipped: 0,
                last_correct: null,
                last_reviewed_at: null,
                last_submission_at: null,
                next_review_at: null,
                solved: false,
                mastery: "confident",
                engagement: null,
            },
        });
        const result = runPracticeQuery(
            [unassessed, confident],
            query({ filters: { ...filters, mastery: ["unassessed"] }, limit: 10 }),
        );
        expect(result.problems.map((entry) => entry.canonicalId)).toEqual([1]);
    });
});

describe("browse intent", () => {
    test("keeps attempted problems and emits each placement once", () => {
        const attempted = candidate(1, {
            placements: [
                placement({ placementId: 12, canonicalId: 1, problemNumber: 2 }),
                placement({ placementId: 11, canonicalId: 1, problemNumber: 1 }),
                placement({ placementId: 11, canonicalId: 1, problemNumber: 1 }),
            ],
            progress: {
                times_seen: 1, times_correct: 1, times_reviewed: 0,
                times_skipped: 0, last_correct: true, last_reviewed_at: null,
                last_submission_at: "2026-01-01T00:00:00.000Z", next_review_at: null,
                solved: true, mastery: "confident", engagement: null,
            },
        });
        const result = runBrowseQuery([attempted], {
            version: 1,
            intent: BROWSE_INTENT,
            userId: "u",
            packageIds: [],
            filters: {},
            offset: 0,
            limit: 20,
        });
        expect(result.availableCount).toBe(2);
        expect(result.problems.map((entry) => entry.placement.placementId)).toEqual([11, 12]);
    });
});
