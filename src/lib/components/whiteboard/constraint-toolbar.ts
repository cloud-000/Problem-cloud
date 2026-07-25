import type { Pair } from "$lib/asy/scene";
import type { FeatureRef, WhiteboardDocument } from "$lib/whiteboard/model";

export type ToolbarPosition = { left: number; top: number };
export type ToolbarSide = "top" | "bottom" | "right" | "left";

export interface ToolbarGeometry {
    points: Pair[];
    segments: Array<{ a: Pair; b: Pair }>;
    arcs: Array<{ anchors: Pair[] }>;
}

export interface ToolbarPlacement {
    position: ToolbarPosition;
    side: ToolbarSide;
}

const TOOLBAR_GAP = 16;
const HANDLE_CLEARANCE = 40;
const DESKTOP_MIN_WIDTH = 640;
const SIDES: readonly ToolbarSide[] = ["top", "bottom", "right", "left"];

/**
 * Where the toolbar sits with no user offset. Four positions surround the
 * selected geometry and are scored for clipping, endpoint clearance, and the
 * orientation of a single selected segment. Screen-space — `geometry` is
 * already projected, since projection is the view's job.
 *
 * Deliberately independent of the user's drag offset. That offset is applied
 * downstream (see `constraint-toolbar.svelte`), so the drag handler can read
 * this placement without reading the position it is about to change.
 */
export function autoToolbarPlacement(
    geometry: ToolbarGeometry,
    board: { width: number; height: number },
    toolbar: { width: number; height: number },
    preferredSide: ToolbarSide | null = null,
): ToolbarPlacement | null {
    const anchors = [
        ...geometry.points,
        ...geometry.segments.flatMap(({ a, b }) => [a, b]),
        ...geometry.arcs.flatMap(({ anchors: arcAnchors }) => arcAnchors),
    ];
    if (anchors.length === 0) return null;
    if (board.width < DESKTOP_MIN_WIDTH) {
        return {
            position: clampToolbarPosition(
                { left: board.width / 2, top: board.height - toolbar.height - 8 },
                board,
                toolbar,
            ),
            side: "bottom",
        };
    }
    const xs = anchors.map(([x]) => x);
    const ys = anchors.map(([, y]) => y);
    const bounds = {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
    };
    const center = {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
    };

    const candidates: Record<ToolbarSide, ToolbarPosition> = {
        top: {
            left: center.x,
            top: bounds.minY - TOOLBAR_GAP - toolbar.height,
        },
        bottom: {
            left: center.x,
            top: bounds.maxY + TOOLBAR_GAP,
        },
        right: {
            left: bounds.maxX + TOOLBAR_GAP + toolbar.width / 2,
            top: center.y - toolbar.height / 2,
        },
        left: {
            left: bounds.minX - TOOLBAR_GAP - toolbar.width / 2,
            top: center.y - toolbar.height / 2,
        },
    };

    if (preferredSide) {
        const preferred = candidates[preferredSide];
        const clamped = clampToolbarPosition(preferred, board, toolbar);
        if (
            Math.abs(clamped.left - preferred.left) < 0.5 &&
            Math.abs(clamped.top - preferred.top) < 0.5
        ) {
            return { position: clamped, side: preferredSide };
        }
    }

    const singleSegment = geometry.segments.length === 1 &&
        geometry.points.length === 0 &&
        geometry.arcs.length === 0
        ? geometry.segments[0]
        : null;
    const segmentLength = singleSegment
        ? Math.hypot(singleSegment.b[0] - singleSegment.a[0], singleSegment.b[1] - singleSegment.a[1])
        : 0;

    let best: { placement: ToolbarPlacement; score: number } | null = null;
    for (const side of SIDES) {
        const raw = candidates[side];
        const clamped = clampToolbarPosition(raw, board, toolbar);
        const clampDistance = Math.hypot(clamped.left - raw.left, clamped.top - raw.top);
        const rect = {
            left: clamped.left - toolbar.width / 2,
            right: clamped.left + toolbar.width / 2,
            top: clamped.top,
            bottom: clamped.top + toolbar.height,
        };

        let score = clampDistance * 10_000;
        for (const anchor of anchors) {
            const dx = Math.max(rect.left - anchor[0], 0, anchor[0] - rect.right);
            const dy = Math.max(rect.top - anchor[1], 0, anchor[1] - rect.bottom);
            const distance = Math.hypot(dx, dy);
            if (distance < HANDLE_CLEARANCE) {
                score += (HANDLE_CLEARANCE - distance) ** 2 * 10;
            }
        }

        if (singleSegment && segmentLength > 1e-6) {
            const tangent: Pair = [
                (singleSegment.b[0] - singleSegment.a[0]) / segmentLength,
                (singleSegment.b[1] - singleSegment.a[1]) / segmentLength,
            ];
            const sideVector: Pair =
                side === "top" ? [0, -1]
                    : side === "bottom" ? [0, 1]
                        : side === "right" ? [1, 0]
                            : [-1, 0];
            // A toolbar beside the line's midpoint is least obstructive when
            // its side vector is normal to the line.
            score += Math.abs(tangent[0] * sideVector[0] + tangent[1] * sideVector[1]) * 4_000;
        }
        if (!best || score < best.score) {
            best = { placement: { position: clamped, side }, score };
        }
    }

    return best?.placement ?? null;
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
    selectedFeatureGeometry: {
        points: readonly unknown[];
        segments: readonly unknown[];
        arcs: readonly unknown[];
    };
}): boolean {
    return store.toolKind === "select" &&
        store.featureSelection.length > 0 &&
        (store.selectedFeatureGeometry.points.length > 0 ||
            store.selectedFeatureGeometry.segments.length > 0 ||
            store.selectedFeatureGeometry.arcs.length > 0);
}

/** Short next-step guidance for a single compatible curve feature. */
export function constraintToolbarGuidance(
    document: WhiteboardDocument,
    selection: readonly FeatureRef[],
): string | null {
    if (selection.length !== 1 || selection[0].kind !== "curve") return null;
    const curve = document.sketch.curves[selection[0].curveId];
    if (curve?.kind === "arc") return "Shift-click a smart line to make it tangent";
    if (curve?.kind === "segment") return "Shift-click another smart line to compare segments";
    return null;
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
