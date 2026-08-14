import type { PracticeSessionRow } from "$lib/sessions";
import type { PracticeSettings } from "$lib/trainer";
import { normalizeScope } from "./contracts";
import {
    DOWNLOAD_DEFAULT_PROBLEMS,
    PACKAGE_MAX_CANONICALS,
    PACKAGE_MAX_TOTAL_BYTES,
} from "./limits";
import {
    createOfflinePackage,
    fetchOfflinePackagePage,
    checkoutAction,
    OfflineNetworkError,
} from "./network";
import type { OfflineRepository } from "./repository";
import type { OfflineScope, UUID } from "./types";
import type { OfflinePackageCreatedV1 } from "./types";

export type DownloadProgress =
    | { state: "estimating" }
    | { state: "fetching-package"; problems: number; totalProblems: number; bytes: number }
    | { state: "ready" }
    | { state: "storage-full"; message: string }
    | { state: "failed"; message: string };

export function scopeFromSettings(settings: PracticeSettings): OfflineScope {
    return normalizeScope({
        topic: settings.topic ?? [],
        seriesIds: settings.seriesIds ?? [],
        seriesScopes: settings.seriesScopes ?? {},
    });
}

export function downloadFailureMessage(error: unknown): string {
    if (error instanceof OfflineNetworkError) {
        switch (error.detail?.code) {
            case "batch_too_large":
                return `This download exceeds the ${PACKAGE_MAX_CANONICALS.toLocaleString()}-problem package limit. Choose a smaller amount or narrower filters, then try again.`;
            case "auth_required":
                return "Your sign-in expired. Sign in again, then retry the download.";
            case "temporary":
                return "Offline data is temporarily unavailable. Check your connection and try again.";
        }
    }
    if (error instanceof DOMException && error.name === "AbortError") {
        return "Download canceled.";
    }
    return error instanceof Error ? error.message : "The offline download failed. Try again.";
}

async function storageRoom(required: number, refreshing: boolean): Promise<{ enough: boolean; persistent: boolean | null }> {
    const storage = navigator.storage;
    const persistent = storage?.persist ? await storage.persist().catch(() => false) : null;
    const estimate = await storage?.estimate?.().catch(() => null);
    if (!estimate?.quota || estimate.usage == null) {
        return { enough: !refreshing && required <= 25 * 1024 * 1024, persistent };
    }
    return {
        enough: estimate.quota - estimate.usage >= required + 20 * 1024 * 1024,
        persistent,
    };
}

export async function downloadOfflinePackage(input: {
    repository: OfflineRepository;
    userId: UUID;
    session: Pick<PracticeSessionRow, "name" | "settings">;
    /** Display name for the local account marker; never a token. */
    label?: string | null;
    packageId?: UUID;
    problemLimit?: number;
    signal?: AbortSignal;
    onProgress?: (progress: DownloadProgress) => void;
    confirm?: (created: OfflinePackageCreatedV1, requiredBytes: number, persistent: boolean | null) => Promise<boolean>;
}): Promise<void> {
    const { repository, userId, session, signal, onProgress } = input;
    // Establish the account marker every store read is gated on, rather than
    // depending on the sync coordinator's first pass having already run.
    if ((await repository.claimAccount(userId, input.label ?? null)) === "owner-mismatch") {
        const message =
            "This browser already holds another account's offline data. Sign in as that account and sync it before downloading here.";
        onProgress?.({ state: "failed", message });
        throw new Error(message);
    }
    const existing = await repository.listPackages(userId);
    const prior = input.packageId
        ? existing.find((entry) => entry.packageId === input.packageId)
        : null;
    const packageId = input.packageId ?? crypto.randomUUID();
    const problemLimit = prior?.problemCount ?? Math.min(
        PACKAGE_MAX_CANONICALS,
        Math.max(1, Math.round(input.problemLimit ?? DOWNLOAD_DEFAULT_PROBLEMS)),
    );
    let created: OfflinePackageCreatedV1 | null = null;
    let committed = false;
    try {
        onProgress?.({ state: "estimating" });
        created = await createOfflinePackage(
            {
                version: 1,
                packageId,
                requestId: crypto.randomUUID(),
                deviceId: await repository.getDeviceId(),
                scope: prior?.scope ?? scopeFromSettings(session.settings as unknown as PracticeSettings),
                problemLimit,
                session: {
                    sessionId: prior?.sessionId ?? null,
                    name: session.name,
                    settings: {
                        ...(session.settings as unknown as PracticeSettings),
                        mode: "new",
                        format: "practice",
                    },
                },
            },
            signal,
        );
        // Third-party media can make the server total unknowable. The repository
        // still counts actual bytes page by page and aborts before the hard limit.
        const required = (created.estimatedBytes.total ?? created.estimatedBytes.json) +
            (prior?.byteCount ?? 0);
        const storage = await storageRoom(required, Boolean(prior));
        if (required > PACKAGE_MAX_TOTAL_BYTES || !storage.enough) {
            await checkoutAction(created.checkoutId, "abandon").catch(() => undefined);
            onProgress?.({ state: "storage-full", message: "There is not enough reliable storage for this download and its safety copy." });
            return;
        }
        if (input.confirm && !(await input.confirm(created, required, storage.persistent))) {
            await checkoutAction(created.checkoutId, "abandon").catch(() => undefined);
            return;
        }

        await repository.beginPackage(created);
        let cursor: string | null = created.firstCursor;
        let problems = 0;
        let bytes = 0;
        while (cursor !== null) {
            if (signal?.aborted) throw signal.reason;
            const page = await fetchOfflinePackagePage(created.checkoutId, cursor, signal);
            await repository.stagePackagePage(page);
            problems += page.counts.problems;
            bytes += new TextEncoder().encode(JSON.stringify(page.records)).byteLength;
            onProgress?.({ state: "fetching-package", problems, totalProblems: created.problemCount, bytes });
            cursor = page.nextCursor;
        }
        await repository.commitPackage({
            packageId,
            checkoutId: created.checkoutId,
            packageRevision: created.packageRevision,
            expectedProblems: created.problemCount,
            expectedPlacements: created.placementCount,
            expectedAssets: created.assetCount,
        });
        committed = true;
        // Local readiness is authoritative for usability. If this advisory call
        // loses the network, foreground startup retries it before syncing.
        await checkoutAction(created.checkoutId, "ready").catch(() => undefined);
        onProgress?.({ state: "ready" });
    } catch (error) {
        if (!committed) {
            await repository.abortStagingPackage(packageId).catch(() => undefined);
            if (created) {
                await checkoutAction(created.checkoutId, "abandon").catch(() => undefined);
            }
        }
        onProgress?.({ state: "failed", message: downloadFailureMessage(error) });
        throw error;
    }
}
