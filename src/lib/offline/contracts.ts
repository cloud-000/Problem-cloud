/**
 * Runtime parsers for the V1 offline contracts.
 *
 * One parser per boundary shape, built from `parse.ts`. The rule from
 * `docs/offline-contracts.md` §2d — "the endpoint uses an explicit select and
 * runtime validator, never `*`, so a new database column cannot silently alter
 * the protocol" — has a browser half, and this is it: what the parsers below
 * keep *is* the durable projection. A column added upstream reaches local
 * storage only by being added here first.
 */

import * as p from "./parse";
import {
    PAGE_MAX_ASSETS,
    PAGE_MAX_PLACEMENTS,
    PAGE_MAX_PROBLEMS,
    PACKAGE_MAX_CANONICALS,
    SCOPE_MAX_SERIES,
    SCOPE_MAX_TOPICS,
    SYNC_MAX_DEPENDENCIES,
    SYNC_MAX_OPERATIONS,
} from "./limits";
import type {
    OfflineAssetV1,
    OfflineOperationV1,
    OfflinePackageCreateRequestV1,
    OfflinePackageCreatedV1,
    OfflinePackageMembershipV1,
    OfflinePackagePageV1,
    OfflinePackageRecordsV1,
    OfflinePersonalStateV1,
    OfflinePlacementV1,
    OfflineProblemRatingV1,
    OfflineProblemV1,
    OfflineScope,
    OfflineSyncErrorV1,
    OfflineSyncRequestV1,
    OfflineSyncResponseV1,
    PracticeQueryV1,
} from "./types";
import type { Engagement, Mastery, ProblemProgress } from "$lib/progress";
import type { PlayerRating } from "$lib/library";
import type { PracticeSessionRow } from "$lib/sessions";

// --- Shared vocabulary -------------------------------------------------------

export const MASTERY_VALUES = ["needs_work", "learning", "confident"] as const;
export const ENGAGEMENT_VALUES = ["working", "revisit", "later", "ignored"] as const;

export const parseMastery = p.enumOf(MASTERY_VALUES) as p.Parser<Mastery>;
export const parseEngagement = p.enumOf(ENGAGEMENT_VALUES) as p.Parser<Engagement>;

export const parseScope: p.Parser<OfflineScope> = p.objectOf<OfflineScope>({
    topic: p.arrayOf(p.nonEmptyString, { max: SCOPE_MAX_TOPICS }),
    seriesIds: p.arrayOf(p.nonEmptyString, { max: SCOPE_MAX_SERIES }),
    seriesScopes: p.recordOf(
        p.objectOf<{ divisions: string[]; formats: string[] }>({
            divisions: p.arrayOf(p.string, { max: SCOPE_MAX_TOPICS }),
            formats: p.arrayOf(p.string, { max: SCOPE_MAX_TOPICS }),
        }),
        { maxKeys: SCOPE_MAX_SERIES },
    ),
});

/**
 * Normalize a scope so two spellings of the same request compare equal: arrays
 * deduplicated and sorted, and per-series entries kept only for series actually
 * selected (the trainer's own rule — a scope for an unselected series is
 * ignored, so carrying it would make an identical scope look different).
 */
export function normalizeScope(scope: OfflineScope): OfflineScope {
    const dedupe = (values: string[]) => [...new Set(values)].sort();
    const seriesIds = dedupe(scope.seriesIds);
    const seriesScopes: OfflineScope["seriesScopes"] = {};
    for (const id of seriesIds) {
        const entry = scope.seriesScopes[id];
        if (!entry) continue;
        const divisions = dedupe(entry.divisions);
        const formats = dedupe(entry.formats);
        if (divisions.length || formats.length) {
            seriesScopes[id] = { divisions, formats };
        }
    }
    return { topic: dedupe(scope.topic), seriesIds, seriesScopes };
}

export const parseProblemProgress: p.Parser<ProblemProgress> =
    p.objectOf<ProblemProgress>({
        times_seen: p.nonNegativeInteger,
        times_correct: p.nonNegativeInteger,
        times_reviewed: p.nonNegativeInteger,
        times_skipped: p.nonNegativeInteger,
        last_correct: p.nullable(p.boolean),
        last_reviewed_at: p.nullable(p.isoInstant),
        last_submission_at: p.nullable(p.isoInstant),
        next_review_at: p.nullable(p.isoInstant),
        solved: p.boolean,
        mastery: p.nullable(parseMastery),
        engagement: p.nullable(parseEngagement),
    });

export const parsePlayerRating: p.Parser<PlayerRating> = p.objectOf<PlayerRating>({
    rating: p.finiteNumber,
    rd: p.finiteNumber,
    matches: p.nonNegativeInteger,
    last_match_at: p.nullable(p.isoInstant),
});

/**
 * A `practice_sessions` row. The settings column is `jsonb`; it is carried
 * verbatim rather than re-validated as `PracticeSettings`, because the trainer
 * already tolerates older snapshots field by field and a stricter parse here
 * would refuse to open a session the online app opens fine.
 */
export const parsePracticeSessionRow: p.Parser<PracticeSessionRow> = ((
    value: unknown,
    path = "",
) => {
    const row = p.objectOf<Omit<PracticeSessionRow, "settings">>({
        created_at: p.isoInstant,
        current_elapsed_ms: p.nonNegativeInteger,
        current_problem_id: p.nullable(p.integer),
        ended_at: p.nullable(p.isoInstant),
        id: p.integer,
        is_root: p.boolean,
        last_submission_at: p.nullable(p.isoInstant),
        name: p.nullable(p.string),
        started_at: p.isoInstant,
        status: p.string,
        times_correct: p.nonNegativeInteger,
        times_reviewed: p.nonNegativeInteger,
        times_seen: p.nonNegativeInteger,
        times_skipped: p.nonNegativeInteger,
        total_time_ms: p.nonNegativeInteger,
        updated_at: p.isoInstant,
        user_id: p.uuid,
    })(value, path);
    const settings = (value as Record<string, unknown>).settings ?? null;
    return { ...row, settings } as PracticeSessionRow;
}) as p.Parser<PracticeSessionRow>;

// --- Package creation --------------------------------------------------------

export const parsePracticeSettings = ((value: unknown, path = "") => {
    const settings = p.objectOf<{ mode: string; format: string }>({
        mode: p.string,
        format: p.string,
    })(value, path);
    if (settings.mode !== "new" || settings.format !== "practice") {
        throw new p.OfflineParseError(
            path,
            'offline sessions require settings.mode="new" and settings.format="practice"',
        );
    }
    return value as OfflinePackageCreateRequestV1["session"]["settings"];
}) as p.Parser<OfflinePackageCreateRequestV1["session"]["settings"]>;

const parseProblemLimit: p.Parser<number> = (value, path = "") => {
    const limit = p.integer(value, path);
    if (limit < 1 || limit > PACKAGE_MAX_CANONICALS) {
        throw new p.OfflineParseError(
            path,
            `expected an integer from 1 to ${PACKAGE_MAX_CANONICALS}`,
        );
    }
    return limit;
};

export const parsePackageCreateRequest: p.Parser<OfflinePackageCreateRequestV1> =
    p.objectOf<OfflinePackageCreateRequestV1>({
        version: p.literal(1),
        packageId: p.uuid,
        requestId: p.uuid,
        deviceId: p.uuid,
        scope: parseScope,
        problemLimit: parseProblemLimit,
        session: p.objectOf({
            sessionId: p.nullable(p.integer),
            name: p.nullable(p.string),
            settings: parsePracticeSettings,
        }),
    });

export const parsePackageCreated: p.Parser<OfflinePackageCreatedV1> =
    p.objectOf<OfflinePackageCreatedV1>({
        version: p.literal(1),
        packageId: p.uuid,
        requestId: p.uuid,
        checkoutId: p.uuid,
        sessionId: p.integer,
        normalizedScope: parseScope,
        contentRevision: p.nonEmptyString,
        packageRevision: p.nonEmptyString,
        personalStateAt: p.isoInstant,
        downloadedAt: p.isoInstant,
        problemCount: p.nonNegativeInteger,
        placementCount: p.nonNegativeInteger,
        assetCount: p.nonNegativeInteger,
        estimatedBytes: p.objectOf<OfflinePackageCreatedV1["estimatedBytes"]>({
            json: p.nonNegativeInteger,
            media: p.nullable(p.nonNegativeInteger),
            total: p.nullable(p.nonNegativeInteger),
        }),
        pageSize: p.nonNegativeInteger,
        firstCursor: p.nullable(p.nonEmptyString),
        baseState: p.objectOf({
            playerRating: p.nullable(parsePlayerRating),
            session: parsePracticeSessionRow,
        }),
    });

// --- Package records ---------------------------------------------------------

const parseMembership: p.Parser<OfflinePackageMembershipV1> =
    p.objectOf<OfflinePackageMembershipV1>({
        packageId: p.uuid,
        packageRevision: p.nonEmptyString,
        canonicalId: p.integer,
    });

export const parseOfflineProblem: p.Parser<OfflineProblemV1> =
    p.objectOf<OfflineProblemV1>({
        canonicalId: p.integer,
        contentRevision: p.nonEmptyString,
        statement: p.nullable(p.string),
        topic: p.nullable(p.string),
        choices: p.nullable(p.arrayOf(p.string)),
        answerIndex: p.nullable(p.integer),
        answerStatus: p.nullable(
            p.enumOf(["known", "source_missing", "not_applicable", "needs_review"]),
        ),
        officialSolutions: p.nullable(p.arrayOf(p.string)),
        verified: p.boolean,
        isComputational: p.boolean,
        responseKind: p.nullable(
            p.enumOf([
                "mcq",
                "short_answer",
                "proof",
                "construction",
                "estimation",
                "interactive",
                "unknown",
            ]),
        ),
        aopsId: p.nullable(p.integer),
        tags: p.nullable(p.arrayOf(p.string)),
        difficulty: p.nullable(p.finiteNumber),
        quality: p.nullable(p.finiteNumber),
        notes: p.nullable(p.string),
        builtAt: p.isoInstant,
        assetKeys: p.arrayOf(p.nonEmptyString, { max: PAGE_MAX_ASSETS }),
    });

const parseAsset: p.Parser<OfflineAssetV1> = p.objectOf<OfflineAssetV1>({
    key: p.nonEmptyString,
    url: p.nonEmptyString,
    kind: p.literal("problem-image"),
    required: p.literal(true),
});

export const parsePlacement: p.Parser<OfflinePlacementV1> =
    p.objectOf<OfflinePlacementV1>({
        packageRevision: p.nonEmptyString,
        placementId: p.integer,
        canonicalId: p.integer,
        testId: p.nullable(p.integer),
        problemNumber: p.integer,
        topic: p.nullable(p.string),
        test: p.nullable(
            p.objectOf<NonNullable<OfflinePlacementV1["test"]>>({
                name: p.string,
                seriesId: p.nullable(p.integer),
                division: p.nullable(p.string),
                format: p.nullable(p.string),
                year: p.nullable(p.integer),
                aopsCategoryId: p.nullable(p.string),
            }),
        ),
        series: p.nullable(
            p.objectOf<NonNullable<OfflinePlacementV1["series"]>>({
                id: p.integer,
                name: p.string,
            }),
        ),
    });

export const parseProblemRating: p.Parser<OfflineProblemRatingV1> =
    p.objectOf<OfflineProblemRatingV1>({
        canonicalId: p.integer,
        rating: p.finiteNumber,
        rd: p.finiteNumber,
        attempts: p.nonNegativeInteger,
    });

export const parsePersonalState: p.Parser<OfflinePersonalStateV1> =
    p.objectOf<OfflinePersonalStateV1>({
        userId: p.uuid,
        canonicalId: p.integer,
        progress: p.nullable(parseProblemProgress),
    });

/**
 * The page payload the checksum covers.
 *
 * Exported because the *server* must checksum this parsed form, not the records
 * as its own materializer emitted them. `objectOf` drops unknown keys so that an
 * additive server field cannot take a download down — but a checksum taken over
 * the raw records would reintroduce exactly that failure, since the client can
 * only ever hash what it parsed. Hashing the contract on both sides is what
 * makes the additive guarantee real.
 */
export const parseRecords: p.Parser<OfflinePackageRecordsV1> =
    p.objectOf<OfflinePackageRecordsV1>({
        memberships: p.arrayOf(parseMembership, { max: PAGE_MAX_PROBLEMS }),
        problems: p.arrayOf(parseOfflineProblem, { max: PAGE_MAX_PROBLEMS }),
        placements: p.arrayOf(parsePlacement, { max: PAGE_MAX_PLACEMENTS }),
        assets: p.arrayOf(parseAsset, { max: PAGE_MAX_ASSETS }),
        personalStates: p.arrayOf(parsePersonalState, { max: PAGE_MAX_PROBLEMS }),
        ratings: p.arrayOf(parseProblemRating, { max: PAGE_MAX_PROBLEMS }),
    });

export const parsePackagePage: p.Parser<OfflinePackagePageV1> =
    p.objectOf<OfflinePackagePageV1>({
        version: p.literal(1),
        packageId: p.uuid,
        checkoutId: p.uuid,
        packageRevision: p.nonEmptyString,
        pageIndex: p.nonNegativeInteger,
        nextCursor: p.nullable(p.nonEmptyString),
        counts: p.objectOf<OfflinePackagePageV1["counts"]>({
            memberships: p.nonNegativeInteger,
            problems: p.nonNegativeInteger,
            placements: p.nonNegativeInteger,
            assets: p.nonNegativeInteger,
            personalStates: p.nonNegativeInteger,
            ratings: p.nonNegativeInteger,
        }),
        checksum: p.nonEmptyString,
        records: parseRecords,
    });

/**
 * A page whose declared counts disagree with the records it carries is rejected
 * before anything is written. The counts are what `commitPackage` accumulates
 * against the totals promised at creation, so a page that lies about itself
 * would produce a package that verifies as complete while missing rows.
 */
export function countsAgree(page: OfflinePackagePageV1): boolean {
    const { counts, records } = page;
    return (
        counts.memberships === records.memberships.length &&
        counts.problems === records.problems.length &&
        counts.placements === records.placements.length &&
        counts.assets === records.assets.length &&
        counts.personalStates === records.personalStates.length &&
        counts.ratings === records.ratings.length
    );
}

// --- Queries -----------------------------------------------------------------

export const parsePracticeQuery: p.Parser<PracticeQueryV1> =
    p.objectOf<PracticeQueryV1>({
        version: p.literal(1),
        intent: p.literal("practice-new"),
        userId: p.uuid,
        packageIds: p.arrayOf(p.uuid),
        sessionId: p.nullable(p.integer),
        mode: p.literal("new"),
        filters: p.objectOf<PracticeQueryV1["filters"]>({
            topic: p.arrayOf(p.string, { max: SCOPE_MAX_TOPICS }),
            seriesIds: p.arrayOf(p.string, { max: SCOPE_MAX_SERIES }),
            seriesScopes: p.recordOf(
                p.objectOf<{ divisions: string[]; formats: string[] }>({
                    divisions: p.arrayOf(p.string, { max: SCOPE_MAX_TOPICS }),
                    formats: p.arrayOf(p.string, { max: SCOPE_MAX_TOPICS }),
                }),
                { maxKeys: SCOPE_MAX_SERIES },
            ),
            ratingBand: p.nullable(p.tupleOf(p.finiteNumber, p.finiteNumber)),
            verifiedOnly: p.boolean,
            computational: p.nullable(p.boolean),
            answerAvailability: p.enumOf(["with", "without", "any"]),
            solutionAvailability: p.enumOf(["with", "without", "any"]),
            mastery: p.arrayOf(
                p.enumOf([...MASTERY_VALUES, "unassessed"]) as p.Parser<
                    Mastery | "unassessed"
                >,
            ),
        }),
        excludeCanonicalIds: p.arrayOf(p.integer),
        order: p.objectOf<PracticeQueryV1["order"]>({
            kind: p.enumOf(["seeded-random", "nearest-rating"]),
            seed: p.nonEmptyString,
            ratingCenter: p.nullable(p.finiteNumber),
        }),
        limit: p.nonNegativeInteger,
    });

// --- Outbox operations -------------------------------------------------------

const operationBase = {
    version: p.literal(1) as p.Parser<1>,
    id: p.uuid,
    userId: p.uuid,
    checkoutId: p.uuid,
    packageId: p.uuid,
    sessionId: p.integer,
    clientSessionId: p.optional(p.uuid),
    sequence: p.nonNegativeInteger,
    runtimeId: p.uuid,
    monotonicOffsetMs: p.finiteNumber,
    occurredAt: p.isoInstant,
    dependsOn: p.arrayOf(p.uuid, { max: SYNC_MAX_DEPENDENCIES }),
    state: p.enumOf(["pending", "syncing", "failed"]),
};

export const parseOperation: p.Parser<OfflineOperationV1> = p.unionOn<
    "type",
    OfflineOperationV1
>("type", {
    submission: p.objectOf({
        ...operationBase,
        type: p.literal("submission"),
        payload: p.objectOf({
            clientKey: p.uuid,
            canonicalId: p.integer,
            selectedChoice: p.nullable(p.integer),
            answer: p.nullable(p.string),
            isCorrect: p.nullable(p.boolean),
            skipped: p.boolean,
            flagged: p.boolean,
            elapsedMs: p.nonNegativeInteger,
            source: p.literal("practice"),
            triesUsed: p.nonNegativeInteger,
        }),
    }),
    mastery: p.objectOf({
        ...operationBase,
        type: p.literal("mastery"),
        payload: p.objectOf({
            canonicalId: p.integer,
            mastery: p.nullable(parseMastery),
        }),
    }),
    engagement: p.objectOf({
        ...operationBase,
        type: p.literal("engagement"),
        payload: p.objectOf({
            canonicalId: p.integer,
            engagement: p.nullable(parseEngagement),
        }),
    }),
    "session-finish": p.objectOf({
        ...operationBase,
        type: p.literal("session-finish"),
        payload: p.objectOf({ endedAt: p.isoInstant }),
    }),
});

// --- Sync --------------------------------------------------------------------

export const parseSyncRequest: p.Parser<OfflineSyncRequestV1> =
    p.objectOf<OfflineSyncRequestV1>({
        version: p.literal(1),
        deviceId: p.uuid,
        checkoutId: p.uuid,
        packageId: p.uuid,
        packageRevision: p.nonEmptyString,
        clientSession: p.optional(
            p.objectOf<NonNullable<OfflineSyncRequestV1["clientSession"]>>({
                clientSessionId: p.uuid,
                name: p.nullable(p.string),
                settings: parsePracticeSettings,
                startedAt: p.isoInstant,
            }),
        ),
        operations: p.arrayOf(parseOperation, { max: SYNC_MAX_OPERATIONS }),
    });

export const parseSyncResponse: p.Parser<OfflineSyncResponseV1> =
    p.objectOf<OfflineSyncResponseV1>({
        version: p.literal(1),
        status: p.literal("applied"),
        checkoutId: p.uuid,
        clientSessionId: p.optional(p.uuid),
        acknowledgedOperationIds: p.arrayOf(p.uuid),
        submissions: p.arrayOf(
            p.objectOf<OfflineSyncResponseV1["submissions"][number]>({
                clientKey: p.uuid,
                submissionId: p.integer,
                createdAt: p.isoInstant,
                occurredAt: p.isoInstant,
            }),
        ),
        overlaps: p.arrayOf(
            p.objectOf<OfflineSyncResponseV1["overlaps"][number]>({
                canonicalId: p.integer,
                kind: p.enumOf([
                    "activity_since_download",
                    "mastery_replaced",
                    "engagement_replaced",
                ]),
            }),
        ),
        authoritative: p.objectOf<OfflineSyncResponseV1["authoritative"]>({
            session: parsePracticeSessionRow,
            playerRating: p.nullable(parsePlayerRating),
            personalStates: p.arrayOf(parsePersonalState),
            problemRatings: p.arrayOf(parseProblemRating),
        }),
        syncedAt: p.isoInstant,
    });

export const parseSyncError: p.Parser<OfflineSyncErrorV1> =
    p.objectOf<OfflineSyncErrorV1>({
        version: p.literal(1),
        status: p.literal("error"),
        code: p.enumOf([
            "auth_required",
            "owner_mismatch",
            "checkout_invalid",
            "package_revision_invalid",
            "batch_too_large",
            "operation_invalid",
            "conflict",
            "temporary",
        ]),
        retryable: p.boolean,
        operationId: p.optional(p.uuid),
        message: p.string,
    });

/** Either arm of the sync wire, discriminated on `status`. */
export function parseSyncResult(
    value: unknown,
    path = "",
): OfflineSyncResponseV1 | OfflineSyncErrorV1 {
    const status = (value as { status?: unknown })?.status;
    return status === "error"
        ? parseSyncError(value, path)
        : parseSyncResponse(value, path);
}
