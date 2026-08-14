import {
    parsePackageCreated,
    parsePackagePage,
    parseSyncResult,
} from "./contracts";
import type {
    OfflinePackageCreateRequestV1,
    OfflinePackageCreatedV1,
    OfflinePackagePageV1,
    OfflineSyncErrorV1,
    OfflineSyncRequestV1,
    OfflineSyncResponseV1,
} from "./types";

export class OfflineNetworkError extends Error {
    constructor(
        readonly status: number,
        readonly detail: OfflineSyncErrorV1 | null,
    ) {
        super(detail?.message ?? `Offline request failed with HTTP ${status}`);
        this.name = "OfflineNetworkError";
    }
}

async function payload(response: Response): Promise<unknown> {
    const value = await response.json().catch(() => null);
    if (!response.ok) {
        let detail: OfflineSyncErrorV1 | null = null;
        try {
            detail = parseSyncResult(value) as OfflineSyncErrorV1;
        } catch {
            // Non-sync endpoints use the same error envelope where possible.
        }
        throw new OfflineNetworkError(response.status, detail);
    }
    return value;
}

export async function createOfflinePackage(
    input: OfflinePackageCreateRequestV1,
    signal?: AbortSignal,
): Promise<OfflinePackageCreatedV1> {
    return parsePackageCreated(
        await payload(
            await fetch("/api/offline/packages", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(input),
                signal,
            }),
        ),
    );
}

export async function fetchOfflinePackagePage(
    checkoutId: string,
    cursor: string,
    signal?: AbortSignal,
): Promise<OfflinePackagePageV1> {
    return parsePackagePage(
        await payload(
            await fetch(
                `/api/offline/packages/${encodeURIComponent(checkoutId)}/pages?cursor=${encodeURIComponent(cursor)}`,
                { signal },
            ),
        ),
    );
}

export async function checkoutAction(
    checkoutId: string,
    action: "ready" | "close" | "abandon",
): Promise<void> {
    await payload(
        await fetch(
            `/api/offline/packages/${encodeURIComponent(checkoutId)}/${action}`,
            { method: "POST" },
        ),
    );
}

export async function sendOfflineSync(
    input: OfflineSyncRequestV1,
): Promise<OfflineSyncResponseV1> {
    const result = parseSyncResult(
        await payload(
            await fetch("/api/offline/sync", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(input),
            }),
        ),
    );
    if (result.status === "error") throw new OfflineNetworkError(400, result);
    return result;
}
