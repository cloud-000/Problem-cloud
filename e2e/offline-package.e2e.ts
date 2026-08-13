import { expect, test, type Page } from "@playwright/test";

/**
 * The package lifecycle against **real** IndexedDB.
 *
 * `bun test` proves the repository's logic against the memory backend; nothing
 * there can prove that the same code survives a versioned IndexedDB upgrade, a
 * page reload, or a browser restart. That is what this covers: install, query,
 * write, reload, and confirm neither answered problem is offered again.
 *
 * It drives the repository through the dev-only handle the `/offline` page
 * exposes (see its `onMount`), so it runs against `bun run dev` and skips
 * elsewhere. Nothing here talks to Supabase: package creation and sync
 * endpoints do not exist yet, so the download is a fixture built by the same
 * checksum code the installer verifies with.
 */

const USER = "00000000-0000-4000-8000-0000000000aa";

type OfflineHandle = {
    open: () => Promise<{
        setActiveUser(userId: string, label?: string | null): Promise<void>;
        listPackages(userId: string): Promise<{ packageId: string; problemCount: number }[]>;
        queryProblems(query: unknown): Promise<{ status: string; problems: { canonicalId: number }[] }>;
        recordSubmission(input: unknown): Promise<{ clientKey: string }>;
        pendingOperations(userId: string, limit: number): Promise<{ id: string }[]>;
    }>;
    fixtures: typeof import("../src/lib/offline/fixtures");
    refresh: () => Promise<void>;
};

declare global {
    interface Window {
        __pcOffline?: OfflineHandle;
    }
}

async function hasHandle(page: Page): Promise<boolean> {
    await page.waitForTimeout(250);
    return page.evaluate(() => Boolean(window.__pcOffline));
}

async function openOffline(page: Page): Promise<void> {
    await page.goto("/offline");
}

const newQuery = (userId: string) => ({
    version: 1,
    userId,
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
    order: { kind: "seeded-random", seed: "e2e", ratingCenter: null },
    limit: 10,
});

test.describe("a downloaded package in a real browser", () => {
    test("installs, answers, survives a reload, and never repeats a problem", async ({
        page,
    }) => {
        await openOffline(page);
        test.skip(!(await hasHandle(page)), "the offline test handle needs `bun run dev`");

        // 1–2: create and install the package, page by page, then commit.
        const installed = await page.evaluate(async (userId) => {
            const handle = window.__pcOffline!;
            const repository = await handle.open();
            const fixture = await handle.fixtures.buildFixturePackage({
                userId,
                scope: handle.fixtures.GEOMETRY_SCOPE,
                problems: handle.fixtures.geometryFixtureProblems(),
                pageSize: 2,
            });
            await handle.fixtures.installFixturePackage(
                repository as never,
                fixture,
                userId,
            );
            return {
                packageId: fixture.created.packageId,
                checkoutId: fixture.created.checkoutId,
                packages: await repository.listPackages(userId),
            };
        }, USER);
        expect(installed.packages).toHaveLength(1);
        expect(installed.packages[0].problemCount).toBe(4);

        // 3: the query may narrow the package but cannot expand into Algebra.
        const algebra = await page.evaluate(async (query) => {
            const repository = await window.__pcOffline!.open();
            return repository.queryProblems(query);
        }, { ...newQuery(USER), filters: { ...newQuery(USER).filters, topic: ["A"] } });
        expect(algebra.status).toBe("not_downloaded");

        // 5–6: answer two problems.
        const answered = await page.evaluate(
            async ({ userId, packageId, checkoutId, query }) => {
                const repository = await window.__pcOffline!.open();
                const first = await repository.queryProblems(query);
                const ids = first.problems.slice(0, 2).map((entry) => entry.canonicalId);
                for (const canonicalId of ids) {
                    await repository.recordSubmission({
                        userId,
                        packageId,
                        checkoutId,
                        sessionId: 1,
                        canonicalId,
                        selectedChoice: 0,
                        answer: null,
                        isCorrect: true,
                        skipped: false,
                        flagged: false,
                        elapsedMs: 1234,
                        triesUsed: 1,
                    });
                }
                return ids;
            },
            {
                userId: USER,
                packageId: installed.packageId,
                checkoutId: installed.checkoutId,
                query: newQuery(USER),
            },
        );
        expect(answered).toHaveLength(2);

        // 6–7: reload (a fresh page, a fresh IndexedDB connection) and confirm
        // neither answered problem is offered again and the work is still queued.
        await page.reload();
        expect(await hasHandle(page)).toBe(true);
        const after = await page.evaluate(
            async ({ userId, query }) => {
                const repository = await window.__pcOffline!.open();
                return {
                    result: await repository.queryProblems(query),
                    pending: (await repository.pendingOperations(userId, 100)).length,
                };
            },
            { userId: USER, query: newQuery(USER) },
        );

        const offered = after.result.problems.map((entry) => entry.canonicalId);
        for (const canonicalId of answered) expect(offered).not.toContain(canonicalId);
        expect(after.pending).toBe(2);
    });

    test("shows the installed package on the offline page", async ({ page }) => {
        await openOffline(page);
        test.skip(!(await hasHandle(page)), "the offline test handle needs `bun run dev`");

        await page.evaluate(async (userId) => {
            const handle = window.__pcOffline!;
            const repository = await handle.open();
            const fixture = await handle.fixtures.buildFixturePackage({
                userId,
                scope: handle.fixtures.GEOMETRY_SCOPE,
                problems: handle.fixtures.geometryFixtureProblems(),
            });
            await handle.fixtures.installFixturePackage(repository as never, fixture, userId);
            await repository.setActiveUser(userId, "Test account");
            await handle.refresh();
        }, USER);

        await expect(page.getByRole("heading", { name: "Downloaded and ready" })).toBeVisible();
        await expect(page.getByText("4 problems")).toBeVisible();
    });
});
