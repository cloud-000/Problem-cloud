/**
 * Durable local ordering (`docs/offline.md` §7a).
 *
 * `performance.now()` alone is not durable: it resets across reloads, browser
 * restarts, and tabs. So every local event carries three things — a monotonic
 * outbox `sequence` allocated in IndexedDB (the repository owns that), a
 * `runtimeId` plus an offset within that runtime, and device wall time for
 * display.
 *
 * Only the sequence orders anything. Wall time is for the user's eyes and is
 * clamped server-side to the interval from the checkout's issued
 * `downloaded_at` through the sync receipt, because a manual clock change can
 * move it arbitrarily and a timezone change cannot (Unix time is Unix time).
 */

export type LocalEventStamp = {
    runtimeId: string;
    /** Milliseconds since this runtime started. Exact only within one runtime. */
    monotonicOffsetMs: number;
    /** Device wall time, for display and audit. Never for ordering. */
    occurredAt: string;
};

function randomUUID(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    throw new Error("crypto.randomUUID() is unavailable");
}

/** One runtime segment: a page load in one tab. */
export class OfflineClock {
    readonly runtimeId: string;
    readonly #origin: number;

    constructor(runtimeId = randomUUID(), origin = OfflineClock.monotonicNow()) {
        this.runtimeId = runtimeId;
        this.#origin = origin;
    }

    static monotonicNow(): number {
        return typeof performance !== "undefined" ? performance.now() : Date.now();
    }

    stamp(now = new Date()): LocalEventStamp {
        return {
            runtimeId: this.runtimeId,
            monotonicOffsetMs: Math.max(0, OfflineClock.monotonicNow() - this.#origin),
            occurredAt: now.toISOString(),
        };
    }
}

/** The clock for this page load. A new one per runtime is the whole point. */
export const offlineClock = new OfflineClock();

export { randomUUID as newUUID };
