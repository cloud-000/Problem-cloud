/** Repeatable local measurements for docs/offline.md §13. */
import { buildFixturePackage, GEOMETRY_SCOPE, geometryFixtureProblems } from "../src/lib/offline/fixtures";
import { runPracticeQuery, type QueryCandidate } from "../src/lib/offline/query";
import type { OfflinePlacementV1, OfflineProblemV1, PracticeQueryV1 } from "../src/lib/offline/types";

const encoder = new TextEncoder();

function bytes(value: unknown): number {
    return encoder.encode(JSON.stringify(value)).byteLength;
}

function candidate(id: number): QueryCandidate {
    const topic = ["A", "C", "G", "N"][id % 4];
    const seriesId = (id % 12) + 1;
    const problem: OfflineProblemV1 = {
        canonicalId: id,
        contentRevision: "measurement",
        statement: `Synthetic problem ${id}: solve $x_${id} + 1 = 2$.`,
        topic,
        choices: ["1"],
        answerIndex: 0,
        answerStatus: "known",
        officialSolutions: id % 2 ? ["Subtract one."] : null,
        verified: id % 3 !== 0,
        isComputational: id % 2 === 0,
        responseKind: "short_answer",
        aopsId: null,
        tags: null,
        difficulty: null,
        quality: null,
        notes: null,
        builtAt: "2026-08-13T00:00:00.000Z",
        assetKeys: [],
    };
    const placement: OfflinePlacementV1 = {
        packageRevision: "measurement",
        placementId: id,
        canonicalId: id,
        testId: id,
        problemNumber: id % 25,
        topic,
        test: {
            name: `Series ${seriesId} test`,
            seriesId,
            division: id % 2 ? "A" : "B",
            format: "Sprint",
            year: 2026,
            aopsCategoryId: null,
        },
        series: { id: seriesId, name: `Series ${seriesId}` },
    };
    return {
        canonicalId: id,
        problem,
        placements: [placement],
        rating: id % 10 === 0 ? null : {
            canonicalId: id,
            rating: 700 + (id % 1600),
            rd: 80,
            attempts: 5,
        },
        progress: id % 5 === 0 ? {
            times_seen: 0,
            times_correct: 0,
            times_reviewed: 0,
            times_skipped: 0,
            last_correct: null,
            last_reviewed_at: null,
            last_submission_at: null,
            next_review_at: null,
            solved: false,
            mastery: id % 10 === 0 ? "learning" : null,
            engagement: null,
        } : null,
        progressIsProvisional: false,
    };
}

const base: PracticeQueryV1 = {
    version: 1,
    userId: "00000000-0000-4000-8000-0000000000aa",
    packageIds: ["00000000-0000-4000-8000-0000000000bb"],
    sessionId: 1,
    mode: "new",
    filters: {
        topic: [],
        seriesIds: [],
        seriesScopes: {},
        ratingBand: null,
        verifiedOnly: false,
        computational: null,
        answerAvailability: "with",
        solutionAvailability: "any",
        mastery: [],
    },
    excludeCanonicalIds: [],
    order: { kind: "nearest-rating", seed: "measurement", ratingCenter: 1200 },
    limit: 20,
};

function percentile(values: number[], fraction: number): number {
    return values[Math.min(values.length - 1, Math.floor(values.length * fraction))];
}

function measure(candidates: QueryCandidate[], query: PracticeQueryV1) {
    for (let i = 0; i < 10; i += 1) runPracticeQuery(candidates, query);
    const samples: number[] = [];
    for (let i = 0; i < 100; i += 1) {
        const start = performance.now();
        runPracticeQuery(candidates, query);
        samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return {
        p50Ms: Number(percentile(samples, 0.5).toFixed(3)),
        p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
    };
}

const fixture = await buildFixturePackage({
    userId: base.userId,
    scope: GEOMETRY_SCOPE,
    problems: geometryFixtureProblems(),
    pageSize: 2,
});
const candidates = Array.from({ length: 10_000 }, (_, index) => candidate(index + 1));

const results = {
    measuredAt: new Date().toISOString(),
    fixturePayload: {
        canonicals: fixture.created.problemCount,
        placements: fixture.created.placementCount,
        jsonBytes: bytes(fixture.pages),
    },
    candidateQuery: {
        counts: [100, 1_000, 10_000].map((count) => ({
            count,
            unfiltered: measure(candidates.slice(0, count), base),
            compound: measure(candidates.slice(0, count), {
                ...base,
                filters: {
                    ...base.filters,
                    topic: ["G"],
                    seriesIds: ["3", "7", "11"],
                    ratingBand: [1000, 1400],
                    verifiedOnly: true,
                    computational: true,
                    solutionAvailability: "with",
                    mastery: ["unassessed", "learning"],
                },
            }),
        })),
    },
};

console.log(JSON.stringify(results, null, 2));
