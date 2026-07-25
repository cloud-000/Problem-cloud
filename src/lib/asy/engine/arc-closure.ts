/**
 * Screen-space arc closure policy shared by construction, baked editing, and
 * smart-feature dragging. Geometry stays in scene units; the caller supplies
 * the active scene-units-per-pixel conversion owned by the Camera.
 */
export const ARC_CLOSURE_ACQUIRE_PIXELS = 10;
export const ARC_CLOSURE_RELEASE_PIXELS = 14;

export interface ArcClosureInput {
    /** Distance between the two semantic rim endpoints, in scene units. */
    endpointGap: number;
    /** Scene-space distance represented by one CSS pixel at the active zoom. */
    sceneUnitsPerPixel: number;
    /** Whether this gesture already acquired the closed state. */
    snapped: boolean;
    /** Alt/Option bypasses inferred snapping. */
    suppressSnap?: boolean;
}

/** Apply one symmetric acquire/release decision to an arc endpoint gap. */
export function arcClosureSnapped(input: ArcClosureInput): boolean {
    if (input.suppressSnap) return false;
    const threshold = (input.snapped
        ? ARC_CLOSURE_RELEASE_PIXELS
        : ARC_CLOSURE_ACQUIRE_PIXELS) * input.sceneUnitsPerPixel;
    return input.endpointGap <= threshold;
}
