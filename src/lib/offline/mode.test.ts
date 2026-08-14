import { describe, expect, test } from "bun:test";
import { effectiveReadMode } from "./mode";

describe("effective downloaded-content mode", () => {
    test("manual preference wins over connectivity", () => {
        expect(effectiveReadMode("downloaded-only", "online")).toBe("local");
        expect(effectiveReadMode("downloaded-only", "syncing")).toBe("local");
    });

    test("auto uses local only for a failed connection", () => {
        expect(effectiveReadMode("auto", "online")).toBe("online");
        expect(effectiveReadMode("auto", "offline")).toBe("local");
        expect(effectiveReadMode("auto", "auth-required")).toBe("online");
    });
});
