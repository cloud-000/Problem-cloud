import { beforeEach, describe, expect, test } from "bun:test";
import { createMemoryStorage } from "./memory";
import { createMemoryMediaStore } from "./media";
import {
    OfflinePackageInconsistent,
    OfflineRepository,
    OfflineUserMismatch,
} from "./repository";
import {
    GEOMETRY_SCOPE,
    OVERLAP_SCOPE,
    buildFixturePackage,
    fixtureUuid,
    geometryFixtureProblems,
    installFixturePackage,
    overlappingFixtureProblems,
    type FixturePackage,
} from "./fixtures";
import { STORE } from "./schema";
import type { PracticeQueryV1, OfflineSyncResponseV1 } from "./types";

const USER = fixtureUuid("user-a");
const OTHER_USER = fixtureUuid("user-b");

let storage: ReturnType<typeof createMemoryStorage>;
let repository: OfflineRepository;
let ids = 0;

function makeRepository() {
    storage = createMemoryStorage();
    ids = 0;
    return new OfflineRepository({
        storage,
        media: createMemoryMediaStore(),
        now: () => new Date("2026-08-13T12:00:00.000Z"),
        newId: () => fixtureUuid(`id-${(ids += 1)}`),
    });
}

async function geometryPackage(overrides = {}): Promise<FixturePackage> {
    return buildFixturePackage({
        userId: USER,
        scope: GEOMETRY_SCOPE,
        problems: geometryFixtureProblems(),
        pageSize: 2,
        ...overrides,
    });
}

function newQuery(overrides: Partial<PracticeQueryV1> = {}): PracticeQueryV1 {
    return {
        version: 1,
        userId: USER,
        packageIds: [],
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
        order: { kind: "seeded-random", seed: "s", ratingCenter: null },
        limit: 10,
        ...overrides,
    };
}

beforeEach(() => {
    repository = makeRepository();
});

describe("claiming the local account", () => {
    test("claims an unowned store, and says so only the first time", async () => {
        expect(await repository.claimAccount(USER, "ada")).toBe("claimed");
        expect(await repository.claimAccount(USER)).toBe("current");
        expect(await repository.getAccountMarker()).toEqual({ userId: USER, label: "ada" });
    });

    test("refuses to take a store owned by another account", async () => {
        await repository.claimAccount(OTHER_USER, "grace");
        expect(await repository.claimAccount(USER, "ada")).toBe("owner-mismatch");
        // The resident account may hold unsynced work, so nothing moves.
        expect(await repository.getAccountMarker()).toEqual({
            userId: OTHER_USER,
            label: "grace",
        });
    });

    test("a claim without a label does not erase the one already stored", async () => {
        await repository.claimAccount(USER, "ada");
        await repository.claimAccount(USER, null);
        expect((await repository.getAccountMarker())?.label).toBe("ada");
    });
});

describe("staged installation", () => {
    test("stages across pages and commits one ready package", async () => {
        const fixture = await geometryPackage();
        expect(fixture.pages.length).toBeGreaterThan(1);
        await installFixturePackage(repository, fixture, USER);

        const [manifest] = await repository.listPackages(USER);
        expect(manifest.state).toBe("ready");
        expect(manifest.problemCount).toBe(4);
        expect(manifest.placementCount).toBe(5);
    });

    test("staged data is invisible to queries until commit", async () => {
        const fixture = await geometryPackage();
        await repository.setActiveUser(USER);
        await repository.beginPackage(fixture.created);
        for (const page of fixture.pages) await repository.stagePackagePage(page);

        // Every page is in, but nothing has committed.
        expect(await repository.listPackages(USER)).toEqual([]);
        const result = await repository.queryProblems(
            newQuery({ packageIds: [fixture.created.packageId] }),
        );
        expect(result.status).toBe("package_unavailable");
        if (result.status === "package_unavailable") expect(result.reason).toBe("staging");
        expect(await repository.loadSession(USER, fixture.created.sessionId)).toBeNull();
    });

    test("re-staging the identical page is a no-op, not a duplicate", async () => {
        const fixture = await geometryPackage();
        await repository.setActiveUser(USER);
        await repository.beginPackage(fixture.created);
        await repository.stagePackagePage(fixture.pages[0]);
        await repository.stagePackagePage(fixture.pages[0]);
        await repository.stagePackagePage(fixture.pages[1]);
        await repository.commitPackage({
            packageId: fixture.created.packageId,
            checkoutId: fixture.created.checkoutId,
            packageRevision: fixture.created.packageRevision,
            expectedProblems: fixture.created.problemCount,
            expectedPlacements: fixture.created.placementCount,
            expectedAssets: fixture.created.assetCount,
        });
        const [manifest] = await repository.listPackages(USER);
        expect(manifest.problemCount).toBe(4);
    });

    test("the same page index with different contents fails the package", async () => {
        const fixture = await geometryPackage();
        await repository.setActiveUser(USER);
        await repository.beginPackage(fixture.created);
        await repository.stagePackagePage(fixture.pages[0]);

        const tampered = structuredClone(fixture.pages[0]);
        tampered.records.problems[0].statement = "Something else entirely.";
        // Recomputed elsewhere it would checksum differently; here the checksum
        // is stale, which is the same corruption seen from the other side.
        await expect(repository.stagePackagePage(tampered)).rejects.toThrow(
            OfflinePackageInconsistent,
        );
    });

    test("a page whose checksum does not match its records is refused", async () => {
        const fixture = await geometryPackage();
        await repository.setActiveUser(USER);
        await repository.beginPackage(fixture.created);
        const page = structuredClone(fixture.pages[0]);
        page.records.problems[0].verified = false;
        await expect(repository.stagePackagePage(page)).rejects.toThrow(
            /failed its checksum/,
        );
    });

    test("pages out of order are refused rather than silently reordered", async () => {
        const fixture = await geometryPackage();
        await repository.setActiveUser(USER);
        await repository.beginPackage(fixture.created);
        await expect(repository.stagePackagePage(fixture.pages[1])).rejects.toThrow(
            /expected page 0/,
        );
    });

    test("committing before the last page arrives is refused", async () => {
        const fixture = await geometryPackage();
        await repository.setActiveUser(USER);
        await repository.beginPackage(fixture.created);
        await repository.stagePackagePage(fixture.pages[0]);
        await expect(
            repository.commitPackage({
                packageId: fixture.created.packageId,
                checkoutId: fixture.created.checkoutId,
                packageRevision: fixture.created.packageRevision,
                expectedProblems: fixture.created.problemCount,
                expectedPlacements: fixture.created.placementCount,
                expectedAssets: fixture.created.assetCount,
            }),
        ).rejects.toThrow(/final page/);
    });

    test("a failed refresh leaves the previous ready revision working", async () => {
        const fixture = await geometryPackage();
        await installFixturePackage(repository, fixture, USER);

        const refresh = await buildFixturePackage({
            userId: USER,
            scope: GEOMETRY_SCOPE,
            problems: geometryFixtureProblems().slice(0, 2),
            pageSize: 1,
            packageId: fixture.created.packageId,
            packageRevision: fixtureUuid("revision-2"),
            checkoutId: fixtureUuid("checkout-2"),
        });
        refresh.created.baseState.playerRating = {
            rating: 1999,
            rd: 40,
            matches: 99,
            last_match_at: refresh.created.downloadedAt,
        };
        await repository.beginPackage(refresh.created);
        await repository.stagePackagePage(refresh.pages[0]);
        // The second page never arrives; the download is abandoned.
        await repository.abortStagingPackage(refresh.created.packageId);

        const [manifest] = await repository.listPackages(USER);
        expect(manifest.packageRevision).toBe(fixture.created.packageRevision);
        expect(manifest.problemCount).toBe(4);
        expect((await repository.getPlayerRating(USER, manifest.sessionId))?.rating).toBe(1200);
        const result = await repository.queryProblems(newQuery());
        expect(result.status).toBe("ok");
    });

    test("a committed refresh replaces the revision and drops the old rows", async () => {
        const fixture = await geometryPackage();
        await installFixturePackage(repository, fixture, USER);

        const refresh = await buildFixturePackage({
            userId: USER,
            scope: GEOMETRY_SCOPE,
            problems: geometryFixtureProblems().slice(0, 2),
            packageId: fixture.created.packageId,
            packageRevision: fixtureUuid("revision-2"),
            checkoutId: fixtureUuid("checkout-2"),
        });
        await installFixturePackage(repository, refresh, USER);

        const [manifest] = await repository.listPackages(USER);
        expect(manifest.packageRevision).toBe(refresh.created.packageRevision);
        const memberships = storage.dump<{ packageRevision: string }>(
            STORE.packageMembership,
        );
        expect(
            memberships.every(
                (row) => row.packageRevision === refresh.created.packageRevision,
            ),
        ).toBe(true);
    });
});

describe("the active offline user", () => {
    test("another account cannot read this account's packages", async () => {
        await installFixturePackage(repository, await geometryPackage(), USER);
        await repository.setActiveUser(OTHER_USER);
        await expect(repository.listPackages(USER)).rejects.toThrow(OfflineUserMismatch);
        // Signing into another account hides the prior account's download —
        // it does not delete it.
        expect(storage.dump(STORE.packages)).toHaveLength(1);
    });
});

describe("local queries", () => {
    test("narrow the package, and never expand past it", async () => {
        await installFixturePackage(repository, await geometryPackage(), USER);

        const geometry = await repository.queryProblems(
            newQuery({ filters: { ...newQuery().filters, topic: ["G"] } }),
        );
        expect(geometry.status).toBe("ok");

        const algebra = await repository.queryProblems(
            newQuery({ filters: { ...newQuery().filters, topic: ["A"] } }),
        );
        expect(algebra.status).toBe("not_downloaded");
        if (algebra.status === "not_downloaded") {
            expect(algebra.missing.topic).toEqual(["A"]);
        }
    });

    test("exclude a problem the snapshot already records activity for", async () => {
        await installFixturePackage(repository, await geometryPackage(), USER);
        const result = await repository.queryProblems(newQuery());
        expect(result.status).toBe("ok");
        if (result.status !== "ok") return;
        // 103 was attempted before the download; 104 is unrated but eligible.
        expect(result.problems.map((entry) => entry.canonicalId).sort()).toEqual([
            101, 102, 104,
        ]);
    });

    test("report a package that was never downloaded, rather than guessing", async () => {
        await installFixturePackage(repository, await geometryPackage(), USER);
        const result = await repository.queryProblems(
            newQuery({ packageIds: [fixtureUuid("nope")] }),
        );
        expect(result.status).toBe("package_unavailable");
        if (result.status === "package_unavailable") expect(result.reason).toBe("missing");
    });
});

describe("local writes and the overlay", () => {
    async function ready() {
        const fixture = await geometryPackage();
        await installFixturePackage(repository, fixture, USER);
        return fixture;
    }

    test("a recorded submission immediately removes the problem from New mode", async () => {
        const fixture = await ready();
        await repository.recordSubmission({
            userId: USER,
            packageId: fixture.created.packageId,
            checkoutId: fixture.created.checkoutId,
            sessionId: 1,
            canonicalId: 101,
            selectedChoice: 0,
            answer: null,
            isCorrect: true,
            skipped: false,
            flagged: false,
            elapsedMs: 4200,
            triesUsed: 1,
        });

        const result = await repository.queryProblems(newQuery());
        expect(result.status).toBe("ok");
        if (result.status === "ok") {
            expect(result.problems.map((entry) => entry.canonicalId)).not.toContain(101);
        }

        const problem = await repository.getProblem({
            userId: USER,
            packageIds: [],
            canonicalId: 101,
        });
        expect(problem?.progress).toMatchObject({ times_seen: 1, times_correct: 1 });
        expect(problem?.progressIsProvisional).toBe(true);
    });

    test("a submission writes its history, outbox entry and session counters together", async () => {
        const fixture = await ready();
        const submission = await repository.recordSubmission({
            userId: USER,
            packageId: fixture.created.packageId,
            checkoutId: fixture.created.checkoutId,
            sessionId: 1,
            canonicalId: 101,
            selectedChoice: null,
            answer: "6",
            isCorrect: false,
            skipped: false,
            flagged: false,
            elapsedMs: 1000,
            triesUsed: 2,
        });

        const [operation] = await repository.pendingOperations(USER, 10);
        expect(operation.type).toBe("submission");
        expect(operation.sequence).toBe(submission.sequence);
        if (operation.type === "submission") {
            // Every raw field `recordSubmission` sends online travels with it.
            expect(operation.payload).toMatchObject({
                clientKey: submission.clientKey,
                answer: "6",
                triesUsed: 2,
                source: "practice",
            });
        }

        const session = await repository.loadSession(USER, 1);
        expect(session?.row).toMatchObject({
            times_seen: 1,
            times_reviewed: 1,
            times_correct: 0,
            total_time_ms: 1000,
            current_problem_id: null,
        });
        expect(session?.localSubmissions).toHaveLength(1);
    });

    test("a failed write leaves nothing visible", async () => {
        await ready();
        await expect(
            repository.recordSubmission({
                userId: USER,
                packageId: fixtureUuid("package"),
                checkoutId: fixtureUuid("checkout"),
                sessionId: 999, // no such session
                canonicalId: 101,
                selectedChoice: null,
                answer: null,
                isCorrect: true,
                skipped: false,
                flagged: false,
                elapsedMs: 10,
                triesUsed: 1,
            }),
        ).rejects.toThrow(/Unknown offline session/);

        expect(storage.dump(STORE.localSubmissions)).toHaveLength(0);
        expect(storage.dump(STORE.outbox)).toHaveLength(0);
        // Not even the sequence allocation survived.
        expect(await repository.pendingOperations(USER, 10)).toEqual([]);
    });

    test("an overlapping package observes a local mastery override", async () => {
        const geometry = await ready();
        const overlap = await buildFixturePackage({
            userId: USER,
            scope: OVERLAP_SCOPE,
            problems: overlappingFixtureProblems(),
            packageId: fixtureUuid("package-2"),
            packageRevision: fixtureUuid("revision-2"),
            checkoutId: fixtureUuid("checkout-2"),
            contentRevision: geometry.created.contentRevision,
            sessionId: 2,
        });
        await installFixturePackage(repository, overlap, USER);

        await repository.setMastery({
            userId: USER,
            packageId: geometry.created.packageId,
            checkoutId: geometry.created.checkoutId,
            sessionId: 1,
            canonicalId: 102,
            mastery: "needs_work",
        });

        // Personal state is shared per (user, canonical), so the second package
        // sees it without any cross-package plumbing.
        const throughOverlap = await repository.getProblem({
            userId: USER,
            packageIds: [overlap.created.packageId],
            canonicalId: 102,
        });
        expect(throughOverlap?.progress?.mastery).toBe("needs_work");
    });

    test("repeated mastery changes coalesce into one pending operation", async () => {
        const fixture = await ready();
        for (const mastery of ["learning", "confident", "needs_work"] as const) {
            await repository.setMastery({
                userId: USER,
                packageId: fixture.created.packageId,
                checkoutId: fixture.created.checkoutId,
                sessionId: 1,
                canonicalId: 101,
                mastery,
            });
        }
        const pending = await repository.pendingOperations(USER, 10);
        expect(pending).toHaveLength(1);
        if (pending[0].type === "mastery") {
            expect(pending[0].payload.mastery).toBe("needs_work");
        }
    });
});

describe("the outbox", () => {
    test("keeps the originating revision after a package refresh", async () => {
        const original = await geometryPackage();
        await installFixturePackage(repository, original, USER);
        await repository.recordSubmission({
            userId: USER,
            packageId: original.created.packageId,
            checkoutId: original.created.checkoutId,
            sessionId: 1,
            canonicalId: 101,
            selectedChoice: 0,
            answer: null,
            isCorrect: true,
            skipped: false,
            flagged: false,
            elapsedMs: 10,
            triesUsed: 1,
        });
        const refresh = await geometryPackage({
            packageId: original.created.packageId,
            checkoutId: fixtureUuid("checkout-refresh"),
            packageRevision: fixtureUuid("revision-refresh"),
        });
        await installFixturePackage(repository, refresh, USER);

        const [batch] = await repository.pendingSyncBatches(USER, 10);
        expect(batch.checkoutId).toBe(original.created.checkoutId);
        expect(batch.packageRevision).toBe(original.created.packageRevision);
    });

    test("hands out operations in sequence order and stops at a failure", async () => {
        const fixture = await geometryPackage();
        await installFixturePackage(repository, fixture, USER);

        for (const canonicalId of [101, 102]) {
            await repository.recordSubmission({
                userId: USER,
                packageId: fixture.created.packageId,
                checkoutId: fixture.created.checkoutId,
                sessionId: 1,
                canonicalId,
                selectedChoice: 0,
                answer: null,
                isCorrect: true,
                skipped: false,
                flagged: false,
                elapsedMs: 100,
                triesUsed: 1,
            });
        }
        const all = await repository.pendingOperations(USER, 10);
        expect(all.map((operation) => operation.sequence)).toEqual([1, 2]);

        await repository.markFailed(USER, [all[0].id]);
        // Skipping past a permanent failure would apply later work against a
        // state the server never reached.
        expect(await repository.pendingOperations(USER, 10)).toEqual([]);
    });

    test("acknowledgement removes only what the server confirmed", async () => {
        const fixture = await geometryPackage();
        await installFixturePackage(repository, fixture, USER);
        const first = await repository.recordSubmission({
            userId: USER,
            packageId: fixture.created.packageId,
            checkoutId: fixture.created.checkoutId,
            sessionId: 1,
            canonicalId: 101,
            selectedChoice: 0,
            answer: null,
            isCorrect: true,
            skipped: false,
            flagged: false,
            elapsedMs: 100,
            triesUsed: 1,
        });
        await repository.recordSubmission({
            userId: USER,
            packageId: fixture.created.packageId,
            checkoutId: fixture.created.checkoutId,
            sessionId: 1,
            canonicalId: 102,
            selectedChoice: null,
            answer: "6",
            isCorrect: true,
            skipped: false,
            flagged: false,
            elapsedMs: 100,
            triesUsed: 1,
        });

        const response: OfflineSyncResponseV1 = {
            version: 1,
            status: "applied",
            checkoutId: fixture.created.checkoutId,
            acknowledgedOperationIds: [first.operationId],
            submissions: [
                {
                    clientKey: first.clientKey,
                    submissionId: 9001,
                    createdAt: "2026-08-13T12:00:01.000Z",
                    occurredAt: "2026-08-13T12:00:00.000Z",
                },
            ],
            overlaps: [],
            authoritative: {
                session: { ...fixture.base.session, times_seen: 1, times_correct: 1 },
                playerRating: fixture.base.playerRating,
                personalStates: [
                    {
                        userId: USER,
                        canonicalId: 101,
                        progress: {
                            times_seen: 1,
                            times_correct: 1,
                            times_reviewed: 1,
                            times_skipped: 0,
                            last_correct: true,
                            last_reviewed_at: "2026-08-13T12:00:01.000Z",
                            last_submission_at: "2026-08-13T12:00:01.000Z",
                            next_review_at: "2026-08-20T00:00:00.000Z",
                            solved: true,
                            mastery: null,
                            engagement: null,
                        },
                    },
                ],
                problemRatings: [
                    { canonicalId: 101, rating: 1120, rd: 58, attempts: 41 },
                ],
            },
            syncedAt: "2026-08-13T12:00:02.000Z",
        };
        await repository.acknowledgeSync(response);

        const pending = await repository.pendingOperations(USER, 10);
        expect(pending).toHaveLength(1);
        expect(pending[0].sequence).toBe(2);

        const acknowledged = await repository.getProblem({
            userId: USER,
            packageIds: [],
            canonicalId: 101,
        });
        // Server truth replaced the overlay for 101…
        expect(acknowledged?.progressIsProvisional).toBe(false);
        expect(acknowledged?.progress?.next_review_at).toBe("2026-08-20T00:00:00.000Z");
        expect(acknowledged?.rating?.rating).toBe(1120);

        // …while 102's unacknowledged work is still overlaid and still pending.
        const unacknowledged = await repository.getProblem({
            userId: USER,
            packageIds: [],
            canonicalId: 102,
        });
        expect(unacknowledged?.progressIsProvisional).toBe(true);

        const [manifest] = await repository.listPackages(USER);
        expect(manifest.lastSyncedAt).toBe("2026-08-13T12:00:02.000Z");
        expect(manifest.pendingOperations).toBe(1);
    });
});

describe("package deletion", () => {
    test("refuses while unsynced work belongs to the package", async () => {
        const fixture = await geometryPackage();
        await installFixturePackage(repository, fixture, USER);
        await repository.recordSubmission({
            userId: USER,
            packageId: fixture.created.packageId,
            checkoutId: fixture.created.checkoutId,
            sessionId: 1,
            canonicalId: 101,
            selectedChoice: 0,
            answer: null,
            isCorrect: true,
            skipped: false,
            flagged: false,
            elapsedMs: 100,
            triesUsed: 1,
        });

        await expect(
            repository.deletePackage(fixture.created.packageId),
        ).rejects.toThrow(/unsynced operation/);
        expect(await repository.listPackages(USER)).toHaveLength(1);

        await repository.deletePackage(fixture.created.packageId, {
            discardPending: true,
        });
        expect(await repository.listPackages(USER)).toEqual([]);
    });
});
