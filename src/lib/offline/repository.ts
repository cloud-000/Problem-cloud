/**
 * The offline practice repository: staged package installation, local queries
 * over the snapshot-plus-overlay state, and the typed outbox.
 *
 * Three invariants run through every method here.
 *
 * **The active offline user is a pointer, not an inference.** Every record is
 * keyed by `userId`, and the user whose data may be opened is read from `meta`.
 * Opening user A's data after user B signs in is forbidden, so it is checked
 * once, centrally, rather than at each call site.
 *
 * **A download is invisible until it is complete.** Pages install into a staging
 * revision; membership, placements, assets and the staged personal/rating rows
 * are all keyed by that revision, so no query can reach them. Only
 * `commitPackage` — after every page, count, checksum and required image agrees
 * — promotes the revision and makes it the package's active one. A failed
 * refresh leaves the previous ready revision working.
 *
 * **Nothing awaits across a transaction.** Checksums, byte accounting and asset
 * downloads all happen before the transaction opens, because an IndexedDB
 * transaction commits the moment its request queue drains and awaiting a
 * `crypto.subtle` or `fetch` promise inside one silently ends it. This is not a
 * style preference; it is the difference between an atomic local write and a
 * half-applied one.
 */

import type { Engagement, Mastery, ProblemProgress } from "$lib/progress";
import type { PlayerRating } from "$lib/library";
import type { PracticeSessionRow } from "$lib/sessions";
import { canonicalByteLength, pageChecksum } from "./checksum";
import { newUUID, OfflineClock, offlineClock } from "./clock";
import { countsAgree, parsePackageCreated, parsePackagePage } from "./contracts";
import {
    PACKAGE_FRESHNESS_MS,
    PACKAGE_MAX_CANONICALS,
    PACKAGE_MAX_JSON_BYTES,
    PACKAGE_MAX_TOTAL_BYTES,
    PAGE_MAX_DECODED_BYTES,
    PAGE_MAX_PROBLEMS,
    SYNC_MAX_DEPENDENCIES,
} from "./limits";
import {
    createMemoryMediaStore,
    type OfflineMediaStore,
} from "./media";
import { rewriteProblemMedia } from "./media";
import {
    effectiveProgress,
    groupByCanonical,
    type OrganizationOverride,
} from "./overlay";
import { runBrowseQuery, runPracticeQuery, coverageOf, missingCoverage, type QueryCandidate } from "./query";
import {
    META,
    OFFLINE_SCHEMA_VERSION,
    STORE,
    type AssetRecord,
    type MembershipRecord,
    type MetaRecord,
    type OrganizationOverrideRecord,
    type PackageRecord,
    type PersonalStateRecord,
    type PlacementRecord,
    type ProblemRecord,
    type RatingRecord,
    type SessionRecord,
    type StagedPersonalStateRecord,
    type StagedRatingRecord,
    type StagingRecord,
} from "./schema";
import type { OfflineStorage, OfflineTx } from "./storage";
import type {
    LocalSubmissionV1,
    BrowseQueryResultV1,
    BrowseQueryV1,
    OfflineCommitPackageInputV1,
    OfflineCurrentProblemInputV1,
    OfflineEngagementInputV1,
    OfflineFinishSessionInputV1,
    OfflineMasteryInputV1,
    OfflineOperationV1,
    OfflinePackageBaseStateV1,
    OfflinePackageCreatedV1,
    OfflinePackageManifestV1,
    OfflinePackagePageV1,
    OfflinePersonalStateV1,
    OfflinePracticeProblemV1,
    OfflinePracticeRepositoryV1,
    OfflineSessionV1,
    OfflineSubmissionInputV1,
    OfflineSyncResponseV1,
    PracticeQueryResultV1,
    PracticeQueryV1,
    UUID,
} from "./types";

/** A package that contradicts itself. Never recoverable by retrying the page. */
export class OfflinePackageInconsistent extends Error {
    constructor(detail: string) {
        super(`The offline package is inconsistent: ${detail}`);
        this.name = "OfflinePackageInconsistent";
    }
}

/** A read or write aimed at a user who is not the active offline user. */
export class OfflineUserMismatch extends Error {
    constructor(expected: string | null, got: string) {
        super(
            expected
                ? `Offline data for ${got} is not available while ${expected} is the active user`
                : `No offline user is active, so data for ${got} cannot be opened`,
        );
        this.name = "OfflineUserMismatch";
    }
}

/** A download that exceeds a v1 product limit. Never sampled — always refused. */
export class OfflinePackageTooLarge extends Error {
    constructor(detail: string) {
        super(`This download is too large: ${detail}`);
        this.name = "OfflinePackageTooLarge";
    }
}

export type OfflineRepositoryOptions = {
    storage: OfflineStorage;
    media?: OfflineMediaStore;
    clock?: OfflineClock;
    now?: () => Date;
    newId?: () => string;
};

type Loaded = {
    packages: PackageRecord[];
    candidates: QueryCandidate[];
};

export class OfflineRepository implements OfflinePracticeRepositoryV1 {
    readonly #storage: OfflineStorage;
    readonly #media: OfflineMediaStore;
    readonly #clock: OfflineClock;
    readonly #now: () => Date;
    readonly #newId: () => string;

    constructor(options: OfflineRepositoryOptions) {
        this.#storage = options.storage;
        this.#media = options.media ?? createMemoryMediaStore();
        this.#clock = options.clock ?? offlineClock;
        this.#now = options.now ?? (() => new Date());
        this.#newId = options.newId ?? newUUID;
    }

    // --- Active user ---------------------------------------------------------

    /**
     * Point the repository at one account. `label` is a display name only —
     * never a token, a cookie, or a serialized session, none of which may be
     * stored offline. Setting it to `null` (logout) hides every download
     * immediately without deleting a single pending operation.
     */
    async setActiveUser(userId: UUID | null, label: string | null = null): Promise<void> {
        await this.#storage.transaction([STORE.meta], "readwrite", async (tx) => {
            await tx.put(STORE.meta, {
                key: META.activeUser,
                value: userId,
                label,
            } as MetaRecord & { label: string | null });
        });
    }

    /**
     * Claim this browser's offline storage for one account.
     *
     * Every read and write is gated on the active-user marker, so *something*
     * has to establish it before a download can begin. It used to be written
     * only as a side effect of the foreground sync coordinator's first pass —
     * which runs behind a connectivity check and a cross-tab lease, so a
     * download started before that pass landed failed with "no offline user is
     * active". Claiming is therefore its own explicit step, and idempotent.
     *
     * A store already owned by another account is **never** taken over: that is
     * reported so the caller can tell the user, because the resident data may
     * hold work the other account has not synced.
     */
    async claimAccount(
        userId: UUID,
        label: string | null = null,
    ): Promise<"claimed" | "current" | "owner-mismatch"> {
        return this.#storage.transaction([STORE.meta], "readwrite", async (tx) => {
            const row = await tx.get<MetaRecord & { label?: string | null }>(
                STORE.meta,
                [META.activeUser],
            );
            const active = (row?.value as UUID | null) ?? null;
            if (active && active !== userId) return "owner-mismatch";
            await tx.put(STORE.meta, {
                key: META.activeUser,
                value: userId,
                // A caller with no display name to offer must not erase one.
                label: label ?? row?.label ?? null,
            } as MetaRecord & { label: string | null });
            return active ? "current" : "claimed";
        });
    }

    async getActiveUser(): Promise<UUID | null> {
        return (await this.getAccountMarker())?.userId ?? null;
    }

    /** The local account marker: an id and a display label, and nothing else. */
    async getAccountMarker(): Promise<{ userId: UUID; label: string | null } | null> {
        return this.#storage.transaction([STORE.meta], "readonly", async (tx) => {
            const row = await tx.get<MetaRecord & { label?: string | null }>(
                STORE.meta,
                [META.activeUser],
            );
            const userId = (row?.value as UUID | null) ?? null;
            return userId ? { userId, label: row?.label ?? null } : null;
        });
    }

    async getDeviceId(): Promise<UUID> {
        return this.#storage.transaction([STORE.meta], "readwrite", async (tx) => {
            const existing = await tx.get<MetaRecord>(STORE.meta, [META.deviceId]);
            if (typeof existing?.value === "string") return existing.value;
            const value = this.#newId();
            await tx.put(STORE.meta, { key: META.deviceId, value } satisfies MetaRecord);
            return value;
        });
    }

    async #requireActiveUser(tx: OfflineTx, userId: UUID): Promise<void> {
        const row = await tx.get<MetaRecord>(STORE.meta, [META.activeUser]);
        const active = (row?.value as UUID | null) ?? null;
        if (active !== userId) throw new OfflineUserMismatch(active, userId);
    }

    async #activeUser(tx: OfflineTx): Promise<UUID> {
        const row = await tx.get<MetaRecord>(STORE.meta, [META.activeUser]);
        const active = (row?.value as UUID | null) ?? null;
        if (!active) throw new OfflineUserMismatch(null, "(none)");
        return active;
    }

    // --- Installation --------------------------------------------------------

    async beginPackage(created: OfflinePackageCreatedV1): Promise<void> {
        const parsed = parsePackageCreated(created, "created");
        if (parsed.problemCount > PACKAGE_MAX_CANONICALS) {
            throw new OfflinePackageTooLarge(
                `${parsed.problemCount} problems exceeds the ${PACKAGE_MAX_CANONICALS} limit`,
            );
        }
        if (parsed.estimatedBytes.json > PACKAGE_MAX_JSON_BYTES) {
            throw new OfflinePackageTooLarge(
                `${parsed.estimatedBytes.json} bytes of JSON exceeds the package limit`,
            );
        }

        await this.#storage.transaction(
            [STORE.meta, STORE.packages, STORE.packageMembership, STORE.placements,
             STORE.assets, STORE.stagedRatings, STORE.stagedPersonalState],
            "readwrite",
            async (tx) => {
                const userId = await this.#activeUser(tx);
                const existing = await tx.get<PackageRecord>(STORE.packages, [
                    userId,
                    parsed.packageId,
                ]);

                // Re-beginning discards a previous incomplete attempt's staging
                // rows. The active revision is untouched — that is the whole
                // reason a refresh is safe.
                if (existing?.staging) {
                    await this.#dropRevision(tx, userId, existing.staging.packageRevision);
                }

                const staging: StagingRecord = {
                    checkoutId: parsed.checkoutId,
                    requestId: parsed.requestId,
                    packageRevision: parsed.packageRevision,
                    contentRevision: parsed.contentRevision,
                    scope: parsed.normalizedScope,
                    sessionId: parsed.sessionId,
                    personalStateAt: parsed.personalStateAt,
                    downloadedAt: parsed.downloadedAt,
                    baseState: parsed.baseState,
                    problemCount: parsed.problemCount,
                    placementCount: parsed.placementCount,
                    assetCount: parsed.assetCount,
                    byteCount: 0,
                    nextPageIndex: 0,
                    pages: [],
                    complete: false,
                    staged: {
                        memberships: 0,
                        problems: 0,
                        placements: 0,
                        assets: 0,
                        personalStates: 0,
                        ratings: 0,
                    },
                    bytes: 0,
                };

                const record: PackageRecord = existing
                    ? { ...existing, staging }
                    : {
                          userId,
                          packageId: parsed.packageId,
                          state: "staging",
                          activeRevision: null,
                          active: null,
                          staging,
                          schemaVersion: OFFLINE_SCHEMA_VERSION,
                          lastSyncedAt: null,
                      };
                await tx.put(STORE.packages, record);
            },
        );
    }

    async stagePackagePage(page: OfflinePackagePageV1): Promise<void> {
        const parsed = parsePackagePage(page, "page");
        if (!countsAgree(parsed)) {
            throw new OfflinePackageInconsistent(
                `page ${parsed.pageIndex} declares counts its records do not match`,
            );
        }
        if (parsed.records.problems.length > PAGE_MAX_PROBLEMS) {
            throw new OfflinePackageTooLarge(
                `page ${parsed.pageIndex} carries ${parsed.records.problems.length} problems`,
            );
        }

        // Everything async and non-IDB happens here, before the transaction.
        const decodedBytes = canonicalByteLength(parsed.records);
        if (decodedBytes > PAGE_MAX_DECODED_BYTES) {
            throw new OfflinePackageTooLarge(
                `page ${parsed.pageIndex} is ${decodedBytes} decoded bytes`,
            );
        }
        const checksum = await pageChecksum({
            packageId: parsed.packageId,
            checkoutId: parsed.checkoutId,
            packageRevision: parsed.packageRevision,
            pageIndex: parsed.pageIndex,
            records: parsed.records,
        });
        if (checksum !== parsed.checksum) {
            throw new OfflinePackageInconsistent(
                `page ${parsed.pageIndex} failed its checksum`,
            );
        }

        // A page already staged with this checksum is a retry: its assets are
        // present and its rows are written, so nothing more is owed.
        const alreadyStaged = await this.#pageAlreadyStaged(parsed, checksum);
        if (alreadyStaged) return;

        const staged = await this.#media.stage(
            parsed.packageRevision,
            parsed.records.assets,
            parsed.checkoutId,
        );

        await this.#storage.transaction(
            // Staging writes only revision-scoped rows. The session snapshot is
            // not one of them: it is promoted at commit, so that it cannot
            // become visible before the revision it belongs to.
            [STORE.meta, STORE.packages, STORE.packageMembership, STORE.problems,
             STORE.placements, STORE.assets, STORE.stagedRatings,
             STORE.stagedPersonalState],
            "readwrite",
            async (tx) => {
                const userId = await this.#activeUser(tx);
                const record = await tx.get<PackageRecord>(STORE.packages, [
                    userId,
                    parsed.packageId,
                ]);
                const staging = record?.staging;
                if (!record || !staging) {
                    throw new OfflinePackageInconsistent(
                        `no staging revision is open for package ${parsed.packageId}`,
                    );
                }
                if (
                    staging.packageRevision !== parsed.packageRevision ||
                    staging.checkoutId !== parsed.checkoutId
                ) {
                    throw new OfflinePackageInconsistent(
                        `page ${parsed.pageIndex} belongs to another revision`,
                    );
                }

                const previous = staging.pages.find(
                    (entry) => entry.pageIndex === parsed.pageIndex,
                );
                if (previous) {
                    if (previous.checksum === checksum) return;
                    throw new OfflinePackageInconsistent(
                        `page ${parsed.pageIndex} arrived twice with different contents`,
                    );
                }
                if (parsed.pageIndex !== staging.nextPageIndex) {
                    throw new OfflinePackageInconsistent(
                        `expected page ${staging.nextPageIndex}, got ${parsed.pageIndex}`,
                    );
                }

                const bytes = staging.bytes + decodedBytes + staged.bytes;
                if (bytes > PACKAGE_MAX_TOTAL_BYTES) {
                    throw new OfflinePackageTooLarge(
                        `staging reached ${bytes} bytes, past the ${PACKAGE_MAX_TOTAL_BYTES} ceiling`,
                    );
                }

                for (const membership of parsed.records.memberships) {
                    if (membership.packageRevision !== parsed.packageRevision) {
                        throw new OfflinePackageInconsistent(
                            "a membership record names another revision",
                        );
                    }
                    await tx.put(STORE.packageMembership, {
                        userId,
                        packageId: parsed.packageId,
                        packageRevision: parsed.packageRevision,
                        canonicalId: membership.canonicalId,
                    } satisfies MembershipRecord);
                }

                for (const problem of parsed.records.problems) {
                    await tx.put(STORE.problems, {
                        userId,
                        contentRevision: problem.contentRevision,
                        canonicalId: problem.canonicalId,
                        // IndexedDB will not index an undefined component, and a
                        // topicless problem must still be reachable.
                        topic: problem.topic ?? "",
                        problem,
                    } satisfies ProblemRecord);
                }

                for (const placement of parsed.records.placements) {
                    await tx.put(STORE.placements, {
                        userId,
                        packageRevision: parsed.packageRevision,
                        placementId: placement.placementId,
                        canonicalId: placement.canonicalId,
                        testId: placement.testId ?? -1,
                        seriesId: placement.series?.id ?? placement.test?.seriesId ?? -1,
                        placement,
                    } satisfies PlacementRecord);
                }

                for (const asset of parsed.records.assets) {
                    await tx.put(STORE.assets, {
                        userId,
                        packageRevision: parsed.packageRevision,
                        key: asset.key,
                        url: asset.url,
                    } satisfies AssetRecord);
                }

                for (const rating of parsed.records.ratings) {
                    await tx.put(STORE.stagedRatings, {
                        userId,
                        packageRevision: parsed.packageRevision,
                        canonicalId: rating.canonicalId,
                        rating: rating.rating,
                        rd: rating.rd,
                        attempts: rating.attempts,
                    } satisfies StagedRatingRecord);
                }

                for (const state of parsed.records.personalStates) {
                    if (state.userId !== userId) {
                        throw new OfflinePackageInconsistent(
                            "a personal-state record belongs to another user",
                        );
                    }
                    await tx.put(STORE.stagedPersonalState, {
                        ...personalStateRecord(userId, state),
                        packageRevision: parsed.packageRevision,
                    } satisfies StagedPersonalStateRecord);
                }

                const next: StagingRecord = {
                    ...staging,
                    nextPageIndex: parsed.pageIndex + 1,
                    pages: [...staging.pages, { pageIndex: parsed.pageIndex, checksum }],
                    complete: parsed.nextCursor === null,
                    bytes,
                    staged: {
                        memberships:
                            staging.staged.memberships + parsed.counts.memberships,
                        problems: staging.staged.problems + parsed.counts.problems,
                        placements: staging.staged.placements + parsed.counts.placements,
                        assets: staging.staged.assets + parsed.counts.assets,
                        personalStates:
                            staging.staged.personalStates + parsed.counts.personalStates,
                        ratings: staging.staged.ratings + parsed.counts.ratings,
                    },
                };
                await tx.put(STORE.packages, { ...record, staging: next });
            },
        );
    }

    async #pageAlreadyStaged(
        page: OfflinePackagePageV1,
        checksum: string,
    ): Promise<boolean> {
        return this.#storage.transaction(
            [STORE.meta, STORE.packages],
            "readonly",
            async (tx) => {
                const userId = await this.#activeUser(tx);
                const record = await tx.get<PackageRecord>(STORE.packages, [
                    userId,
                    page.packageId,
                ]);
                const entry = record?.staging?.pages.find(
                    (candidate) => candidate.pageIndex === page.pageIndex,
                );
                if (!entry) return false;
                if (entry.checksum !== checksum) {
                    throw new OfflinePackageInconsistent(
                        `page ${page.pageIndex} arrived twice with different contents`,
                    );
                }
                return true;
            },
        );
    }

    async commitPackage(input: OfflineCommitPackageInputV1): Promise<void> {
        // Required images are verified before the promoting transaction opens,
        // because checking CacheStorage is an await this transaction cannot hold.
        const { assets, previousRevision } = await this.#storage.transaction(
            [STORE.meta, STORE.packages, STORE.assets],
            "readonly",
            async (tx) => {
                const userId = await this.#activeUser(tx);
                const record = await tx.get<PackageRecord>(STORE.packages, [
                    userId,
                    input.packageId,
                ]);
                if (!record?.staging) {
                    throw new OfflinePackageInconsistent(
                        `no staging revision is open for package ${input.packageId}`,
                    );
                }
                const rows = await tx.getAll<AssetRecord>(STORE.assets, {
                    index: "byRevision",
                    only: [userId, input.packageRevision],
                });
                return {
                    assets: rows.map((row) => ({
                        key: row.key,
                        url: row.url,
                        kind: "problem-image" as const,
                        required: true as const,
                    })),
                    previousRevision: record.activeRevision,
                };
            },
        );

        const missingAssets = await this.#media.missing(input.packageRevision, assets);
        if (missingAssets.length > 0) {
            throw new OfflinePackageInconsistent(
                `${missingAssets.length} required image(s) are not in the revision's media cache`,
            );
        }

        await this.#storage.transaction(
            // Wide on purpose: this transaction promotes shared state, writes the
            // session snapshot beside the local work that may already outrank it,
            // and drops the superseded revision (`#dropRevision` reaches
            // `placements` and `assets`). Every one of those has to be in scope,
            // or the promotion is half-applied — which is precisely what the
            // atomic commit exists to prevent.
            [STORE.meta, STORE.packages, STORE.packageMembership, STORE.problems,
             STORE.placements, STORE.assets, STORE.ratings, STORE.personalState,
             STORE.stagedRatings, STORE.stagedPersonalState, STORE.sessions,
             STORE.localSubmissions],
            "readwrite",
            async (tx) => {
                const userId = await this.#activeUser(tx);
                const record = await tx.get<PackageRecord>(STORE.packages, [
                    userId,
                    input.packageId,
                ]);
                const staging = record?.staging;
                if (!record || !staging) {
                    throw new OfflinePackageInconsistent(
                        `no staging revision is open for package ${input.packageId}`,
                    );
                }
                if (
                    staging.packageRevision !== input.packageRevision ||
                    staging.checkoutId !== input.checkoutId
                ) {
                    throw new OfflinePackageInconsistent(
                        "the staging revision does not match the commit request",
                    );
                }
                if (!staging.complete) {
                    throw new OfflinePackageInconsistent(
                        "the final page has not been staged",
                    );
                }

                const indexes = staging.pages.map((page) => page.pageIndex).sort((a, b) => a - b);
                for (let i = 0; i < indexes.length; i += 1) {
                    if (indexes[i] !== i) {
                        throw new OfflinePackageInconsistent(
                            `page indexes are not contiguous (missing ${i})`,
                        );
                    }
                }

                assertCount("problems", staging.staged.problems, input.expectedProblems);
                assertCount(
                    "placements",
                    staging.staged.placements,
                    input.expectedPlacements,
                );
                assertCount("assets", staging.staged.assets, input.expectedAssets);
                assertCount("problems", staging.staged.problems, staging.problemCount);
                assertCount("placements", staging.staged.placements, staging.placementCount);

                // Every membership must have content behind it at this revision's
                // content revision, or the package verifies as complete while a
                // problem it claims to contain is unreadable.
                const memberships = await tx.getAll<MembershipRecord>(
                    STORE.packageMembership,
                    { index: "byRevision", only: [userId, input.packageRevision] },
                );
                for (const membership of memberships) {
                    const problem = await tx.get<ProblemRecord>(STORE.problems, [
                        userId,
                        staging.contentRevision,
                        membership.canonicalId,
                    ]);
                    if (!problem) {
                        throw new OfflinePackageInconsistent(
                            `canonical ${membership.canonicalId} has membership but no content`,
                        );
                    }
                }

                // Promote the staged shared state. This is the point at which a
                // refresh's server truth becomes visible — to every overlapping
                // package at once, which is why it is shared rather than copied.
                const stagedRatings = await tx.getAll<StagedRatingRecord>(
                    STORE.stagedRatings,
                    { index: "byRevision", only: [userId, input.packageRevision] },
                );
                for (const staged of stagedRatings) {
                    await tx.put(STORE.ratings, {
                        userId,
                        canonicalId: staged.canonicalId,
                        rating: staged.rating,
                        rd: staged.rd,
                        attempts: staged.attempts,
                    } satisfies RatingRecord);
                }
                const stagedStates = await tx.getAll<StagedPersonalStateRecord>(
                    STORE.stagedPersonalState,
                    { index: "byRevision", only: [userId, input.packageRevision] },
                );
                for (const staged of stagedStates) {
                    const existing = await tx.get<PersonalStateRecord>(
                        STORE.personalState,
                        [userId, staged.canonicalId],
                    );
                    await tx.put(STORE.personalState, {
                        userId,
                        canonicalId: staged.canonicalId,
                        progress: staged.progress,
                        mastery: staged.mastery,
                        engagement: staged.engagement,
                        timesSeen: staged.timesSeen,
                        // A refresh does not clear a staleness flag raised by
                        // local work the server has not seen yet.
                        scheduleStale: existing?.scheduleStale ?? false,
                    } satisfies PersonalStateRecord);
                }
                await tx.deleteAll(STORE.stagedRatings, {
                    index: "byRevision",
                    only: [userId, input.packageRevision],
                });
                await tx.deleteAll(STORE.stagedPersonalState, {
                    index: "byRevision",
                    only: [userId, input.packageRevision],
                });

                const existingSession = await tx.get<SessionRecord>(STORE.sessions, [
                    userId,
                    staging.baseState.session.id,
                ]);
                const localSessionWork = await tx.getAll<LocalSubmissionV1>(
                    STORE.localSubmissions,
                    {
                        index: "byUserSession",
                        only: [userId, staging.baseState.session.id],
                    },
                );
                await tx.put(STORE.sessions, {
                    userId,
                    sessionId: staging.baseState.session.id,
                    packageId: input.packageId,
                    status:
                        localSessionWork.length && existingSession
                            ? existingSession.status
                            : staging.baseState.session.status,
                    row:
                        localSessionWork.length && existingSession
                            ? existingSession.row
                            : staging.baseState.session,
                    playerRating: staging.baseState.playerRating,
                } satisfies SessionRecord);
                await tx.put(STORE.meta, {
                    key: META.checkout(staging.checkoutId),
                    value: {
                        userId,
                        packageId: input.packageId,
                        packageRevision: staging.packageRevision,
                    },
                } satisfies MetaRecord);

                const { nextPageIndex, pages, complete, staged, bytes, baseState, ...revision } =
                    staging;
                void nextPageIndex;
                void pages;
                void complete;
                void staged;
                void baseState;
                await tx.put(STORE.packages, {
                    ...record,
                    state: "ready",
                    activeRevision: staging.packageRevision,
                    active: { ...revision, byteCount: bytes },
                    staging: null,
                } satisfies PackageRecord);

                // Only now may the superseded revision go.
                if (previousRevision && previousRevision !== staging.packageRevision) {
                    await this.#dropRevision(tx, userId, previousRevision);
                }
            },
        );

        if (previousRevision && previousRevision !== input.packageRevision) {
            await this.#media.discard(previousRevision);
        }
    }

    async abortStagingPackage(packageId: UUID): Promise<void> {
        const revision = await this.#storage.transaction(
            [STORE.meta, STORE.packages, STORE.packageMembership, STORE.placements,
             STORE.assets, STORE.stagedRatings, STORE.stagedPersonalState],
            "readwrite",
            async (tx) => {
                const userId = await this.#activeUser(tx);
                const record = await tx.get<PackageRecord>(STORE.packages, [
                    userId,
                    packageId,
                ]);
                if (!record?.staging) return null;
                const staged = record.staging.packageRevision;
                await this.#dropRevision(tx, userId, staged);
                if (record.active) {
                    await tx.put(STORE.packages, { ...record, staging: null });
                } else {
                    // Nothing was ever ready under this id, so the package does
                    // not exist. Outbox and local overlay records are keyed by
                    // user, not by package revision, and are untouched.
                    await tx.delete(STORE.packages, [userId, packageId]);
                }
                return staged;
            },
        );
        if (revision) await this.#media.discard(revision);
    }

    /** Delete every revision-scoped record for one package revision. */
    async #dropRevision(tx: OfflineTx, userId: UUID, revision: string): Promise<void> {
        const only = [userId, revision];
        await tx.deleteAll(STORE.packageMembership, { index: "byRevision", only });
        await tx.deleteAll(STORE.placements, { index: "byRevision", only });
        await tx.deleteAll(STORE.assets, { index: "byRevision", only });
        await tx.deleteAll(STORE.stagedRatings, { index: "byRevision", only });
        await tx.deleteAll(STORE.stagedPersonalState, { index: "byRevision", only });
    }

    /**
     * Delete a ready package. Immediate only when nothing is pending for it:
     * otherwise the user must sync first or explicitly discard the named work,
     * because a delete that silently drops unsynced submissions is data loss
     * dressed as housekeeping.
     */
    async deletePackage(
        packageId: UUID,
        options: { discardPending?: boolean } = {},
    ): Promise<void> {
        const revisions = await this.#storage.transaction(
            [STORE.meta, STORE.packages, STORE.packageMembership, STORE.placements,
             STORE.assets, STORE.stagedRatings, STORE.stagedPersonalState, STORE.outbox,
             STORE.sessions, STORE.localSubmissions, STORE.organizationOverrides],
            "readwrite",
            async (tx) => {
                const userId = await this.#activeUser(tx);
                const record = await tx.get<PackageRecord>(STORE.packages, [
                    userId,
                    packageId,
                ]);
                if (!record) return [];

                const pending = (
                    await tx.getAll<OfflineOperationV1>(STORE.outbox, {
                        index: "byUser",
                        only: [userId],
                    })
                ).filter((operation) => operation.packageId === packageId);
                if (pending.length > 0 && !options.discardPending) {
                    throw new Error(
                        `${pending.length} unsynced operation(s) belong to this package; sync or explicitly discard them first`,
                    );
                }
                if (options.discardPending) {
                    const pendingIds = new Set(pending.map((operation) => operation.id));
                    for (const operation of pending) {
                        await tx.delete(STORE.outbox, [userId, operation.sequence]);
                    }
                    for (const submission of await tx.getAll<LocalSubmissionV1>(
                        STORE.localSubmissions,
                        { index: "byUserSession", only: [userId, record.active?.sessionId ?? -1] },
                    )) {
                        if (pendingIds.has(submission.operationId)) {
                            await tx.delete(STORE.localSubmissions, [userId, submission.clientKey]);
                        }
                    }
                    for (const override of await tx.getAll<OrganizationOverrideRecord>(
                        STORE.organizationOverrides,
                        { index: "byUser", only: [userId] },
                    )) {
                        if (pendingIds.has(override.operationId)) {
                            await tx.delete(STORE.organizationOverrides, [userId, override.canonicalId, override.axis]);
                        }
                    }
                }

                const dropped: string[] = [];
                for (const revision of [record.activeRevision, record.staging?.packageRevision]) {
                    if (!revision) continue;
                    await this.#dropRevision(tx, userId, revision);
                    dropped.push(revision);
                }
                await tx.delete(STORE.packages, [userId, packageId]);
                if (record.active) {
                    await tx.delete(STORE.sessions, [userId, record.active.sessionId]);
                }
                return dropped;
            },
        );
        for (const revision of revisions) await this.#media.discard(revision);
    }

    /** Remove media caches no package revision references any more. */
    async collectMediaGarbage(): Promise<string[]> {
        const keep = await this.#storage.transaction(
            [STORE.packages],
            "readonly",
            async (tx) => {
                const records = await tx.getAll<PackageRecord>(STORE.packages);
                const revisions: string[] = [];
                for (const record of records) {
                    if (record.activeRevision) revisions.push(record.activeRevision);
                    if (record.staging) revisions.push(record.staging.packageRevision);
                }
                return revisions;
            },
        );
        return this.#media.collectGarbage(keep);
    }

    // --- Package metadata ----------------------------------------------------

    async listPackages(userId: UUID): Promise<OfflinePackageManifestV1[]> {
        return this.#storage.transaction(
            [STORE.meta, STORE.packages, STORE.outbox],
            "readonly",
            async (tx) => {
                await this.#requireActiveUser(tx, userId);
                const records = await tx.getAll<PackageRecord>(STORE.packages, {
                    index: "byUser",
                    only: [userId],
                });
                const operations = await tx.getAll<OfflineOperationV1>(STORE.outbox, {
                    index: "byUser",
                    only: [userId],
                });
                const now = this.#now().getTime();
                return records
                    .filter((record) => record.active !== null)
                    .map((record) => {
                        const active = record.active!;
                        const age = now - Date.parse(active.downloadedAt);
                        return {
                            packageId: record.packageId,
                            userId,
                            scope: active.scope,
                            contentRevision: active.contentRevision,
                            packageRevision: active.packageRevision,
                            requestId: active.requestId,
                            checkoutId: active.checkoutId,
                            sessionId: active.sessionId,
                            personalStateAt: active.personalStateAt,
                            downloadedAt: active.downloadedAt,
                            schemaVersion: record.schemaVersion,
                            problemCount: active.problemCount,
                            placementCount: active.placementCount,
                            assetCount: active.assetCount,
                            byteCount: active.byteCount,
                            // Staleness warns; it never blocks opening a package
                            // and never deletes pending work.
                            state:
                                record.state === "incompatible"
                                    ? "incompatible"
                                    : age > PACKAGE_FRESHNESS_MS
                                      ? "stale"
                                      : "ready",
                            lastSyncedAt: record.lastSyncedAt,
                            pendingOperations: operations.filter(
                                (operation) => operation.packageId === record.packageId,
                            ).length,
                        } satisfies OfflinePackageManifestV1;
                    });
            },
        );
    }

    // --- Queries -------------------------------------------------------------

    async queryProblems(query: PracticeQueryV1): Promise<PracticeQueryResultV1> {
        const loaded = await this.#loadCandidates(query.userId, query.packageIds);
        if ("unavailable" in loaded) {
            return { status: "package_unavailable", problems: [], reason: loaded.unavailable };
        }

        const missing = missingCoverage(query.filters, coverageOf(loaded.candidates));
        if (missing.topic.length > 0 || missing.seriesIds.length > 0) {
            // The query asked to expand past what was downloaded. That is never
            // `exhausted`, and never a network request.
            return { status: "not_downloaded", problems: [], missing };
        }

        const { problems, availableCount } = runPracticeQuery(loaded.candidates, query);
        if (availableCount === 0) {
            return { status: "exhausted", problems: [], availableCount: 0 };
        }
        return { status: "ok", problems, availableCount };
    }

    async browseProblems(query: BrowseQueryV1): Promise<BrowseQueryResultV1> {
        const loaded = await this.#loadCandidates(query.userId, query.packageIds);
        if ("unavailable" in loaded) {
            return { status: "package_unavailable", problems: [], reason: loaded.unavailable };
        }
        const requested = {
            topic: query.filters.topic ?? [],
            seriesIds: query.filters.seriesId == null ? [] : [String(query.filters.seriesId)],
        };
        const missing = missingCoverage(requested, coverageOf(loaded.candidates));
        if (missing.topic.length > 0 || missing.seriesIds.length > 0) {
            return { status: "not_downloaded", problems: [], missing };
        }
        const { problems, availableCount } = runBrowseQuery(loaded.candidates, query);
        return { status: "ok", problems, availableCount };
    }

    async getProblem(input: {
        userId: UUID;
        packageIds: UUID[];
        canonicalId: number;
    }): Promise<OfflinePracticeProblemV1 | null> {
        const loaded = await this.#loadCandidates(input.userId, input.packageIds);
        if ("unavailable" in loaded) return null;
        const candidate = loaded.candidates.find(
            (entry) => entry.canonicalId === input.canonicalId,
        );
        return candidate
            ? {
                  canonicalId: candidate.canonicalId,
                  sourcePackageIds: candidate.sourcePackageIds,
                  problem: candidate.problem,
                  placements: candidate.placements,
                  rating: candidate.rating,
                  progress: candidate.progress,
                  progressIsProvisional: candidate.progressIsProvisional,
              }
            : null;
    }

    /**
     * Load the package-bounded candidate set, with the overlay already folded
     * in. Reads are bulk (`getAll` over an index) rather than per-canonical:
     * with a 10,000-problem package ceiling, one pass plus TypeScript predicates
     * is the design the contract chose over an inverted-index subsystem.
     */
    async #loadCandidates(
        userId: UUID,
        packageIds: UUID[],
    ): Promise<Loaded | { unavailable: "missing" | "staging" | "incompatible" }> {
        return this.#storage.transaction(
            [STORE.meta, STORE.packages, STORE.packageMembership, STORE.problems,
             STORE.placements, STORE.ratings, STORE.personalState,
             STORE.localSubmissions, STORE.organizationOverrides, STORE.assets],
            "readonly",
            async (tx) => {
                await this.#requireActiveUser(tx, userId);
                const all = await tx.getAll<PackageRecord>(STORE.packages, {
                    index: "byUser",
                    only: [userId],
                });
                const byId = new Map(all.map((record) => [record.packageId, record]));

                const wanted = packageIds.length
                    ? packageIds
                    : all.filter((record) => record.active).map((record) => record.packageId);

                const packages: PackageRecord[] = [];
                for (const id of wanted) {
                    const record = byId.get(id);
                    if (!record) return { unavailable: "missing" as const };
                    if (record.state === "incompatible") {
                        return { unavailable: "incompatible" as const };
                    }
                    if (!record.active) return { unavailable: "staging" as const };
                    packages.push(record);
                }

                const ratings = new Map(
                    (
                        await tx.getAll<RatingRecord>(STORE.ratings, {
                            index: "byUser",
                            only: [userId],
                        })
                    ).map((row) => [row.canonicalId, row]),
                );
                const states = new Map(
                    (
                        await tx.getAll<PersonalStateRecord>(STORE.personalState, {
                            index: "byUser",
                            only: [userId],
                        })
                    ).map((row) => [row.canonicalId, row]),
                );
                const submissions = groupByCanonical(
                    await tx.getAll<LocalSubmissionV1>(STORE.localSubmissions, {
                        index: "byUser",
                        only: [userId],
                    }),
                );
                const overrides = groupByCanonical(
                    (
                        await tx.getAll<OrganizationOverrideRecord>(
                            STORE.organizationOverrides,
                            { index: "byUser", only: [userId] },
                        )
                    ).map(
                        (row): OrganizationOverride & { canonicalId: number } => ({
                            canonicalId: row.canonicalId,
                            axis: row.axis,
                            value: row.value,
                            sequence: row.sequence,
                        }),
                    ),
                );

                const candidates = new Map<number, QueryCandidate>();
                for (const record of packages) {
                    const active = record.active!;
                    const revisionAssets = await tx.getAll<AssetRecord>(STORE.assets, {
                        index: "byRevision",
                        only: [userId, active.packageRevision],
                    });
                    const assetsByKey = new Map(revisionAssets.map((asset) => [asset.key, {
                        key: asset.key,
                        url: asset.url,
                        kind: "problem-image" as const,
                        required: true as const,
                    }]));
                    const content = new Map(
                        (
                            await tx.getAll<ProblemRecord>(STORE.problems, {
                                index: "byUserContent",
                                only: [userId, active.contentRevision],
                            })
                        ).map((row) => [row.canonicalId, row]),
                    );
                    const placements = new Map<number, PlacementRecord[]>();
                    for (const row of await tx.getAll<PlacementRecord>(STORE.placements, {
                        index: "byRevision",
                        only: [userId, active.packageRevision],
                    })) {
                        const list = placements.get(row.canonicalId);
                        if (list) list.push(row);
                        else placements.set(row.canonicalId, [row]);
                    }

                    const memberships = await tx.getAll<MembershipRecord>(
                        STORE.packageMembership,
                        { index: "byRevision", only: [userId, active.packageRevision] },
                    );
                    for (const membership of memberships) {
                        const problem = content.get(membership.canonicalId);
                        // A membership without content cannot survive commit, so
                        // this only fires for a package being torn down.
                        if (!problem) continue;
                        const existing = candidates.get(membership.canonicalId);
                        const own = (placements.get(membership.canonicalId) ?? []).map(
                            (row) => row.placement,
                        );
                        if (existing) {
                            // Overlapping packages contribute placements to one
                            // shared candidate; personal state is shared already.
                            existing.placements = mergePlacements(existing.placements, own);
                            if (!existing.sourcePackageIds.includes(record.packageId)) {
                                existing.sourcePackageIds.push(record.packageId);
                            }
                            continue;
                        }
                        const state = states.get(membership.canonicalId) ?? null;
                        const folded = effectiveProgress(
                            state?.progress ?? null,
                            submissions.get(membership.canonicalId) ?? [],
                            overrides.get(membership.canonicalId) ?? [],
                        );
                        const rating = ratings.get(membership.canonicalId);
                        candidates.set(membership.canonicalId, {
                            canonicalId: membership.canonicalId,
                            sourcePackageIds: [record.packageId],
                                problem: rewriteProblemMedia(
                                    problem.problem,
                                    active.packageRevision,
                                    problem.problem.assetKeys.flatMap((key) => {
                                        const asset = assetsByKey.get(key);
                                        return asset ? [asset] : [];
                                    }),
                                ),
                            placements: own,
                            rating: rating
                                ? {
                                      canonicalId: rating.canonicalId,
                                      rating: rating.rating,
                                      rd: rating.rd,
                                      attempts: rating.attempts,
                                  }
                                : null,
                            progress: folded.progress,
                            progressIsProvisional: folded.provisional,
                        });
                    }
                }

                return { packages, candidates: [...candidates.values()] };
            },
        );
    }

    // --- Sessions and local writes -------------------------------------------

    async createLocalSession(
        userId: UUID,
        input: {
            name: string | null;
            settings: import("$lib/trainer").PracticeSettings;
            isRoot?: boolean;
        },
    ): Promise<PracticeSessionRow> {
        const clientSessionId = this.#newId();
        const now = this.#now().toISOString();
        return this.#storage.transaction(
            [STORE.meta, STORE.sessions],
            "readwrite",
            async (tx) => {
                await this.#requireActiveUser(tx, userId);
                const key = META.localSessionSequence(userId);
                const previous = await tx.get<MetaRecord>(STORE.meta, [key]);
                const sessionId = ((previous?.value as number | undefined) ?? 0) - 1;
                await tx.put(STORE.meta, { key, value: sessionId } satisfies MetaRecord);
                const row: PracticeSessionRow = {
                    id: sessionId,
                    user_id: userId,
                    name: input.name,
                    is_root: input.isRoot ?? false,
                    settings: input.settings as PracticeSessionRow["settings"],
                    status: "active",
                    started_at: now,
                    created_at: now,
                    updated_at: now,
                    ended_at: null,
                    current_problem_id: null,
                    current_elapsed_ms: 0,
                    last_submission_at: null,
                    times_seen: 0,
                    times_reviewed: 0,
                    times_correct: 0,
                    times_skipped: 0,
                    total_time_ms: 0,
                };
                await tx.put(STORE.sessions, {
                    userId,
                    sessionId,
                    packageId: null,
                    clientSessionId,
                    serverSessionId: null,
                    status: row.status,
                    row,
                    playerRating: null,
                } satisfies SessionRecord);
                return row;
            },
        );
    }

    async listLocalSessions(userId: UUID): Promise<PracticeSessionRow[]> {
        return this.#storage.transaction(
            [STORE.meta, STORE.sessions],
            "readonly",
            async (tx) => {
                await this.#requireActiveUser(tx, userId);
                return (await tx.getAll<SessionRecord>(STORE.sessions, {
                    index: "byUser",
                    only: [userId],
                }))
                    .filter((record) => Boolean(record.clientSessionId))
                    .map((record) => record.row)
                    .sort((a, b) => b.started_at.localeCompare(a.started_at));
            },
        );
    }

    /** Store the session and player-rating snapshot a package downloaded with. */
    async putSessionSnapshot(
        userId: UUID,
        packageId: UUID,
        base: OfflinePackageBaseStateV1,
    ): Promise<void> {
        await this.#storage.transaction(
            [STORE.meta, STORE.sessions],
            "readwrite",
            async (tx) => {
                await this.#requireActiveUser(tx, userId);
                await tx.put(STORE.sessions, {
                    userId,
                    sessionId: base.session.id,
                    packageId,
                    status: base.session.status,
                    row: base.session,
                    playerRating: base.playerRating,
                } satisfies SessionRecord);
            },
        );
    }

    async loadSession(userId: UUID, sessionId: number): Promise<OfflineSessionV1 | null> {
        return this.#storage.transaction(
            [STORE.meta, STORE.sessions, STORE.localSubmissions],
            "readonly",
            async (tx) => {
                await this.#requireActiveUser(tx, userId);
                const record = await tx.get<SessionRecord>(STORE.sessions, [
                    userId,
                    sessionId,
                ]);
                if (!record) return null;
                const localSubmissions = (
                    await tx.getAll<LocalSubmissionV1>(STORE.localSubmissions, {
                        index: "byUserSession",
                        only: [userId, sessionId],
                    })
                ).sort((a, b) => a.sequence - b.sequence);
                return {
                    userId,
                    sessionId,
                    packageId: record.packageId,
                    clientSessionId: record.clientSessionId,
                    serverSessionId: record.serverSessionId,
                    row: record.row,
                    localSubmissions,
                };
            },
        );
    }

    /** The frozen player rating a package downloaded with. Never synced back. */
    async getPlayerRating(userId: UUID, sessionId: number): Promise<PlayerRating | null> {
        return this.#storage.transaction(
            [STORE.meta, STORE.sessions],
            "readonly",
            async (tx) => {
                await this.#requireActiveUser(tx, userId);
                const record = await tx.get<SessionRecord>(STORE.sessions, [
                    userId,
                    sessionId,
                ]);
                return record?.playerRating ?? null;
            },
        );
    }

    async updateSessionSettings(
        userId: UUID,
        sessionId: number,
        settings: import("$lib/trainer").PracticeSettings,
    ): Promise<void> {
        await this.#storage.transaction(
            [STORE.meta, STORE.sessions],
            "readwrite",
            async (tx) => {
                await this.#requireActiveUser(tx, userId);
                const record = await tx.get<SessionRecord>(STORE.sessions, [userId, sessionId]);
                if (!record) throw new Error(`Unknown offline session ${sessionId}`);
                await tx.put(STORE.sessions, {
                    ...record,
                    row: {
                        ...record.row,
                        settings: settings as PracticeSessionRow["settings"],
                        updated_at: this.#now().toISOString(),
                    },
                });
            },
        );
    }

    async setCurrentProblem(input: OfflineCurrentProblemInputV1): Promise<void> {
        await this.#storage.transaction(
            [STORE.meta, STORE.sessions],
            "readwrite",
            async (tx) => {
                await this.#requireActiveUser(tx, input.userId);
                const record = await tx.get<SessionRecord>(STORE.sessions, [
                    input.userId,
                    input.sessionId,
                ]);
                if (!record) throw new Error(`Unknown offline session ${input.sessionId}`);
                await tx.put(STORE.sessions, {
                    ...record,
                    row: {
                        ...record.row,
                        current_problem_id: input.canonicalId,
                        current_elapsed_ms: Math.max(0, Math.round(input.elapsedMs)),
                    },
                });
            },
        );
    }

    async recordSubmission(
        input: OfflineSubmissionInputV1,
    ): Promise<LocalSubmissionV1> {
        // Identity and the stamp are minted before the transaction: nothing
        // inside one may await, and both are pure.
        const clientKey = this.#newId();
        const operationId = this.#newId();
        const stamp = this.#clock.stamp(this.#now());

        return this.#storage.transaction(
            [STORE.meta, STORE.sessions, STORE.localSubmissions, STORE.outbox,
             STORE.personalState],
            "readwrite",
            async (tx) => {
                await this.#requireActiveUser(tx, input.userId);
                const session = await tx.get<SessionRecord>(STORE.sessions, [
                    input.userId,
                    input.sessionId,
                ]);
                if (!session) throw new Error(`Unknown offline session ${input.sessionId}`);

                const sequence = await this.#nextSequence(tx, input.userId);
                const submission: LocalSubmissionV1 = {
                    userId: input.userId,
                    clientKey,
                    operationId,
                    sessionId: input.sessionId,
                    packageId: input.packageId,
                    canonicalId: input.canonicalId,
                    sequence,
                    occurredAt: stamp.occurredAt,
                    selectedChoice: input.selectedChoice,
                    answer: input.answer,
                    isCorrect: input.isCorrect,
                    skipped: input.skipped,
                    flagged: input.flagged,
                    elapsedMs: Math.max(0, Math.round(input.elapsedMs)),
                    triesUsed: input.triesUsed,
                };
                await tx.put(STORE.localSubmissions, submission);

                const operation: OfflineOperationV1 = {
                    version: 1,
                    id: operationId,
                    userId: input.userId,
                    checkoutId: input.checkoutId,
                    packageId: input.packageId,
                    sessionId: input.sessionId,
                    clientSessionId: input.clientSessionId,
                    sequence,
                    runtimeId: stamp.runtimeId,
                    monotonicOffsetMs: stamp.monotonicOffsetMs,
                    occurredAt: stamp.occurredAt,
                    dependsOn: [],
                    state: "pending",
                    type: "submission",
                    payload: {
                        clientKey,
                        canonicalId: input.canonicalId,
                        selectedChoice: input.selectedChoice,
                        answer: input.answer,
                        isCorrect: input.isCorrect,
                        skipped: input.skipped,
                        flagged: input.flagged,
                        elapsedMs: submission.elapsedMs,
                        source: "practice",
                        triesUsed: input.triesUsed,
                    },
                };
                await tx.put(STORE.outbox, operation);

                const row: PracticeSessionRow = {
                    ...session.row,
                    times_seen: session.row.times_seen + 1,
                    times_skipped: session.row.times_skipped + (input.skipped ? 1 : 0),
                    times_reviewed:
                        session.row.times_reviewed +
                        (!input.skipped && input.isCorrect !== null ? 1 : 0),
                    times_correct: session.row.times_correct + (input.isCorrect ? 1 : 0),
                    total_time_ms: session.row.total_time_ms + submission.elapsedMs,
                    last_submission_at: stamp.occurredAt,
                    current_problem_id: null,
                    current_elapsed_ms: 0,
                };
                await tx.put(STORE.sessions, { ...session, row });

                // The frozen SM-2 schedule no longer describes this problem.
                // V1 marks it stale rather than inventing a local one.
                if (!input.skipped && input.isCorrect !== null) {
                    const state = await tx.get<PersonalStateRecord>(STORE.personalState, [
                        input.userId,
                        input.canonicalId,
                    ]);
                    await tx.put(STORE.personalState, {
                        userId: input.userId,
                        canonicalId: input.canonicalId,
                        progress: state?.progress ?? null,
                        mastery: state?.mastery ?? null,
                        engagement: state?.engagement ?? null,
                        timesSeen: state?.timesSeen ?? 0,
                        scheduleStale: true,
                    } satisfies PersonalStateRecord);
                }

                return submission;
            },
        );
    }

    async setMastery(input: OfflineMasteryInputV1): Promise<void> {
        await this.#setOrganization("mastery", input, input.mastery);
    }

    async setEngagement(input: OfflineEngagementInputV1): Promise<void> {
        await this.#setOrganization("engagement", input, input.engagement);
    }

    /**
     * Mastery and engagement operations **coalesce** by `(user, canonical,
     * type)` while pending: the last local intent is what the server needs. The
     * coalesced operation keeps the earlier one's `sequence` (so it still lands
     * after the submission it belongs to) and unions the dependencies, because
     * the ordering constraint is what a coalesce must never lose.
     */
    async #setOrganization(
        axis: "mastery" | "engagement",
        input: {
            userId: UUID;
            packageId: UUID;
            checkoutId: UUID;
            sessionId: number;
            clientSessionId?: UUID;
            canonicalId: number;
            dependsOn?: UUID[];
        },
        value: Mastery | Engagement | null,
    ): Promise<void> {
        const operationId = this.#newId();
        const stamp = this.#clock.stamp(this.#now());

        await this.#storage.transaction(
            [STORE.meta, STORE.outbox, STORE.organizationOverrides],
            "readwrite",
            async (tx) => {
                await this.#requireActiveUser(tx, input.userId);
                const pending = await tx.getAll<OfflineOperationV1>(STORE.outbox, {
                    index: "byUser",
                    only: [input.userId],
                });
                const existing = pending.find(
                    (operation) =>
                        operation.type === axis &&
                        operation.state !== "syncing" &&
                        operation.payload.canonicalId === input.canonicalId,
                );

                const dependsOn = [
                    ...new Set([...(existing?.dependsOn ?? []), ...(input.dependsOn ?? [])]),
                ].slice(0, SYNC_MAX_DEPENDENCIES);

                const sequence =
                    existing?.sequence ?? (await this.#nextSequence(tx, input.userId));

                const operation = {
                    version: 1,
                    id: existing?.id ?? operationId,
                    userId: input.userId,
                    checkoutId: input.checkoutId,
                    packageId: input.packageId,
                    sessionId: input.sessionId,
                    clientSessionId: input.clientSessionId,
                    sequence,
                    runtimeId: stamp.runtimeId,
                    monotonicOffsetMs: stamp.monotonicOffsetMs,
                    occurredAt: stamp.occurredAt,
                    dependsOn,
                    state: "pending",
                    type: axis,
                    payload:
                        axis === "mastery"
                            ? { canonicalId: input.canonicalId, mastery: value as Mastery | null }
                            : {
                                  canonicalId: input.canonicalId,
                                  engagement: value as Engagement | null,
                              },
                } as OfflineOperationV1;
                await tx.put(STORE.outbox, operation);

                await tx.put(STORE.organizationOverrides, {
                    userId: input.userId,
                    canonicalId: input.canonicalId,
                    axis,
                    value,
                    sequence,
                    operationId: operation.id,
                } satisfies OrganizationOverrideRecord);
            },
        );
    }

    async finishSession(input: OfflineFinishSessionInputV1): Promise<void> {
        const operationId = this.#newId();
        const stamp = this.#clock.stamp(this.#now());
        const endedAt = input.endedAt ?? stamp.occurredAt;

        await this.#storage.transaction(
            [STORE.meta, STORE.sessions, STORE.outbox],
            "readwrite",
            async (tx) => {
                await this.#requireActiveUser(tx, input.userId);
                const session = await tx.get<SessionRecord>(STORE.sessions, [
                    input.userId,
                    input.sessionId,
                ]);
                if (!session) throw new Error(`Unknown offline session ${input.sessionId}`);

                const sequence = await this.#nextSequence(tx, input.userId);
                await tx.put(STORE.outbox, {
                    version: 1,
                    id: operationId,
                    userId: input.userId,
                    checkoutId: input.checkoutId,
                    packageId: input.packageId,
                    sessionId: input.sessionId,
                    clientSessionId: input.clientSessionId,
                    sequence,
                    runtimeId: stamp.runtimeId,
                    monotonicOffsetMs: stamp.monotonicOffsetMs,
                    occurredAt: stamp.occurredAt,
                    dependsOn: [],
                    state: "pending",
                    type: "session-finish",
                    payload: { endedAt },
                } satisfies OfflineOperationV1);

                await tx.put(STORE.sessions, {
                    ...session,
                    status: "ended",
                    row: { ...session.row, status: "ended", ended_at: endedAt },
                });
            },
        );
    }

    async #nextSequence(tx: OfflineTx, userId: UUID): Promise<number> {
        const key = META.sequence(userId);
        const row = await tx.get<MetaRecord>(STORE.meta, [key]);
        const next = ((row?.value as number | undefined) ?? 0) + 1;
        await tx.put(STORE.meta, { key, value: next } satisfies MetaRecord);
        return next;
    }

    // --- Outbox --------------------------------------------------------------

    /**
     * The next operations to flush, in `sequence` order.
     *
     * A `failed` operation stops the batch. Skipping past it is explicitly
     * forbidden: the operations behind it depend on its ordering, and a batch
     * that steps over a permanent failure would apply them against a state the
     * server never reached.
     */
    async pendingOperations(userId: UUID, limit: number): Promise<OfflineOperationV1[]> {
        return this.#storage.transaction(
            [STORE.meta, STORE.outbox],
            "readonly",
            async (tx) => {
                await this.#requireActiveUser(tx, userId);
                const all = (
                    await tx.getAll<OfflineOperationV1>(STORE.outbox, {
                        index: "byUser",
                        only: [userId],
                    })
                ).sort((a, b) => a.sequence - b.sequence);

                const batch: OfflineOperationV1[] = [];
                for (const operation of all) {
                    if (operation.state === "failed") break;
                    batch.push(operation);
                    if (batch.length >= limit) break;
                }
                return batch;
            },
        );
    }

    async pendingSyncBatches(userId: UUID, limit: number): Promise<{
        checkoutId: UUID;
        packageId: UUID;
        packageRevision: string;
        clientSession?: import("./types").OfflineSyncRequestV1["clientSession"];
        operations: OfflineOperationV1[];
    }[]> {
        const operations = await this.pendingOperations(userId, limit);
        return this.#storage.transaction([STORE.meta, STORE.packages, STORE.sessions], "readonly", async (tx) => {
            const groups: OfflineOperationV1[][] = [];
            for (const operation of operations) {
                const previous = groups.at(-1);
                const sameBatch = previous?.[0].checkoutId === operation.checkoutId &&
                    previous?.[0].clientSessionId === operation.clientSessionId;
                if (sameBatch && previous) previous.push(operation);
                else groups.push([operation]);
            }
            const batches = [];
            for (const batch of groups) {
                const checkoutId = batch[0].checkoutId;
                const row = await tx.get<MetaRecord>(STORE.meta, [META.checkout(checkoutId)]);
                const value = row?.value as {
                    userId?: string;
                    packageId?: string;
                    packageRevision?: string;
                } | undefined;
                let revision = value?.packageRevision;
                if (!revision) {
                    // Session 1 packages predate checkout provenance in meta.
                    // They cannot have been refreshed through the then-absent
                    // network orchestrator, so their active checkout is safe to
                    // use as the one-time compatibility source.
                    const pkg = await tx.get<PackageRecord>(STORE.packages, [
                        userId,
                        batch[0].packageId,
                    ]);
                    if (pkg?.active?.checkoutId === checkoutId) {
                        revision = pkg.active.packageRevision;
                    }
                }
                if (
                    (value?.userId !== undefined && value.userId !== userId) ||
                    (value?.packageId !== undefined && value.packageId !== batch[0].packageId) ||
                    typeof revision !== "string"
                ) continue;
                let clientSession: import("./types").OfflineSyncRequestV1["clientSession"];
                if (batch[0].clientSessionId) {
                    const session = await tx.get<SessionRecord>(STORE.sessions, [
                        userId,
                        batch[0].sessionId,
                    ]);
                    if (session?.clientSessionId !== batch[0].clientSessionId) continue;
                    clientSession = {
                        clientSessionId: session.clientSessionId,
                        name: session.row.name,
                        settings: session.row.settings as import("$lib/trainer").PracticeSettings,
                        startedAt: session.row.started_at,
                    };
                }
                batches.push({
                    checkoutId,
                    packageId: batch[0].packageId,
                    packageRevision: revision,
                    clientSession,
                    operations: batch,
                });
            }
            return batches;
        });
    }

    /** Mark a batch in flight, so a second tab does not resend it. */
    async markSyncing(userId: UUID, operationIds: UUID[]): Promise<void> {
        await this.#setOperationState(userId, operationIds, "syncing");
    }

    async markPending(userId: UUID, operationIds: UUID[]): Promise<void> {
        await this.#setOperationState(userId, operationIds, "pending");
    }

    /** Mark a batch failed. It stays put and requires an explicit retry. */
    async markFailed(userId: UUID, operationIds: UUID[]): Promise<void> {
        await this.#setOperationState(userId, operationIds, "failed");
    }

    async #setOperationState(
        userId: UUID,
        operationIds: UUID[],
        state: OfflineOperationV1["state"],
    ): Promise<void> {
        const wanted = new Set(operationIds);
        await this.#storage.transaction(
            [STORE.meta, STORE.outbox],
            "readwrite",
            async (tx) => {
                await this.#requireActiveUser(tx, userId);
                const all = await tx.getAll<OfflineOperationV1>(STORE.outbox, {
                    index: "byUser",
                    only: [userId],
                });
                for (const operation of all) {
                    if (!wanted.has(operation.id)) continue;
                    await tx.put(STORE.outbox, { ...operation, state });
                }
            },
        );
    }

    /**
     * Apply an authoritative sync response: write the server's state as the new
     * frozen base, remove **only** acknowledged operations and their local
     * submissions, and rebuild the overlay by dropping what they contributed.
     *
     * An error is never an acknowledgement, and an unacknowledged operation is
     * never removed — which is what makes a retry of an interrupted batch safe.
     */
    async acknowledgeSync(result: OfflineSyncResponseV1): Promise<void> {
        const acknowledged = new Set(result.acknowledgedOperationIds);

        await this.#storage.transaction(
            [STORE.meta, STORE.packages, STORE.sessions, STORE.localSubmissions,
             STORE.outbox, STORE.organizationOverrides, STORE.personalState,
             STORE.ratings],
            "readwrite",
            async (tx) => {
                const userId = await this.#activeUser(tx);

                for (const state of result.authoritative.personalStates) {
                    if (state.userId !== userId) {
                        throw new OfflineUserMismatch(userId, state.userId);
                    }
                    await tx.put(
                        STORE.personalState,
                        personalStateRecord(userId, state),
                    );
                }
                for (const rating of result.authoritative.problemRatings) {
                    await tx.put(STORE.ratings, {
                        userId,
                        canonicalId: rating.canonicalId,
                        rating: rating.rating,
                        rd: rating.rd,
                        attempts: rating.attempts,
                    } satisfies RatingRecord);
                }

                const submissions = await tx.getAll<LocalSubmissionV1>(
                    STORE.localSubmissions,
                    { index: "byUser", only: [userId] },
                );

                const serverSessionId = result.authoritative.session.id;
                let session: SessionRecord | undefined;
                if (result.clientSessionId) {
                    session = (await tx.getAll<SessionRecord>(STORE.sessions, {
                        index: "byUser",
                        only: [userId],
                    })).find((record) => record.clientSessionId === result.clientSessionId);
                } else {
                    session = await tx.get<SessionRecord>(STORE.sessions, [
                        userId,
                        serverSessionId,
                    ]);
                }
                if (session) {
                    const pending = submissions.filter(
                        (submission) =>
                            submission.sessionId === session.sessionId &&
                            !acknowledged.has(submission.operationId),
                    );
                    const authoritative = result.authoritative.session;
                    const lastPending = pending
                        .map((submission) => submission.occurredAt)
                        .sort()
                        .at(-1) ?? null;
                    await tx.put(STORE.sessions, {
                        ...session,
                        serverSessionId,
                        status: result.authoritative.session.status,
                        row: {
                            ...authoritative,
                            id: session.sessionId,
                            user_id: userId,
                            current_problem_id: session.row.current_problem_id,
                            current_elapsed_ms: session.row.current_elapsed_ms,
                            times_seen: authoritative.times_seen + pending.length,
                            times_skipped: authoritative.times_skipped +
                                pending.filter((item) => item.skipped).length,
                            times_reviewed: authoritative.times_reviewed +
                                pending.filter((item) => !item.skipped && item.isCorrect !== null).length,
                            times_correct: authoritative.times_correct +
                                pending.filter((item) => item.isCorrect === true).length,
                            total_time_ms: authoritative.total_time_ms +
                                pending.reduce((sum, item) => sum + item.elapsedMs, 0),
                            last_submission_at: [authoritative.last_submission_at, lastPending]
                                .filter((value): value is string => value != null)
                                .sort()
                                .at(-1) ?? null,
                        },
                        playerRating:
                            result.authoritative.playerRating ?? session.playerRating,
                    });
                }

                const operations = await tx.getAll<OfflineOperationV1>(STORE.outbox, {
                    index: "byUser",
                    only: [userId],
                });
                const clearedPackages = new Set<UUID>();
                for (const operation of operations) {
                    if (!acknowledged.has(operation.id)) continue;
                    await tx.delete(STORE.outbox, [userId, operation.sequence]);
                    clearedPackages.add(operation.packageId);
                }

                for (const submission of submissions) {
                    if (!acknowledged.has(submission.operationId)) continue;
                    await tx.delete(STORE.localSubmissions, [userId, submission.clientKey]);
                }

                const overrides = await tx.getAll<OrganizationOverrideRecord>(
                    STORE.organizationOverrides,
                    { index: "byUser", only: [userId] },
                );
                for (const override of overrides) {
                    if (!acknowledged.has(override.operationId)) continue;
                    await tx.delete(STORE.organizationOverrides, [
                        userId,
                        override.canonicalId,
                        override.axis,
                    ]);
                }

                for (const packageId of clearedPackages) {
                    const record = await tx.get<PackageRecord>(STORE.packages, [
                        userId,
                        packageId,
                    ]);
                    if (record) {
                        await tx.put(STORE.packages, {
                            ...record,
                            lastSyncedAt: result.syncedAt,
                        });
                    }
                }
            },
        );
    }
}

function assertCount(label: string, actual: number, expected: number): void {
    if (actual !== expected) {
        throw new OfflinePackageInconsistent(
            `staged ${actual} ${label} but the package declared ${expected}`,
        );
    }
}

function personalStateRecord(
    userId: UUID,
    state: OfflinePersonalStateV1,
): PersonalStateRecord {
    const progress: ProblemProgress | null = state.progress;
    return {
        userId,
        canonicalId: state.canonicalId,
        progress,
        mastery: progress?.mastery ?? null,
        engagement: progress?.engagement ?? null,
        timesSeen: progress?.times_seen ?? 0,
        scheduleStale: false,
    };
}

function mergePlacements<T extends { placementId: number }>(a: T[], b: T[]): T[] {
    const seen = new Set(a.map((placement) => placement.placementId));
    return [...a, ...b.filter((placement) => !seen.has(placement.placementId))];
}
