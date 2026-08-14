import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import { SYNC_MAX_OPERATIONS } from "./limits";
import { checkoutAction, OfflineNetworkError, sendOfflineSync } from "./network";
import { offlineRepository } from "./browser";
import type { OfflineSyncOverlapV1 } from "./types";

export type OfflineSyncStatus =
    | { state: "idle"; pending: number }
    | { state: "syncing"; pending: number }
    | { state: "auth-required"; pending: number }
    | { state: "owner-mismatch"; pending: number }
    | { state: "retrying"; pending: number; message: string }
    | { state: "failed"; pending: number; message: string }
    | { state: "overlap"; pending: number; overlaps: OfflineSyncOverlapV1[] };

const CHANNEL = "problem-cloud-offline-sync-v1";
const LOCK = "problem-cloud-offline-sync";
const LEASE = "problem-cloud-offline-sync-lease";
const LEASE_MS = 15_000;

let current: OfflineSyncStatus = { state: "idle", pending: 0 };
const listeners = new Set<(status: OfflineSyncStatus) => void>();
let channel: BroadcastChannel | null = null;
let remoteLeaseUntil = 0;

export function offlineSyncStatus() {
    return {
        subscribe(run: (status: OfflineSyncStatus) => void) {
            listeners.add(run);
            run(current);
            return () => listeners.delete(run);
        },
    };
}

function publish(status: OfflineSyncStatus, broadcast = true) {
    current = status;
    for (const listener of listeners) listener(status);
    if (broadcast) channel?.postMessage({ type: "status", status });
}

async function withLease(task: () => Promise<void>): Promise<void> {
    if (navigator.locks) {
        await navigator.locks.request(LOCK, { ifAvailable: true }, async (lock) => {
            if (lock) await task();
        });
        return;
    }
    const now = Date.now();
    if (remoteLeaseUntil > now) return;
    const owner = crypto.randomUUID();
    const prior = JSON.parse(localStorage.getItem(LEASE) ?? "null") as {
        owner?: string;
        expires?: number;
    } | null;
    if (prior?.expires && prior.expires > now) return;
    localStorage.setItem(LEASE, JSON.stringify({ owner, expires: now + LEASE_MS }));
    channel?.postMessage({ type: "lease", owner, expires: now + LEASE_MS });
    const won = JSON.parse(localStorage.getItem(LEASE) ?? "null") as { owner?: string };
    if (won.owner !== owner) return;
    try {
        await task();
    } finally {
        const latest = JSON.parse(localStorage.getItem(LEASE) ?? "null") as { owner?: string };
        if (latest.owner === owner) localStorage.removeItem(LEASE);
    }
}

export function startForegroundOfflineSync(input: {
    userId: string;
    label: string | null;
    supabase: SupabaseClient<Database>;
}): () => void {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    channel ??= typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
    if (channel) channel.onmessage = (event) => {
        const message = event.data as {
            type?: string;
            status?: OfflineSyncStatus;
            expires?: number;
        };
        if (message.type === "status" && message.status) publish(message.status, false);
        if (message.type === "lease" && message.expires) remoteLeaseUntil = message.expires;
    };

    const schedule = (message: string) => {
        if (stopped) return;
        const delay = Math.min(30_000, 1000 * 2 ** attempts++);
        publish({ state: "retrying", pending: current.pending, message });
        retry = setTimeout(() => void sync(), delay);
    };

    // Claiming is unconditional and outside the lease: the marker is what every
    // local read is gated on, so a download must not have to wait for this
    // browser to be online, or for this tab to win the sync lease, to work.
    const claim = async () => {
        if (stopped) return false;
        const repository = await offlineRepository();
        const outcome = await repository.claimAccount(input.userId, input.label);
        if (outcome === "owner-mismatch") {
            publish({ state: "owner-mismatch", pending: 0 });
            return false;
        }
        return true;
    };

    const sync = async () => {
        if (stopped) return;
        if (!(await claim())) return;
        if (!navigator.onLine) return;
        await withLease(async () => {
            const repository = await offlineRepository();
            // A local commit wins before this advisory call. Retrying it at
            // foreground startup recovers a crash/network loss between the two.
            for (const manifest of await repository.listPackages(input.userId)) {
                await checkoutAction(manifest.checkoutId, "ready").catch(() => undefined);
            }
            const batches = await repository.pendingSyncBatches(input.userId, SYNC_MAX_OPERATIONS);
            const pending = batches.reduce((sum, batch) => sum + batch.operations.length, 0);
            if (!pending) {
                attempts = 0;
                publish({ state: "idle", pending: 0 });
                return;
            }
            publish({ state: "syncing", pending });
            for (const batch of batches) {
                const ids = batch.operations.map((operation) => operation.id);
                await repository.markSyncing(input.userId, ids);
                try {
                    const result = await sendOfflineSync({
                        version: 1,
                        deviceId: await repository.getDeviceId(),
                        checkoutId: batch.checkoutId,
                        packageId: batch.packageId,
                        packageRevision: batch.packageRevision,
                        clientSession: batch.clientSession,
                        operations: batch.operations,
                    });
                    await repository.acknowledgeSync(result);
                    if (result.overlaps.length) {
                        publish({ state: "overlap", pending: Math.max(0, pending - ids.length), overlaps: result.overlaps });
                    }
                    // A ready checkout remains the durable provenance boundary
                    // for future local sessions that draw from this package.
                } catch (error) {
                    if (error instanceof OfflineNetworkError && (error.status === 401 || error.detail?.code === "auth_required")) {
                        await repository.markPending(input.userId, ids);
                        publish({ state: "auth-required", pending });
                        return;
                    }
                    if (error instanceof OfflineNetworkError && error.detail && !error.detail.retryable) {
                        await repository.markFailed(input.userId, ids);
                        publish({ state: "failed", pending, message: error.detail.message });
                        return;
                    }
                    await repository.markPending(input.userId, ids);
                    schedule(String(error));
                    return;
                }
            }
            attempts = 0;
            publish({ state: "idle", pending: 0 });
        });
    };

    const online = () => void sync();
    const visible = () => { if (document.visibilityState === "visible") void sync(); };
    window.addEventListener("online", online);
    window.addEventListener("focus", online);
    document.addEventListener("visibilitychange", visible);
    const { data: auth } = input.supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") void sync();
        if (event === "SIGNED_OUT") void offlineRepository().then((repository) => repository.setActiveUser(null));
    });
    void sync();
    return () => {
        stopped = true;
        if (retry) clearTimeout(retry);
        window.removeEventListener("online", online);
        window.removeEventListener("focus", online);
        document.removeEventListener("visibilitychange", visible);
        auth.subscription.unsubscribe();
    };
}
