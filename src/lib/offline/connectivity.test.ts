import { describe, expect, test } from "bun:test";
import { canFlush, isOffline, nextConnectivity } from "./connectivity";

describe("connectivity transitions", () => {
    test("a probe failure is offline, whatever the browser claims", () => {
        expect(nextConnectivity("online", { type: "probe-failed" })).toBe("offline");
        // navigator.onLine is a hint about a link, not about reachability.
        expect(nextConnectivity("offline", { type: "browser-online" })).toBe("offline");
        expect(nextConnectivity("offline", { type: "probe-succeeded" })).toBe("online");
    });

    test("a reachable server does not resolve an invalid session", () => {
        expect(nextConnectivity("auth-required", { type: "probe-succeeded" })).toBe(
            "auth-required",
        );
        expect(nextConnectivity("auth-required", { type: "browser-online" })).toBe(
            "auth-required",
        );
        expect(nextConnectivity("auth-required", { type: "auth-restored" })).toBe("online");
    });

    test("losing the network mid-sync is offline, not a sync error", () => {
        expect(nextConnectivity("syncing", { type: "browser-offline" })).toBe("offline");
    });

    test("a non-retryable sync failure asks for sign-in", () => {
        expect(nextConnectivity("syncing", { type: "sync-failed", retryable: true })).toBe(
            "sync-error",
        );
        expect(
            nextConnectivity("syncing", { type: "sync-failed", retryable: false }),
        ).toBe("auth-required");
    });

    test("a flush cannot start while offline", () => {
        expect(nextConnectivity("offline", { type: "sync-started" })).toBe("offline");
        expect(canFlush("offline")).toBe(false);
        expect(canFlush("auth-required")).toBe(false);
        expect(canFlush("online")).toBe(true);
        // A retryable failure is exactly the state a retry is for.
        expect(canFlush("sync-error")).toBe(true);
    });

    test("only `offline` reads from local storage instead of the network", () => {
        expect(isOffline("offline")).toBe(true);
        expect(isOffline("auth-required")).toBe(false);
    });
});
