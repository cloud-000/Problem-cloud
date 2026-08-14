/**
 * The V1 offline wire and repository contracts, transcribed from
 * [`docs/offline-contracts.md`](../../../docs/offline-contracts.md).
 *
 * These are **types only**. A TypeScript assertion is not validation, and every
 * shape here crosses a trust boundary at least once (network payload, durable
 * browser storage that survives a schema change, a message from another tab), so
 * nothing in the app may cast into these types — go through the parsers in
 * `parse.ts` instead.
 *
 * If a code change needs a different wire shape, query meaning, persistence
 * rule, or sync result, update the contract document before or with it.
 */

import type { Engagement, Mastery, ProblemProgress } from "$lib/progress";
import type { PlayerRating } from "$lib/library";
import type { PracticeSessionRow } from "$lib/sessions";
import type { PracticeSettings } from "$lib/trainer";

export type UUID = string;
export type ISOInstant = string;
export type Cursor = string;

/**
 * A download scope, in the same shape and with the same semantics as a goal's.
 * Membership must resolve through `public.goal_scope_canonicals`, which is
 * placement-aware; filtering canonical rows by their own test metadata is not
 * equivalent.
 *
 * `yearRange` is deliberately absent: the SQL resolver accepts it, but the
 * shared goal/practice editor does not author it yet (`docs/offline.md` §5a).
 */
export type OfflineScope = {
    topic: string[];
    seriesIds: string[];
    seriesScopes: Record<string, { divisions: string[]; formats: string[] }>;
};

export type PackageState = "staging" | "ready" | "stale" | "incompatible";

// --- Package creation and download -------------------------------------------

export type OfflinePackageCreateRequestV1 = {
    version: 1;
    /** Stable logical package, edited/refreshed over time. Browser-owned. */
    packageId: UUID;
    /** Fresh per materialization attempt; idempotency key for retries. */
    requestId: UUID;
    deviceId: UUID;
    scope: OfflineScope;
    /** Explicit maximum membership selected from the matching scope. */
    problemLimit: number;
    session: {
        /** Null initially; the owned dedicated session id on refresh. */
        sessionId: number | null;
        name: string | null;
        settings: PracticeSettings;
    };
};

export type OfflinePackageBaseStateV1 = {
    playerRating: PlayerRating | null;
    session: PracticeSessionRow;
};

export type OfflinePackageCreatedV1 = {
    version: 1;
    packageId: UUID;
    requestId: UUID;
    checkoutId: UUID;
    sessionId: number;
    normalizedScope: OfflineScope;
    contentRevision: string;
    packageRevision: string;
    personalStateAt: ISOInstant;
    downloadedAt: ISOInstant;
    problemCount: number;
    placementCount: number;
    assetCount: number;
    estimatedBytes: {
        json: number;
        media: number | null;
        total: number | null;
    };
    pageSize: number;
    firstCursor: Cursor | null;
    /** Frozen server state captured in the materialization transaction. */
    baseState: OfflinePackageBaseStateV1;
};

export type OfflinePackageMembershipV1 = {
    packageId: UUID;
    packageRevision: string;
    canonicalId: number;
};

export type OfflineAnswerStatus =
    | "known"
    | "source_missing"
    | "not_applicable"
    | "needs_review";

export type OfflineResponseKind =
    | "mcq"
    | "short_answer"
    | "proof"
    | "construction"
    | "estimation"
    | "interactive"
    | "unknown";

/**
 * The complete v1 durable problem projection. `test_id`/`n` belong to
 * {@link OfflinePlacementV1}; `canonical_id`, `sync_key` and the row's own `id`
 * are represented by `canonicalId`; generated embeds normalize into ratings and
 * personal state.
 *
 * `choices` stays as overloaded here as it is in the database (a 1-element array
 * *is* the free-response answer key) — every reader must gate on
 * `isMultipleChoice()`.
 */
export type OfflineProblemV1 = {
    canonicalId: number;
    contentRevision: string;
    statement: string | null;
    topic: string | null;
    choices: string[] | null;
    answerIndex: number | null;
    answerStatus: OfflineAnswerStatus | null;
    officialSolutions: string[] | null;
    verified: boolean;
    isComputational: boolean;
    responseKind: OfflineResponseKind | null;
    aopsId: number | null;
    tags: string[] | null;
    difficulty: number | null;
    quality: number | null;
    notes: string | null;
    builtAt: ISOInstant;
    /** Every image the statement, choices, or solutions reference. */
    assetKeys: string[];
};

export type OfflineAssetV1 = {
    /** Base64url SHA-256 of the normalized absolute URL. */
    key: string;
    url: string;
    kind: "problem-image";
    required: true;
};

export type OfflinePlacementV1 = {
    packageRevision: string;
    placementId: number;
    canonicalId: number;
    testId: number | null;
    problemNumber: number;
    topic: string | null;
    test: {
        name: string;
        seriesId: number | null;
        division: string | null;
        format: string | null;
        year: number | null;
        aopsCategoryId: string | null;
    } | null;
    series: { id: number; name: string } | null;
};

export type OfflineProblemRatingV1 = {
    canonicalId: number;
    rating: number;
    rd: number;
    attempts: number;
};

export type OfflinePersonalStateV1 = {
    userId: UUID;
    canonicalId: number;
    progress: ProblemProgress | null;
};

export type OfflinePackageRecordsV1 = {
    memberships: OfflinePackageMembershipV1[];
    problems: OfflineProblemV1[];
    placements: OfflinePlacementV1[];
    assets: OfflineAssetV1[];
    personalStates: OfflinePersonalStateV1[];
    ratings: OfflineProblemRatingV1[];
};

export type OfflinePackagePageV1 = {
    version: 1;
    packageId: UUID;
    checkoutId: UUID;
    packageRevision: string;
    pageIndex: number;
    nextCursor: Cursor | null;
    counts: {
        memberships: number;
        problems: number;
        placements: number;
        assets: number;
        personalStates: number;
        ratings: number;
    };
    /** base64url SHA-256 over the RFC 8785 canonicalization; see `checksum.ts`. */
    checksum: string;
    records: OfflinePackageRecordsV1;
};

/** What `listPackages` shows the user; a superset of the manifest fields. */
export type OfflinePackageManifestV1 = {
    packageId: UUID;
    userId: UUID;
    scope: OfflineScope;
    contentRevision: string;
    packageRevision: string;
    requestId: UUID;
    checkoutId: UUID;
    sessionId: number;
    personalStateAt: ISOInstant;
    downloadedAt: ISOInstant;
    /** Schema version the records were written under; see `schema.ts`. */
    schemaVersion: number;
    problemCount: number;
    placementCount: number;
    assetCount: number;
    byteCount: number;
    state: PackageState;
    lastSyncedAt: ISOInstant | null;
    pendingOperations: number;
};

// --- Local queries -----------------------------------------------------------

export type PracticeQueryV1 = {
    version: 1;
    userId: UUID;
    packageIds: UUID[];
    sessionId: number | null;
    mode: "new";
    filters: {
        topic: string[];
        seriesIds: string[];
        seriesScopes: Record<string, { divisions: string[]; formats: string[] }>;
        ratingBand: [number, number] | null;
        verifiedOnly: boolean;
        computational: boolean | null;
        answerAvailability: "with" | "without" | "any";
        solutionAvailability: "with" | "without" | "any";
        mastery: (Mastery | "unassessed")[];
    };
    excludeCanonicalIds: number[];
    order: {
        kind: "seeded-random" | "nearest-rating";
        seed: string;
        ratingCenter: number | null;
    };
    limit: number;
};

/**
 * A UI-ready problem assembled at query time: durable content plus the
 * *effective* (snapshot + overlay) personal state and the frozen rating. Mutable
 * personal state is never copied into durable problem content.
 */
export type OfflinePracticeProblemV1 = {
    canonicalId: number;
    problem: OfflineProblemV1;
    /** Every downloaded placement, so the display can name a test/series. */
    placements: OfflinePlacementV1[];
    rating: OfflineProblemRatingV1 | null;
    progress: ProblemProgress | null;
    /** True once a local unsynced submission has folded into `progress`. */
    progressIsProvisional: boolean;
};

export type PracticeQueryResultV1 =
    | { status: "ok"; problems: OfflinePracticeProblemV1[]; availableCount: number }
    | { status: "exhausted"; problems: []; availableCount: 0 }
    | {
          status: "not_downloaded";
          problems: [];
          missing: { topic: string[]; seriesIds: string[] };
      }
    | {
          status: "package_unavailable";
          problems: [];
          reason: "missing" | "staging" | "incompatible";
      };

// --- Outbox ------------------------------------------------------------------

export type OfflineSubmissionPayloadV1 = {
    clientKey: UUID;
    canonicalId: number;
    selectedChoice: number | null;
    answer: string | null;
    isCorrect: boolean | null;
    skipped: boolean;
    flagged: boolean;
    elapsedMs: number;
    source: "practice";
    triesUsed: number;
};

export type OfflineMasteryPayloadV1 = {
    canonicalId: number;
    mastery: Mastery | null;
};

export type OfflineEngagementPayloadV1 = {
    canonicalId: number;
    engagement: Engagement | null;
};

export type OfflineSessionFinishPayloadV1 = {
    endedAt: ISOInstant;
};

export type OfflineOperationType =
    | "submission"
    | "mastery"
    | "engagement"
    | "session-finish";

export type OfflineOperationBaseV1 = {
    version: 1;
    id: UUID;
    userId: UUID;
    checkoutId: UUID;
    packageId: UUID;
    sessionId: number;
    sequence: number;
    runtimeId: UUID;
    monotonicOffsetMs: number;
    occurredAt: ISOInstant;
    dependsOn: UUID[];
    state: "pending" | "syncing" | "failed";
};

export type OfflineOperationV1 = OfflineOperationBaseV1 &
    (
        | { type: "submission"; payload: OfflineSubmissionPayloadV1 }
        | { type: "mastery"; payload: OfflineMasteryPayloadV1 }
        | { type: "engagement"; payload: OfflineEngagementPayloadV1 }
        | { type: "session-finish"; payload: OfflineSessionFinishPayloadV1 }
    );

/** The local half of a submission: what the trainer renders back as history. */
export type LocalSubmissionV1 = {
    userId: UUID;
    clientKey: UUID;
    operationId: UUID;
    sessionId: number;
    packageId: UUID;
    canonicalId: number;
    sequence: number;
    occurredAt: ISOInstant;
    selectedChoice: number | null;
    answer: string | null;
    isCorrect: boolean | null;
    skipped: boolean;
    flagged: boolean;
    elapsedMs: number;
    triesUsed: number;
};

// --- Sync --------------------------------------------------------------------

export type OfflineSyncRequestV1 = {
    version: 1;
    deviceId: UUID;
    checkoutId: UUID;
    packageId: UUID;
    packageRevision: string;
    operations: OfflineOperationV1[];
};

export type OfflineSyncOverlapV1 = {
    canonicalId: number;
    kind: "activity_since_download" | "mastery_replaced" | "engagement_replaced";
};

export type OfflineSyncResponseV1 = {
    version: 1;
    status: "applied";
    checkoutId: UUID;
    acknowledgedOperationIds: UUID[];
    submissions: {
        clientKey: UUID;
        submissionId: number;
        createdAt: ISOInstant;
        occurredAt: ISOInstant;
    }[];
    overlaps: OfflineSyncOverlapV1[];
    authoritative: {
        session: PracticeSessionRow;
        playerRating: PlayerRating | null;
        personalStates: OfflinePersonalStateV1[];
        problemRatings: OfflineProblemRatingV1[];
    };
    syncedAt: ISOInstant;
};

export type OfflineSyncErrorCode =
    | "auth_required"
    | "owner_mismatch"
    | "checkout_invalid"
    | "package_revision_invalid"
    | "batch_too_large"
    | "operation_invalid"
    | "conflict"
    | "temporary";

export type OfflineSyncErrorV1 = {
    version: 1;
    status: "error";
    code: OfflineSyncErrorCode;
    retryable: boolean;
    operationId?: UUID;
    message: string;
};

// --- Repository inputs -------------------------------------------------------

export type OfflineSessionV1 = {
    userId: UUID;
    sessionId: number;
    packageId: UUID;
    row: PracticeSessionRow;
    /** Local, unsynced history for this sitting, oldest first. */
    localSubmissions: LocalSubmissionV1[];
};

export type OfflineCurrentProblemInputV1 = {
    userId: UUID;
    sessionId: number;
    canonicalId: number | null;
    elapsedMs: number;
};

export type OfflineSubmissionInputV1 = {
    userId: UUID;
    packageId: UUID;
    checkoutId: UUID;
    sessionId: number;
    canonicalId: number;
    selectedChoice: number | null;
    answer: string | null;
    isCorrect: boolean | null;
    skipped: boolean;
    flagged: boolean;
    elapsedMs: number;
    triesUsed: number;
};

export type OfflineMasteryInputV1 = {
    userId: UUID;
    packageId: UUID;
    checkoutId: UUID;
    sessionId: number;
    canonicalId: number;
    mastery: Mastery | null;
    /** Operation ids this override must be applied after (its submission). */
    dependsOn?: UUID[];
};

export type OfflineEngagementInputV1 = {
    userId: UUID;
    packageId: UUID;
    checkoutId: UUID;
    sessionId: number;
    canonicalId: number;
    engagement: Engagement | null;
    dependsOn?: UUID[];
};

export type OfflineFinishSessionInputV1 = {
    userId: UUID;
    packageId: UUID;
    checkoutId: UUID;
    sessionId: number;
    endedAt?: ISOInstant;
};

export type OfflineCommitPackageInputV1 = {
    packageId: UUID;
    checkoutId: UUID;
    packageRevision: string;
    expectedProblems: number;
    expectedPlacements: number;
    expectedAssets: number;
};

/**
 * Validate and atomically store one page of a paginated package download into an
 * invisible staging revision. (The old name for this was `installPage`, which
 * read as "install a Svelte page" — it never meant that.)
 */
export interface OfflinePackageInstaller {
    beginPackage(created: OfflinePackageCreatedV1): Promise<void>;
    stagePackagePage(page: OfflinePackagePageV1): Promise<void>;
    commitPackage(input: OfflineCommitPackageInputV1): Promise<void>;
    abortStagingPackage(packageId: UUID): Promise<void>;
}

export interface OfflinePracticeRepositoryV1 extends OfflinePackageInstaller {
    listPackages(userId: UUID): Promise<OfflinePackageManifestV1[]>;
    queryProblems(query: PracticeQueryV1): Promise<PracticeQueryResultV1>;
    getProblem(input: {
        userId: UUID;
        packageIds: UUID[];
        canonicalId: number;
    }): Promise<OfflinePracticeProblemV1 | null>;
    loadSession(userId: UUID, sessionId: number): Promise<OfflineSessionV1 | null>;
    setCurrentProblem(input: OfflineCurrentProblemInputV1): Promise<void>;
    recordSubmission(input: OfflineSubmissionInputV1): Promise<LocalSubmissionV1>;
    setMastery(input: OfflineMasteryInputV1): Promise<void>;
    setEngagement(input: OfflineEngagementInputV1): Promise<void>;
    finishSession(input: OfflineFinishSessionInputV1): Promise<void>;
    pendingOperations(userId: UUID, limit: number): Promise<OfflineOperationV1[]>;
    acknowledgeSync(result: OfflineSyncResponseV1): Promise<void>;
}
