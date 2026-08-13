/**
 * Connectivity is a state machine, not a boolean (`docs/offline.md` §3c).
 *
 * `navigator.onLine` is only a hint — it reports whether a network interface
 * exists, not whether this application can be reached, and it is famously true
 * on a captive portal. More importantly, "the network came back" and "the user
 * is authenticated again" are different facts, and conflating them is how an
 * outbox gets flushed into a 401.
 *
 * The one rule that matters here: **do not clear local data because a token
 * refresh failed.** `auth-required` is an auth state, not data loss; every local
 * record survives it and the user is offered sign-in.
 */

export type ConnectivityState =
    /** A recent application request succeeded. */
    | "online"
    /** The browser reports offline, or a connectivity probe failed. */
    | "offline"
    /** Network is back, but the session could not be refreshed. */
    | "auth-required"
    /** Connectivity exists and outbox work is being handled. */
    | "syncing"
    /** A flush failed in a way that will be retried. */
    | "sync-error";

export type ConnectivityEvent =
    | { type: "browser-offline" }
    | { type: "browser-online" }
    | { type: "probe-succeeded" }
    | { type: "probe-failed" }
    | { type: "auth-invalid" }
    | { type: "auth-restored" }
    | { type: "sync-started" }
    | { type: "sync-succeeded" }
    | { type: "sync-failed"; retryable: boolean };

/**
 * The pure transition. Exported separately from the store so the interesting
 * cases — losing the network mid-sync, an auth failure that must not be
 * overwritten by a successful probe — are testable without a browser.
 */
export function nextConnectivity(
    state: ConnectivityState,
    event: ConnectivityEvent,
): ConnectivityState {
    switch (event.type) {
        case "browser-offline":
        case "probe-failed":
            // Losing the network while syncing is not a sync error: nothing was
            // rejected, and the batch is still exactly as retryable as it was.
            return "offline";
        case "auth-invalid":
            return "auth-required";
        case "sync-started":
            return state === "offline" ? "offline" : "syncing";
        case "sync-succeeded":
            return "online";
        case "sync-failed":
            return event.retryable ? "sync-error" : "auth-required";
        case "browser-online":
            // The browser reporting a link is not evidence the app is reachable,
            // and it is certainly not evidence the session is valid again.
            return state === "offline" ? "offline" : state;
        case "probe-succeeded":
            // A reachable server does not resolve an invalid session; only a
            // refreshed session does.
            return state === "auth-required" ? "auth-required" : "online";
        case "auth-restored":
            return "online";
    }
}

/** Whether local work may be flushed in this state. */
export function canFlush(state: ConnectivityState): boolean {
    return state === "online" || state === "sync-error";
}

/** Whether the app should be reading from local storage rather than the network. */
export function isOffline(state: ConnectivityState): boolean {
    return state === "offline";
}
