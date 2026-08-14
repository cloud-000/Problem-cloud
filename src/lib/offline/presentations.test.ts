import { describe, expect, test } from "bun:test";
import { OFFLINE_PRESENTATIONS, offlineNavigationAllowed, offlinePresentation } from "./presentations";

describe("offline presentation declaration", () => {
    test("is the allowlist and presentation switch", () => {
        for (const entry of OFFLINE_PRESENTATIONS) {
            expect(offlineNavigationAllowed(entry.path)).toBe(true);
            expect(offlinePresentation(entry.path)).toEqual(entry);
        }
    });

    test("defaults new or private-looking routes to plain recovery", () => {
        expect(offlineNavigationAllowed("/admin")).toBe(false);
        expect(offlinePresentation("/future-route")).toBeNull();
    });
});
