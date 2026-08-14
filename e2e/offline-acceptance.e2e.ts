import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * The complete v1 acceptance scenario from docs/offline-contracts.md §10.
 *
 * This fixture-backed path deliberately runs through real browser IndexedDB,
 * CacheStorage-facing package installation, page reloads, a closed/reopened
 * page, the shipped trainer UI, parsed HTTP sync responses, and retry identity.
 * Server SQL idempotency is independently covered by pgTAP; here the mocked
 * endpoint remembers committed client keys so losing the first HTTP response
 * reproduces the browser half of that boundary deterministically.
 */

const USER = "00000000-0000-4000-8000-0000000000aa";

declare global {
    interface Window {
        __pcOffline?: {
            open(): Promise<any>;
            fixtures: typeof import("../src/lib/offline/fixtures");
            network: typeof import("../src/lib/offline/network");
            refresh(): Promise<void>;
        };
    }
}

async function openHandle(page: Page) {
    await page.goto("/offline");
    try {
        await page.waitForFunction(() => Boolean(window.__pcOffline), null, {
            timeout: 5_000,
        });
        return true;
    } catch {
        return false;
    }
}

async function serviceWorkerReady(page: Page): Promise<boolean> {
    return page.evaluate(async () => {
        if (!("serviceWorker" in navigator)) return false;
        const ready = navigator.serviceWorker.ready.then(() => true);
        const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000));
        return Promise.race([ready, timeout]);
    });
}

async function answerCurrent(page: Page) {
    await page.waitForFunction(async (userId) => {
        const repository = await window.__pcOffline!.open();
        const manifest = (await repository.listPackages(userId))[0];
        const session = await repository.loadSession(userId, manifest.sessionId);
        return session?.row.current_problem_id != null;
    }, USER);
    const current = await page.evaluate(async (userId) => {
        const repository = await window.__pcOffline!.open();
        const manifest = (await repository.listPackages(userId))[0];
        const session = await repository.loadSession(userId, manifest.sessionId);
        return session?.row.current_problem_id as number | null;
    }, USER);
    expect(current).not.toBeNull();
    if (current === 101) {
        await page.locator("button[aria-pressed]").first().click();
    } else {
        await page.getByLabel("Answer").fill(current === 102 ? "6" : "12");
    }
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Next/ })).toBeVisible();
    return current!;
}

async function reopenPage(context: BrowserContext, packageId: string): Promise<Page> {
    const page = await context.newPage();
    await page.goto(`/practice?offlinePackage=${encodeURIComponent(packageId)}`);
    await page.waitForTimeout(250);
    return page;
}

test("all 14 offline release steps", async ({ page, context }) => {
    test.skip(
        !(await openHandle(page)),
        "the acceptance handle needs dev or a VITE_OFFLINE_E2E=1 test build",
    );

    // 1–2. Sign in locally as the owning fixture account, create the
    // Geometry/AMC package, stage every stable page, and commit atomically.
    const installed = await page.evaluate(async (userId) => {
        const handle = window.__pcOffline!;
        const repository = await handle.open();
        const fixture = await handle.fixtures.buildFixturePackage({
            userId,
            scope: handle.fixtures.GEOMETRY_SCOPE,
            problems: handle.fixtures.geometryFixtureProblems(),
            pageSize: 2,
        });
        await handle.fixtures.installFixturePackage(repository, fixture, userId);
        await repository.setActiveUser(userId, "Acceptance account");
        await handle.refresh();
        return fixture.created;
    }, USER);
    await expect(page.getByText("4 problems")).toBeVisible();
    expect(await serviceWorkerReady(page)).toBe(true);

    // 3. A query narrows to downloaded Geometry but cannot expand to Algebra.
    const coverage = await page.evaluate(async ({ userId, packageId, sessionId }) => {
        const repository = await window.__pcOffline!.open();
        const base = {
            version: 1,
            userId,
            packageIds: [packageId],
            sessionId,
            mode: "new",
            filters: {
                topic: ["G"],
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
            order: { kind: "nearest-rating", seed: "acceptance", ratingCenter: 1200 },
            limit: 10,
        };
        return {
            geometry: (await repository.queryProblems(base)).status,
            algebra: (
                await repository.queryProblems({
                    ...base,
                    filters: { ...base.filters, topic: ["A"] },
                })
            ).status,
        };
    }, { userId: USER, packageId: installed.packageId, sessionId: installed.sessionId });
    expect(coverage).toEqual({ geometry: "ok", algebra: "not_downloaded" });

    // 4. Launch in the normal Practice route, then reload from the neutral,
    // credential-free Practice shell with networking disabled.
    await page.getByRole("button", { name: "Practice offline" }).click();
    await expect(page).toHaveURL(/\/practice\?offlinePackage=/);
    await expect(page.getByText(/Downloaded New mode/)).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    await expect(page).toHaveURL(/\/practice\?offlinePackage=/);
    await expect(page.getByText(/Downloaded New mode/)).toBeVisible();

    // 5–6. Draw adaptively and answer two different local problems.
    const first = await answerCurrent(page);
    await page.getByRole("button", { name: /^Next/ }).click();
    const second = await answerCurrent(page);
    expect(second).not.toBe(first);

    // 6–7. Close/reopen the page (a fresh JS runtime and IDB connection), stay
    // offline, and prove neither answered canonical is offered again.
    await page.close();
    page = await reopenPage(context, installed.packageId);
    await expect(page.getByText(/Downloaded New mode/)).toBeVisible();
    const afterRestart = await page.evaluate(
        async ({ userId, packageId, sessionId, answered }) => {
            const repository = await window.__pcOffline!.open();
            const result = await repository.queryProblems({
                version: 1,
                userId,
                packageIds: [packageId],
                sessionId,
                mode: "new",
                filters: {
                    topic: [], seriesIds: [], seriesScopes: {}, ratingBand: null,
                    verifiedOnly: false, computational: null,
                    answerAvailability: "with", solutionAvailability: "any", mastery: [],
                },
                excludeCanonicalIds: [],
                order: { kind: "nearest-rating", seed: "acceptance", ratingCenter: 1200 },
                limit: 10,
            });
            const pending = await repository.pendingOperations(userId, 100);
            return {
                offered: result.problems.map((item: any) => item.canonicalId),
                pending: pending.length,
                submissions: pending.filter((operation: any) => operation.type === "submission").length,
                answered,
            };
        },
        {
            userId: USER,
            packageId: installed.packageId,
            sessionId: installed.sessionId,
            answered: [first, second],
        },
    );
    expect(afterRestart.submissions).toBe(2);
    expect(afterRestart.pending).toBeGreaterThanOrEqual(2);
    for (const id of afterRestart.answered) expect(afterRestart.offered).not.toContain(id);

    // 8. Install an overlapping package, change mastery once, and observe the
    // shared effective override through the other package immediately.
    const overlap = await page.evaluate(async ({ userId, canonicalId }) => {
        const handle = window.__pcOffline!;
        const repository = await handle.open();
        const fixture = await handle.fixtures.buildFixturePackage({
            userId,
            packageId: handle.fixtures.fixtureUuid("overlap-package"),
            checkoutId: handle.fixtures.fixtureUuid("overlap-checkout"),
            requestId: handle.fixtures.fixtureUuid("overlap-request"),
            packageRevision: handle.fixtures.fixtureUuid("overlap-revision"),
            sessionId: 2,
            scope: handle.fixtures.OVERLAP_SCOPE,
            problems: handle.fixtures.overlappingFixtureProblems(),
        });
        await handle.fixtures.installFixturePackage(repository, fixture, userId);
        const manifests = await repository.listPackages(userId);
        const firstPackage = manifests.find((item: any) => item.sessionId === 1);
        await repository.setMastery({
            userId,
            packageId: firstPackage.packageId,
            checkoutId: firstPackage.checkoutId,
            sessionId: firstPackage.sessionId,
            canonicalId,
            mastery: "confident",
        });
        const observed = await repository.getProblem({
            userId,
            packageIds: [fixture.created.packageId],
            canonicalId,
        });
        return { created: fixture.created, mastery: observed?.progress?.mastery };
    }, { userId: USER, canonicalId: 102 });
    expect(overlap.mastery).toBe("confident");

    // 9. Reconnect with expired authentication. A parsed 401 is surfaced while
    // every operation remains in IndexedDB.
    await context.setOffline(false);
    await page.route("**/api/offline/sync", (route) =>
        route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({
                version: 1,
                status: "error",
                code: "auth_required",
                retryable: false,
                message: "Sign in again",
            }),
        }),
    );
    const authRequired = await page.evaluate(async (userId) => {
        const handle = window.__pcOffline!;
        const repository = await handle.open();
        const before = await repository.pendingOperations(userId, 100);
        const batch = (await repository.pendingSyncBatches(userId, 100))[0];
        let failed = false;
        try {
            await handle.network.sendOfflineSync({
                version: 1,
                deviceId: await repository.getDeviceId(),
                checkoutId: batch.checkoutId,
                packageId: batch.packageId,
                packageRevision: batch.packageRevision,
                operations: batch.operations,
            });
        } catch {
            failed = true;
        }
        return {
            failed,
            before: before.length,
            after: (await repository.pendingOperations(userId, 100)).length,
        };
    }, USER);
    expect(authRequired.failed).toBe(true);
    expect(authRequired.after).toBe(authRequired.before);
    await page.unroute("**/api/offline/sync");

    // 10. Restore the owning account marker and prepare its exact first batch.
    const syncInput = await page.evaluate(async (userId) => {
        const repository = await window.__pcOffline!.open();
        await repository.setActiveUser(userId, "Acceptance account");
        const batch = (await repository.pendingSyncBatches(userId, 100))[0];
        const session = await repository.loadSession(userId, batch.operations[0].sessionId);
        return {
            request: {
                version: 1,
                deviceId: await repository.getDeviceId(),
                checkoutId: batch.checkoutId,
                packageId: batch.packageId,
                packageRevision: batch.packageRevision,
                operations: batch.operations,
            },
            session: session.row,
        };
    }, USER);

    // 11–12. The server commits, the first HTTP response is lost, and the exact
    // same batch retries. Client keys make the simulated server retain exactly
    // two submissions rather than duplicating them.
    const committedSubmissionKeys = new Set<string>();
    let loseResponse = true;
    let attempts = 0;
    await page.route("**/api/offline/sync", async (route) => {
        attempts += 1;
        const request = route.request().postDataJSON();
        const submissionOps = request.operations.filter((op: any) => op.type === "submission");
        for (const op of submissionOps) committedSubmissionKeys.add(op.payload.clientKey);
        if (loseResponse) {
            loseResponse = false;
            await route.abort("connectionreset");
            return;
        }
        const now = "2026-08-14T00:00:00.000Z";
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                version: 1,
                status: "applied",
                checkoutId: request.checkoutId,
                acknowledgedOperationIds: request.operations.map((op: any) => op.id),
                submissions: submissionOps.map((op: any, index: number) => ({
                    clientKey: op.payload.clientKey,
                    submissionId: 9000 + index,
                    createdAt: now,
                    occurredAt: op.occurredAt,
                })),
                overlaps: [],
                authoritative: {
                    session: { ...syncInput.session, current_problem_id: null, current_elapsed_ms: 0 },
                    playerRating: { rating: 1210, rd: 75, matches: 14, last_match_at: now },
                    personalStates: [],
                    problemRatings: [],
                },
                syncedAt: now,
            }),
        });
    });

    const firstLost = await page.evaluate(async (request) => {
        try {
            await window.__pcOffline!.network.sendOfflineSync(request);
            return false;
        } catch {
            return true;
        }
    }, syncInput.request);
    expect(firstLost).toBe(true);

    // A later operation must survive acknowledgement of the retried batch.
    await page.evaluate(async ({ userId, overlap }) => {
        const repository = await window.__pcOffline!.open();
        await repository.setEngagement({
            userId,
            packageId: overlap.packageId,
            checkoutId: overlap.checkoutId,
            sessionId: overlap.sessionId,
            canonicalId: 201,
            engagement: "later",
        });
    }, { userId: USER, overlap: overlap.created });

    const retry = await page.evaluate(async ({ request, userId }) => {
        const handle = window.__pcOffline!;
        const repository = await handle.open();
        const result = await handle.network.sendOfflineSync(request);
        await repository.acknowledgeSync(result);
        return {
            submissions: result.submissions.length,
            pending: (await repository.pendingOperations(userId, 100)).length,
        };
    }, { request: syncInput.request, userId: USER });
    expect(attempts).toBe(2);
    expect(committedSubmissionKeys.size).toBe(2);
    expect(retry.submissions).toBe(2);

    // 13. Only acknowledged operations were removed; the later engagement
    // operation remains queued.
    expect(retry.pending).toBe(1);
    await page.unroute("**/api/offline/sync");

    // 14. Start a staged refresh, fail a later page, abort staging, and prove
    // the previous ready revision still serves its problem.
    const refreshProof = await page.evaluate(async ({ userId, installed }) => {
        const handle = window.__pcOffline!;
        const repository = await handle.open();
        const refresh = await handle.fixtures.buildFixturePackage({
            userId,
            packageId: installed.packageId,
            checkoutId: handle.fixtures.fixtureUuid("failed-refresh-checkout"),
            requestId: handle.fixtures.fixtureUuid("failed-refresh-request"),
            packageRevision: handle.fixtures.fixtureUuid("failed-refresh-revision"),
            sessionId: installed.sessionId,
            scope: handle.fixtures.GEOMETRY_SCOPE,
            problems: handle.fixtures.geometryFixtureProblems(),
            pageSize: 2,
        });
        await repository.beginPackage(refresh.created);
        await repository.stagePackagePage(refresh.pages[0]);
        let failed = false;
        try {
            await repository.stagePackagePage({
                ...refresh.pages[1],
                checksum: "invalid-checksum",
            });
        } catch {
            failed = true;
        }
        await repository.abortStagingPackage(installed.packageId);
        const prior = await repository.getProblem({
            userId,
            packageIds: [installed.packageId],
            canonicalId: 102,
        });
        return { failed, statement: prior?.problem.statement ?? null };
    }, { userId: USER, installed });
    expect(refreshProof.failed).toBe(true);
    expect(refreshProof.statement).toContain("triangle");
});
