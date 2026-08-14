import { describe, expect, test } from "bun:test";
import { downloadFailureMessage, downloadOfflinePackage, type DownloadProgress } from "./download";
import { OfflineNetworkError } from "./network";
import { createMemoryStorage } from "./memory";
import { createMemoryMediaStore } from "./media";
import { OfflineRepository } from "./repository";
import { fixtureUuid } from "./fixtures";
import type { PracticeSessionRow } from "$lib/sessions";

const SESSION = {
    name: "Geometry",
    settings: { topic: ["geometry"], seriesIds: [], seriesScopes: {} },
} as unknown as PracticeSessionRow;

function makeRepository() {
    return new OfflineRepository({
        storage: createMemoryStorage(),
        media: createMemoryMediaStore(),
    });
}

describe("the offline download orchestrator", () => {
    test("claims the local account itself rather than assuming sync ran first", async () => {
        const repository = makeRepository();
        const userId = fixtureUuid("user-a");
        // No `setActiveUser` anywhere: every repository read is gated on the
        // marker, so the download has to establish it before the first one.
        await downloadOfflinePackage({
            repository,
            userId,
            session: SESSION,
        }).catch(() => undefined);
        // The download itself fails here — there is no server — but the claim
        // precedes the first repository read, which is what is under test.
        expect(await repository.getActiveUser()).toBe(userId);
    });

    test("refuses to download into a store another account owns", async () => {
        const repository = makeRepository();
        await repository.claimAccount(fixtureUuid("user-b"), "grace");
        const progress: DownloadProgress[] = [];
        await expect(
            downloadOfflinePackage({
                repository,
                userId: fixtureUuid("user-a"),
                session: SESSION,
                onProgress: (value) => progress.push(value),
            }),
        ).rejects.toThrow(/already holds another account's offline data/);
        expect(progress).toHaveLength(1);
        expect(progress[0].state).toBe("failed");
    });
});

describe("offline download failures", () => {
    test("asks an over-limit scope to be narrowed", () => {
        expect(
            downloadFailureMessage(
                new OfflineNetworkError(413, {
                    version: 1,
                    status: "error",
                    code: "batch_too_large",
                    retryable: false,
                    message: "The offline request could not be applied",
                }),
            ),
        ).toBe(
            "This download exceeds the 10,000-problem package limit. Choose a smaller amount or narrower filters, then try again.",
        );
    });

    test("explains authentication recovery", () => {
        expect(
            downloadFailureMessage(
                new OfflineNetworkError(401, {
                    version: 1,
                    status: "error",
                    code: "auth_required",
                    retryable: false,
                    message: "The offline request could not be applied",
                }),
            ),
        ).toContain("Sign in again");
    });
});
