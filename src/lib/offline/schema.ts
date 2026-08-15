/**
 * The versioned offline database schema (`docs/offline-contracts.md` §3).
 *
 * Every record is keyed by `userId`. That is not a convenience — the active
 * offline user is a separate pointer in `meta`, never an inference from
 * whichever record happens to exist, and opening user A's data after user B
 * signs in is forbidden. Keying every store by the owner is what makes that
 * enforceable rather than aspirational.
 *
 * Upgrades are additive and transactional. An incompatible *package* may be
 * marked `incompatible` and re-downloaded; an upgrade must always preserve and
 * parse versioned outbox records, and startup must never answer a migration
 * error by deleting the database — that is unsynced user work.
 */

import type {
    OfflineOperationV1,
    OfflinePackageBaseStateV1,
    OfflineScope,
    PackageState,
    UUID,
} from "./types";
import type { Engagement, Mastery, ProblemProgress } from "$lib/progress";
import type { PracticeSessionRow } from "$lib/sessions";
import type { PlayerRating } from "$lib/library";

export const OFFLINE_DB_NAME = "problem-cloud-offline";
/**
 * V3 adds browser-owned practice-session identity while preserving every older
 * package, session snapshot, and outbox record. `upgradeSchema` walks the
 * full declared schema, so it creates only missing stores/indexes and preserves
 * every existing package and outbox record.
 */
export const OFFLINE_SCHEMA_VERSION = 3;

export type IndexSchema = {
    name: string;
    keyPath: string[];
    unique?: boolean;
};

export type StoreSchema = {
    name: string;
    keyPath: string[];
    indexes: IndexSchema[];
    /** The schema version this store first appeared in. */
    since: number;
};

/**
 * `assets`, `stagedPersonalState` and `stagedRatings` are additions to the
 * eleven stores the contract lists, and they exist for one rule: *staged data is
 * never visible to ordinary queries*. Membership, placements and content are
 * already invisible while staging because they are keyed by package revision —
 * but ratings and personal state are shared per `(user, canonical)` on purpose
 * (one sync must update every overlapping package at once), so a refresh writing
 * them directly would publish a revision that has not committed. They are staged
 * revision-scoped and moved into the shared stores by `commitPackage`. `assets`
 * is revision-scoped for the same reason and doubles as the record of what the
 * active revision's media cache must contain.
 */
export const STORE = {
    packages: "packages",
    packageMembership: "packageMembership",
    problems: "problems",
    placements: "placements",
    assets: "assets",
    ratings: "ratings",
    personalState: "personalState",
    stagedRatings: "stagedRatings",
    stagedPersonalState: "stagedPersonalState",
    sessions: "sessions",
    localSubmissions: "localSubmissions",
    organizationOverrides: "organizationOverrides",
    outbox: "outbox",
    meta: "meta",
} as const;

export type StoreName = (typeof STORE)[keyof typeof STORE];

export const OFFLINE_STORES: StoreSchema[] = [
    {
        name: STORE.packages,
        keyPath: ["userId", "packageId"],
        since: 1,
        indexes: [
            { name: "byUser", keyPath: ["userId"] },
            { name: "byUserState", keyPath: ["userId", "state"] },
            { name: "byUserActiveRevision", keyPath: ["userId", "activeRevision"] },
        ],
    },
    {
        name: STORE.packageMembership,
        keyPath: ["userId", "packageRevision", "canonicalId"],
        since: 1,
        indexes: [
            { name: "byRevision", keyPath: ["userId", "packageRevision"] },
            { name: "byCanonical", keyPath: ["userId", "canonicalId"] },
        ],
    },
    {
        // Content is immutable per revision and shared across every package that
        // references it, so overlapping downloads never copy a problem twice.
        name: STORE.problems,
        keyPath: ["userId", "contentRevision", "canonicalId"],
        since: 1,
        indexes: [
            { name: "byCanonical", keyPath: ["userId", "canonicalId"] },
            { name: "byUserContent", keyPath: ["userId", "contentRevision"] },
            { name: "byContentTopic", keyPath: ["userId", "contentRevision", "topic"] },
        ],
    },
    {
        name: STORE.placements,
        keyPath: ["userId", "packageRevision", "placementId"],
        since: 1,
        indexes: [
            { name: "byRevision", keyPath: ["userId", "packageRevision"] },
            {
                name: "byRevisionCanonical",
                keyPath: ["userId", "packageRevision", "canonicalId"],
            },
            { name: "byRevisionTest", keyPath: ["userId", "packageRevision", "testId"] },
            {
                name: "byRevisionSeries",
                keyPath: ["userId", "packageRevision", "seriesId"],
            },
        ],
    },
    {
        name: STORE.assets,
        keyPath: ["userId", "packageRevision", "key"],
        since: 1,
        indexes: [{ name: "byRevision", keyPath: ["userId", "packageRevision"] }],
    },
    {
        // Personal base state is shared per user/canonical, not copied per
        // package, so one sync updates effective progress in every overlapping
        // package at once.
        name: STORE.ratings,
        keyPath: ["userId", "canonicalId"],
        since: 1,
        indexes: [
            { name: "byUser", keyPath: ["userId"] },
            { name: "byUserRating", keyPath: ["userId", "rating"] },
        ],
    },
    {
        name: STORE.personalState,
        keyPath: ["userId", "canonicalId"],
        since: 1,
        indexes: [
            { name: "byUser", keyPath: ["userId"] },
            { name: "byUserMastery", keyPath: ["userId", "mastery"] },
            { name: "byUserEngagement", keyPath: ["userId", "engagement"] },
            { name: "byUserTimesSeen", keyPath: ["userId", "timesSeen"] },
        ],
    },
    {
        name: STORE.stagedRatings,
        keyPath: ["userId", "packageRevision", "canonicalId"],
        since: 1,
        indexes: [{ name: "byRevision", keyPath: ["userId", "packageRevision"] }],
    },
    {
        name: STORE.stagedPersonalState,
        keyPath: ["userId", "packageRevision", "canonicalId"],
        since: 1,
        indexes: [{ name: "byRevision", keyPath: ["userId", "packageRevision"] }],
    },
    {
        name: STORE.sessions,
        keyPath: ["userId", "sessionId"],
        since: 1,
        indexes: [
            { name: "byUser", keyPath: ["userId"] },
            { name: "byUserStatus", keyPath: ["userId", "status"] },
            { name: "byClientSession", keyPath: ["userId", "clientSessionId"], unique: true },
        ],
    },
    {
        name: STORE.localSubmissions,
        keyPath: ["userId", "clientKey"],
        since: 1,
        indexes: [
            { name: "byUser", keyPath: ["userId"] },
            { name: "byUserSession", keyPath: ["userId", "sessionId"] },
            { name: "byUserCanonical", keyPath: ["userId", "canonicalId"] },
        ],
    },
    {
        name: STORE.organizationOverrides,
        keyPath: ["userId", "canonicalId", "axis"],
        since: 1,
        indexes: [
            { name: "byUser", keyPath: ["userId"] },
            { name: "byUserSequence", keyPath: ["userId", "sequence"] },
        ],
    },
    {
        // Never evicted for age or cache pressure: this is unsynced user work.
        name: STORE.outbox,
        keyPath: ["userId", "sequence"],
        since: 1,
        indexes: [
            { name: "byUser", keyPath: ["userId"] },
            { name: "byUserState", keyPath: ["userId", "state"] },
            { name: "byOperationId", keyPath: ["id"], unique: true },
        ],
    },
    { name: STORE.meta, keyPath: ["key"], since: 1, indexes: [] },
];

export const ALL_STORES: string[] = OFFLINE_STORES.map((store) => store.name);

// --- Durable record shapes ---------------------------------------------------

/** One materialized revision of a package. Immutable once committed. */
export type PackageRevisionRecord = {
    checkoutId: UUID;
    requestId: UUID;
    packageRevision: string;
    contentRevision: string;
    scope: OfflineScope;
    sessionId: number | null;
    personalStateAt: string;
    downloadedAt: string;
    problemCount: number;
    placementCount: number;
    assetCount: number;
    byteCount: number;
};

/** Progress of a download that is not visible to queries yet. */
export type StagingRecord = PackageRevisionRecord & {
    /** Frozen session/rating snapshot, invisible until this revision commits. */
    baseState: OfflinePackageBaseStateV1;
    nextPageIndex: number;
    /** Checksums already staged, so a retried page is recognized as a retry. */
    pages: { pageIndex: number; checksum: string }[];
    /** Whether the final page (`nextCursor: null`) has been seen. */
    complete: boolean;
    staged: {
        memberships: number;
        problems: number;
        placements: number;
        assets: number;
        personalStates: number;
        ratings: number;
    };
    /** Cumulative decoded bytes, against the 250 MiB package ceiling. */
    bytes: number;
};

export type PackageRecord = {
    userId: UUID;
    packageId: UUID;
    /** `ready` once a revision is active; `staging` until the first commit. */
    state: Exclude<PackageState, "stale">;
    /** The revision queries read. Null while the first download is staging. */
    activeRevision: string | null;
    active: PackageRevisionRecord | null;
    staging: StagingRecord | null;
    schemaVersion: number;
    lastSyncedAt: string | null;
};

export type MembershipRecord = {
    userId: UUID;
    packageId: UUID;
    packageRevision: string;
    canonicalId: number;
};

export type ProblemRecord = {
    userId: UUID;
    contentRevision: string;
    canonicalId: number;
    topic: string;
    /** The validated `OfflineProblemV1`, stored whole. */
    problem: import("./types").OfflineProblemV1;
};

export type PlacementRecord = {
    userId: UUID;
    packageRevision: string;
    placementId: number;
    canonicalId: number;
    /** Denormalized for the indexes; `-1` stands in for a null test/series,
     *  because IndexedDB refuses to index a null key component. */
    testId: number;
    seriesId: number;
    placement: import("./types").OfflinePlacementV1;
};

export type AssetRecord = {
    userId: UUID;
    packageRevision: string;
    key: string;
    url: string;
};

export type RatingRecord = {
    userId: UUID;
    canonicalId: number;
    rating: number;
    rd: number;
    attempts: number;
};

/** A rating awaiting `commitPackage`; keyed by the revision that staged it. */
export type StagedRatingRecord = RatingRecord & { packageRevision: string };

export type PersonalStateRecord = {
    userId: UUID;
    canonicalId: number;
    /** Frozen server truth. The overlay is derived, never written back here. */
    progress: ProblemProgress | null;
    /** Denormalized index columns, mirroring `progress`. */
    mastery: Mastery | null;
    engagement: Engagement | null;
    timesSeen: number;
    /** Set once a local graded submission invalidates the SM-2 schedule. */
    scheduleStale: boolean;
};

/** Personal base state awaiting `commitPackage`. */
export type StagedPersonalStateRecord = PersonalStateRecord & {
    packageRevision: string;
};

export type SessionRecord = {
    userId: UUID;
    sessionId: number;
    packageId: UUID | null;
    clientSessionId?: UUID;
    serverSessionId?: number | null;
    status: string;
    row: PracticeSessionRow;
    playerRating: PlayerRating | null;
};

export type OrganizationOverrideRecord = {
    userId: UUID;
    canonicalId: number;
    axis: "mastery" | "engagement";
    value: Mastery | Engagement | null;
    sequence: number;
    operationId: UUID;
};

export type OutboxRecord = OfflineOperationV1;

export type MetaRecord = { key: string; value: unknown };

/** Meta keys. The active user pointer is the important one — see the header. */
export const META = {
    activeUser: "activeUser",
    schemaVersion: "schemaVersion",
    /** Per-user monotonic outbox sequence allocator. */
    sequence: (userId: UUID) => `sequence:${userId}`,
    /** Per-user decreasing local session id allocator (-1, -2, ...). */
    localSessionSequence: (userId: UUID) => `localSessionSequence:${userId}`,
    /** Frozen player rating from the latest committed package snapshot. */
    playerRating: (userId: UUID) => `playerRating:${userId}`,
    /** This runtime's id, for durable ordering within a browser session. */
    runtime: "runtime",
    deviceId: "deviceId",
    /** Immutable local provenance retained while a checkout can own outbox work. */
    checkout: (checkoutId: UUID) => `checkout:${checkoutId}`,
} as const;
