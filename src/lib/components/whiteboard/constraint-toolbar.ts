import type { Pair } from "$lib/asy/scene";

export type ToolbarPosition = { left: number; top: number };

/** Clearance the toolbar needs above the selection before it sits below it. */
const MIN_HEADROOM = 56;
/** Gap between the selection and the toolbar, above and below respectively. */
const GAP_ABOVE = 44;
const GAP_BELOW = 12;

/**
 * Where the toolbar sits with no user offset: centered over the selection, and
 * above it when there is headroom. Screen-space — `anchors` are already
 * projected, since projection is the view's job.
 *
 * Deliberately a function of the anchors *only*. The user's drag offset is
 * applied downstream (see `constraint-toolbar.svelte`), so the drag handler can
 * read this placement without reading the position it is about to change.
 */
export function autoToolbarPosition(anchors: Pair[]): ToolbarPosition | null {
    if (anchors.length === 0) return null;
    const xs = anchors.map(([x]) => x);
    const ys = anchors.map(([, y]) => y);
    const minY = Math.min(...ys);

    return {
        left: (Math.min(...xs) + Math.max(...xs)) / 2,
        top: minY >= MIN_HEADROOM ? minY - GAP_ABOVE : Math.max(...ys) + GAP_BELOW,
    };
}

/**
 * Whether the contextual constraint toolbar has a selection to anchor to.
 * Mirrors the anchor derivation in `constraint-toolbar.svelte` (no anchor
 * points means no position, so nothing renders); callers that lay out *around*
 * the toolbar share this predicate rather than re-deriving its geometry.
 */
export function hasConstraintToolbarTarget(store: {
    toolKind: string;
    featureSelection: readonly unknown[];
    selectedFeatureGeometry: { points: readonly unknown[]; segments: readonly unknown[] };
}): boolean {
    return store.toolKind === "select" &&
        store.featureSelection.length > 0 &&
        (store.selectedFeatureGeometry.points.length > 0 ||
            store.selectedFeatureGeometry.segments.length > 0);
}

/** Keep a center-positioned floating toolbar fully inside its whiteboard. */
export function clampToolbarPosition(
    position: ToolbarPosition,
    board: { width: number; height: number },
    toolbar: { width: number; height: number },
    margin = 8,
): ToolbarPosition {
    const halfWidth = Math.min(toolbar.width / 2, Math.max(0, board.width / 2 - margin));
    const minLeft = margin + halfWidth;
    const maxLeft = Math.max(minLeft, board.width - margin - halfWidth);
    const minTop = margin;
    const maxTop = Math.max(minTop, board.height - margin - toolbar.height);

    return {
        left: Math.max(minLeft, Math.min(maxLeft, position.left)),
        top: Math.max(minTop, Math.min(maxTop, position.top)),
    };
}
