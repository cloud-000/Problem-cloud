import { describe, expect, test } from "bun:test";
import {
    ARC_CLOSURE_ACQUIRE_PIXELS,
    ARC_CLOSURE_RELEASE_PIXELS,
    arcClosureSnapped,
} from "./arc-closure";

describe("arc closure policy", () => {
    test("acquires at 10px and releases beyond 14px at any zoom", () => {
        for (const sceneUnitsPerPixel of [0.01, 0.025, 0.2]) {
            expect(arcClosureSnapped({
                endpointGap: ARC_CLOSURE_ACQUIRE_PIXELS * sceneUnitsPerPixel,
                sceneUnitsPerPixel,
                snapped: false,
            })).toBe(true);
            expect(arcClosureSnapped({
                endpointGap: (ARC_CLOSURE_ACQUIRE_PIXELS + 0.01) * sceneUnitsPerPixel,
                sceneUnitsPerPixel,
                snapped: false,
            })).toBe(false);
            expect(arcClosureSnapped({
                endpointGap: ARC_CLOSURE_RELEASE_PIXELS * sceneUnitsPerPixel,
                sceneUnitsPerPixel,
                snapped: true,
            })).toBe(true);
            expect(arcClosureSnapped({
                endpointGap: (ARC_CLOSURE_RELEASE_PIXELS + 0.01) * sceneUnitsPerPixel,
                sceneUnitsPerPixel,
                snapped: true,
            })).toBe(false);
        }
    });

    test("snap suppression releases even an acquired closure", () => {
        expect(arcClosureSnapped({
            endpointGap: 0,
            sceneUnitsPerPixel: 0.025,
            snapped: true,
            suppressSnap: true,
        })).toBe(false);
    });
});
