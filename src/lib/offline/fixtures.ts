/**
 * Fixture packages: a real, checksum-correct download with no server behind it.
 *
 * The production package endpoints exist; these fixtures keep the repository
 * and browser lifecycle deterministic without requiring a signed-in server for
 * every unit/E2E run. The whole install → query → write → overlay path is
 * exercised against packages built here — by the same `pageChecksum` the
 * installer verifies, so a fixture that would not survive the real installer
 * does not pass here either.
 *
 * These are also the shared dataset the contract asks for: "contract tests must
 * run the same fixtures through the online eligibility mirror and local engine".
 */

import { pageChecksum } from "./checksum";
import { problemAssets } from "./assets";
import { defaultPracticeSettings } from "$lib/trainer";
import type { PracticeSessionRow } from "$lib/sessions";
import type { OfflineRepository } from "./repository";
import type {
    OfflineAssetV1,
    OfflinePackageBaseStateV1,
    OfflinePackageCreatedV1,
    OfflinePackagePageV1,
    OfflinePersonalStateV1,
    OfflinePlacementV1,
    OfflineProblemRatingV1,
    OfflineProblemV1,
    OfflineScope,
} from "./types";
import type { ProblemProgress } from "$lib/progress";

/** A deterministic, correctly-shaped UUID. Fixtures must be reproducible. */
export function fixtureUuid(seed: string): string {
    let hash = 0x811c9dc5;
    const hex: string[] = [];
    for (let block = 0; block < 4; block += 1) {
        const input = `${seed}#${block}`;
        for (let i = 0; i < input.length; i += 1) {
            hash ^= input.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193) >>> 0;
        }
        hex.push(hash.toString(16).padStart(8, "0"));
    }
    const all = hex.join("");
    return [
        all.slice(0, 8),
        all.slice(8, 12),
        // Pin the version/variant nibbles so the value is a well-formed v4.
        `4${all.slice(13, 16)}`,
        `8${all.slice(17, 20)}`,
        all.slice(20, 32),
    ].join("-");
}

export type FixtureProblem = {
    canonicalId: number;
    statement: string;
    topic: string;
    choices?: string[] | null;
    answerIndex?: number | null;
    answerStatus?: OfflineProblemV1["answerStatus"];
    officialSolutions?: string[] | null;
    verified?: boolean;
    isComputational?: boolean;
    rating?: { rating: number; rd: number; attempts: number } | null;
    progress?: ProblemProgress | null;
    placements: {
        placementId: number;
        testId: number;
        problemNumber: number;
        testName: string;
        seriesId: number;
        seriesName: string;
        division?: string | null;
        format?: string | null;
        year?: number | null;
    }[];
};

export type FixtureSpec = {
    userId: string;
    packageId?: string;
    checkoutId?: string;
    requestId?: string;
    packageRevision?: string;
    contentRevision?: string;
    sessionId?: number;
    scope: OfflineScope;
    problems: FixtureProblem[];
    /** Problems per page; small values exercise the multi-page install path. */
    pageSize?: number;
    downloadedAt?: string;
};

export type FixturePackage = {
    created: OfflinePackageCreatedV1;
    pages: OfflinePackagePageV1[];
    base: OfflinePackageBaseStateV1;
};

function toProblem(
    fixture: FixtureProblem,
    contentRevision: string,
    assets: OfflineAssetV1[],
): OfflineProblemV1 {
    return {
        canonicalId: fixture.canonicalId,
        contentRevision,
        statement: fixture.statement,
        topic: fixture.topic,
        choices: fixture.choices ?? null,
        answerIndex: fixture.answerIndex ?? null,
        answerStatus: fixture.answerStatus ?? "known",
        officialSolutions: fixture.officialSolutions ?? null,
        verified: fixture.verified ?? true,
        isComputational: fixture.isComputational ?? true,
        responseKind: (fixture.choices?.length ?? 0) > 1 ? "mcq" : "short_answer",
        aopsId: null,
        tags: null,
        difficulty: null,
        quality: null,
        notes: null,
        builtAt: "2026-01-01T00:00:00.000Z",
        assetKeys: assets.map((asset) => asset.key),
    };
}

function toPlacements(
    fixture: FixtureProblem,
    packageRevision: string,
): OfflinePlacementV1[] {
    return fixture.placements.map((placement) => ({
        packageRevision,
        placementId: placement.placementId,
        canonicalId: fixture.canonicalId,
        testId: placement.testId,
        problemNumber: placement.problemNumber,
        topic: fixture.topic,
        test: {
            name: placement.testName,
            seriesId: placement.seriesId,
            division: placement.division ?? null,
            format: placement.format ?? null,
            year: placement.year ?? null,
            aopsCategoryId: null,
        },
        series: { id: placement.seriesId, name: placement.seriesName },
    }));
}

export function fixtureSession(
    userId: string,
    sessionId: number,
    startedAt = "2026-08-13T00:00:00.000Z",
): PracticeSessionRow {
    return {
        created_at: startedAt,
        current_elapsed_ms: 0,
        current_problem_id: null,
        ended_at: null,
        id: sessionId,
        is_root: false,
        last_submission_at: null,
        name: "Offline practice",
        settings: {
            ...defaultPracticeSettings(),
            mode: "new",
            format: "practice",
        } as unknown as PracticeSessionRow["settings"],
        started_at: startedAt,
        status: "active",
        times_correct: 0,
        times_reviewed: 0,
        times_seen: 0,
        times_skipped: 0,
        total_time_ms: 0,
        updated_at: startedAt,
        user_id: userId,
    };
}

/** Build a complete, checksum-correct package from a fixture spec. */
export async function buildFixturePackage(
    spec: FixtureSpec,
): Promise<FixturePackage> {
    const packageId = spec.packageId ?? fixtureUuid("package");
    const checkoutId = spec.checkoutId ?? fixtureUuid("checkout");
    const requestId = spec.requestId ?? fixtureUuid("request");
    const packageRevision = spec.packageRevision ?? fixtureUuid("revision");
    const contentRevision = spec.contentRevision ?? fixtureUuid("content");
    const sessionId = spec.sessionId ?? 1;
    const pageSize = spec.pageSize ?? 250;
    const downloadedAt = spec.downloadedAt ?? "2026-08-13T00:00:00.000Z";

    const pages: OfflinePackagePageV1[] = [];
    let problemCount = 0;
    let placementCount = 0;
    let assetCount = 0;

    const chunks: FixtureProblem[][] = [];
    for (let i = 0; i < spec.problems.length; i += pageSize) {
        chunks.push(spec.problems.slice(i, i + pageSize));
    }
    if (chunks.length === 0) chunks.push([]);

    for (const [pageIndex, chunk] of chunks.entries()) {
        const problems: OfflineProblemV1[] = [];
        const placements: OfflinePlacementV1[] = [];
        const assets: OfflineAssetV1[] = [];
        const ratings: OfflineProblemRatingV1[] = [];
        const personalStates: OfflinePersonalStateV1[] = [];

        for (const fixture of chunk) {
            const own = await problemAssets({
                statement: fixture.statement,
                choices: fixture.choices,
                officialSolutions: fixture.officialSolutions,
            });
            for (const asset of own) {
                if (!assets.some((existing) => existing.key === asset.key)) {
                    assets.push(asset);
                }
            }
            problems.push(toProblem(fixture, contentRevision, own));
            placements.push(...toPlacements(fixture, packageRevision));
            if (fixture.rating) {
                ratings.push({ canonicalId: fixture.canonicalId, ...fixture.rating });
            }
            if (fixture.progress !== undefined) {
                personalStates.push({
                    userId: spec.userId,
                    canonicalId: fixture.canonicalId,
                    progress: fixture.progress,
                });
            }
        }

        const records = {
            memberships: chunk.map((fixture) => ({
                packageId,
                packageRevision,
                canonicalId: fixture.canonicalId,
            })),
            problems,
            placements,
            assets,
            personalStates,
            ratings,
        };

        problemCount += problems.length;
        placementCount += placements.length;
        assetCount += assets.length;

        pages.push({
            version: 1,
            packageId,
            checkoutId,
            packageRevision,
            pageIndex,
            nextCursor:
                pageIndex === chunks.length - 1 ? null : `cursor-${pageIndex + 1}`,
            counts: {
                memberships: records.memberships.length,
                problems: problems.length,
                placements: placements.length,
                assets: assets.length,
                personalStates: personalStates.length,
                ratings: ratings.length,
            },
            checksum: await pageChecksum({
                packageId,
                checkoutId,
                packageRevision,
                pageIndex,
                records,
            }),
            records,
        });
    }

    const base = {
        playerRating: {
            rating: 1200,
            rd: 80,
            matches: 12,
            last_match_at: downloadedAt,
        },
        session: fixtureSession(spec.userId, sessionId),
    };
    const created: OfflinePackageCreatedV1 = {
        version: 1,
        packageId,
        requestId,
        checkoutId,
        sessionId,
        normalizedScope: spec.scope,
        contentRevision,
        packageRevision,
        personalStateAt: downloadedAt,
        downloadedAt,
        problemCount,
        placementCount,
        assetCount,
        estimatedBytes: { json: 0, media: 0, total: 0 },
        pageSize,
        firstCursor: pages.length ? "cursor-0" : null,
        baseState: base,
    };

    return {
        created,
        pages,
        base,
    };
}

/** Install a fixture package end to end, exactly as a real download would. */
export async function installFixturePackage(
    repository: OfflineRepository,
    fixture: FixturePackage,
    userId: string,
): Promise<void> {
    await repository.setActiveUser(userId);
    await repository.beginPackage(fixture.created);
    for (const page of fixture.pages) {
        await repository.stagePackagePage(page);
    }
    await repository.commitPackage({
        packageId: fixture.created.packageId,
        checkoutId: fixture.created.checkoutId,
        packageRevision: fixture.created.packageRevision,
        expectedProblems: fixture.created.problemCount,
        expectedPlacements: fixture.created.placementCount,
        expectedAssets: fixture.created.assetCount,
    });
}

// --- The shared sample corpus -----------------------------------------------

const GEOMETRY_SERIES = 10;
const ALGEBRA_SERIES = 20;

/**
 * A Geometry/AMC package with an out-of-scope Algebra neighbour, matching the
 * acceptance scenario's first three steps: a query can narrow this package but
 * cannot expand into Algebra content that was never downloaded.
 */
export function geometryFixtureProblems(): FixtureProblem[] {
    return [
        {
            canonicalId: 101,
            statement: "A circle has radius $r$. What is its area?",
            topic: "G",
            choices: ["$\\pi r^2$", "$2\\pi r$", "$\\pi r$", "$r^2$", "$4\\pi r^2$"],
            answerIndex: 0,
            rating: { rating: 1100, rd: 60, attempts: 40 },
            progress: null,
            placements: [
                {
                    placementId: 1101,
                    testId: 501,
                    problemNumber: 3,
                    testName: "2024 AMC 10A",
                    seriesId: GEOMETRY_SERIES,
                    seriesName: "AMC 10",
                    division: "A",
                    format: "Sprint",
                    year: 2024,
                },
            ],
        },
        {
            canonicalId: 102,
            statement: "Find the area of a triangle with legs $3$ and $4$.",
            topic: "G",
            // A one-element `choices` array is a free-response answer key, not
            // an option list. Nothing may render it as choice A.
            choices: ["6"],
            answerIndex: 0,
            rating: { rating: 1250, rd: 70, attempts: 22 },
            progress: null,
            placements: [
                {
                    placementId: 1102,
                    testId: 501,
                    problemNumber: 7,
                    testName: "2024 AMC 10A",
                    seriesId: GEOMETRY_SERIES,
                    seriesName: "AMC 10",
                    division: "A",
                    format: "Sprint",
                    year: 2024,
                },
                // The same real-world problem, placed under a second test. Its
                // canonical is one row; both placements come down.
                {
                    placementId: 1103,
                    testId: 502,
                    problemNumber: 4,
                    testName: "2024 AMC 12A",
                    seriesId: GEOMETRY_SERIES,
                    seriesName: "AMC 10",
                    division: "B",
                    format: "Sprint",
                    year: 2024,
                },
            ],
        },
        {
            canonicalId: 103,
            statement: "How many diagonals does a convex hexagon have?",
            topic: "G",
            choices: ["9"],
            answerIndex: 0,
            rating: { rating: 1400, rd: 90, attempts: 8 },
            // Already attempted before the download: New mode must skip it.
            progress: {
                times_seen: 2,
                times_correct: 1,
                times_reviewed: 2,
                times_skipped: 0,
                last_correct: true,
                last_reviewed_at: "2026-08-01T00:00:00.000Z",
                last_submission_at: "2026-08-01T00:00:00.000Z",
                next_review_at: "2026-09-01T00:00:00.000Z",
                solved: true,
                mastery: "learning",
                engagement: "working",
            },
            placements: [
                {
                    placementId: 1104,
                    testId: 503,
                    problemNumber: 11,
                    testName: "2023 AMC 10B",
                    seriesId: GEOMETRY_SERIES,
                    seriesName: "AMC 10",
                    division: "B",
                    format: "Sprint",
                    year: 2023,
                },
            ],
        },
        {
            canonicalId: 104,
            statement: "An unrated geometry problem about an inscribed square.",
            topic: "G",
            choices: ["12"],
            answerIndex: 0,
            rating: null,
            progress: null,
            placements: [
                {
                    placementId: 1105,
                    testId: 503,
                    problemNumber: 18,
                    testName: "2023 AMC 10B",
                    seriesId: GEOMETRY_SERIES,
                    seriesName: "AMC 10",
                    division: "B",
                    format: "Sprint",
                    year: 2023,
                },
            ],
        },
    ];
}

/** A second, overlapping package that also contains canonical 102. */
export function overlappingFixtureProblems(): FixtureProblem[] {
    const geometry = geometryFixtureProblems();
    return [
        geometry[1],
        {
            canonicalId: 201,
            statement: "Solve $2x + 5 = 11$ for $x$.",
            topic: "A",
            choices: ["3"],
            answerIndex: 0,
            rating: { rating: 900, rd: 60, attempts: 30 },
            progress: null,
            placements: [
                {
                    placementId: 1201,
                    testId: 601,
                    problemNumber: 1,
                    testName: "2024 AMC 8",
                    seriesId: ALGEBRA_SERIES,
                    seriesName: "AMC 8",
                    division: null,
                    format: "Sprint",
                    year: 2024,
                },
            ],
        },
    ];
}

export const GEOMETRY_SCOPE: OfflineScope = {
    topic: ["G"],
    seriesIds: [String(GEOMETRY_SERIES)],
    seriesScopes: {},
};

export const OVERLAP_SCOPE: OfflineScope = {
    topic: [],
    seriesIds: [String(GEOMETRY_SERIES), String(ALGEBRA_SERIES)],
    seriesScopes: {},
};
