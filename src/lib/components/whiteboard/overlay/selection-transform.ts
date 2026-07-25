/**
 * Selection-transform projection for the whiteboard overlay.
 *
 * Pure TypeScript sibling of `overlay-model.ts`: no Svelte, no DOM, no runes.
 * `buildSelectionTransform` derives the transform affordances for the current
 * selection — the selection box (axis-aligned `selectionRect` or oriented
 * `selectionQuad`), resize handles, per-node vertex handles, and the rotation
 * control — sharing one set of derivations (`selectionGeometryBounds`,
 * `straightVertexEditablePath`, `hasTransformExtent`, `orientedRectangle`) that
 * feed each other. Assembled by `buildOverlay`, which stays the single overlay
 * assembly point (INVARIANTS §1/§5).
 *
 * `screenRect`/`elementScreenRect` are injected because the label/element rect
 * measurement they close over stays in the assembler.
 */
import {
    elementBounds,
    isStraightPathVertexEditable,
    type Bounds,
    type Pair,
    type PathElement,
    type SceneElement,
} from "$lib/asy/scene";
import type { ScreenRect } from "../render";
import type {
    OverlayInput,
    OverlayResizeHandle,
    OverlayRotationControl,
    OverlayVertexHandle,
    ResizeCursor,
    VertexRef,
} from "../overlay-model";

function isVertex(ref: VertexRef | null, elementId: string, nodeIndex: number): boolean {
    return ref?.elementId === elementId && ref.nodeIndex === nodeIndex;
}

/**
 * The four corners (in node order) of a rectangle path, or `null` if the path
 * is not a rectangle: exactly four nodes with a right angle at every corner.
 * Orientation is free — this is what lets a rotated rectangle be recognized.
 */
function rectangleCorners(nodes: readonly Pair[]): [Pair, Pair, Pair, Pair] | null {
    if (nodes.length !== 4) return null;
    for (let index = 0; index < 4; index++) {
        const previous = nodes[(index + 3) % 4];
        const current = nodes[index];
        const next = nodes[(index + 1) % 4];
        const inX = current[0] - previous[0];
        const inY = current[1] - previous[1];
        const outX = next[0] - current[0];
        const outY = next[1] - current[1];
        const inLength = Math.hypot(inX, inY);
        const outLength = Math.hypot(outX, outY);
        if (inLength < 1e-9 || outLength < 1e-9) return null;
        if (Math.abs((inX * outX + inY * outY) / (inLength * outLength)) > 1e-3) return null;
    }
    return [nodes[0], nodes[1], nodes[2], nodes[3]];
}

/** True when an edge direction sits within ~0.5° of an axis (OBB ≡ AABB). */
function isAxisAlignedEdge(from: Pair, to: Pair): boolean {
    const degrees = Math.abs((Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI) % 90;
    return degrees < 0.5 || degrees > 89.5;
}

/**
 * Inflate a screen-space rectangle outward by `pad` pixels along its own two
 * perpendicular edge directions, so the selection box clears the ink evenly at
 * any orientation. Corners are in order c0→c1→c2→c3 (c2 opposite c0).
 */
function inflateScreenRectangle(
    corners: [Pair, Pair, Pair, Pair],
    pad: number,
): [Pair, Pair, Pair, Pair] {
    const uX = corners[1][0] - corners[0][0];
    const uY = corners[1][1] - corners[0][1];
    const vX = corners[3][0] - corners[0][0];
    const vY = corners[3][1] - corners[0][1];
    const uLength = Math.hypot(uX, uY) || 1;
    const vLength = Math.hypot(vX, vY) || 1;
    const uxN = uX / uLength;
    const uyN = uY / uLength;
    const vxN = vX / vLength;
    const vyN = vY / vLength;
    const signs: ReadonlyArray<readonly [number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    return signs.map(([su, sv], index) => [
        corners[index][0] + (su * uxN + sv * vxN) * pad,
        corners[index][1] + (su * uyN + sv * vyN) * pad,
    ] as Pair) as [Pair, Pair, Pair, Pair];
}

/**
 * The selected vertex, but only while it still points at an existing node of
 * `path`. Exported because the component keeps the selected-vertex state and
 * needs the same validity rule for delete/hover.
 */
export function activeSelectedVertexOf(
    path: PathElement | null,
    selectedVertex: VertexRef | null,
): VertexRef | null {
    return selectedVertex &&
        path?.id === selectedVertex.elementId &&
        selectedVertex.nodeIndex >= 0 &&
        selectedVertex.nodeIndex < path.path.nodes.length
        ? selectedVertex
        : null;
}

export interface SelectionTransformInput {
    input: OverlayInput;
    /** The preview-or-real selection resolved by `buildOverlay`. */
    activeSelection: readonly string[];
    selectedIds: ReadonlySet<string>;
    selectionIsPreview: boolean;
    project: (point: Pair) => Pair;
    /** Injected from the assembler (closes over the retained rect measurement). */
    screenRect: (bounds: Bounds, padding?: number) => ScreenRect;
    elementScreenRect: (element: SceneElement, padding?: number) => ScreenRect | null;
}

export interface SelectionTransform {
    selectionGeometryBounds: Bounds | null;
    straightVertexEditablePath: PathElement | null;
    selectionRect: ScreenRect | null;
    /**
     * Screen-space corners of a single selected rotated smart rectangle's
     * oriented selection box, or `null` when the axis-aligned `selectionRect`
     * is used instead.
     */
    selectionQuad: [Pair, Pair, Pair, Pair] | null;
    resizeHandles: OverlayResizeHandle[];
    vertexHandles: OverlayVertexHandle[];
    rotationControl: OverlayRotationControl | null;
}

/**
 * Derive the whole transform-affordance family for the current selection. The
 * shared derivations feed each other, so they are computed once here and the
 * family returned as one struct.
 */
export function buildSelectionTransform(params: SelectionTransformInput): SelectionTransform {
    const {
        input,
        activeSelection,
        selectedIds,
        selectionIsPreview,
        project,
        screenRect,
        elementScreenRect,
    } = params;
    const resizeCursor = (
        handle: Pair,
        anchor: Pair,
        corner: boolean,
    ): ResizeCursor => {
        const from = project(anchor);
        const to = project(handle);
        const dx = to[0] - from[0];
        const dy = to[1] - from[1];
        if (!corner) return Math.abs(dx) >= Math.abs(dy) ? "ew-resize" : "ns-resize";
        return dx * dy >= 0 ? "nwse-resize" : "nesw-resize";
    };

    const selectionGeometryBounds = ((): Bounds | null => {
        if (activeSelection.length === 0) return null;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const element of input.displayScene.elements) {
            if (!selectedIds.has(element.id)) continue;
            const bounds = elementBounds(element);
            if (!bounds) continue;
            minX = Math.min(minX, bounds.min[0]);
            minY = Math.min(minY, bounds.min[1]);
            maxX = Math.max(maxX, bounds.max[0]);
            maxY = Math.max(maxY, bounds.max[1]);
        }
        return Number.isFinite(minX) ? { min: [minX, minY], max: [maxX, maxY] } : null;
    })();

    /** Only all-straight paths expose per-node handles; ink stays whole-object-only. */
    const straightVertexEditablePath = ((): PathElement | null => {
        if (activeSelection.length !== 1) return null;
        const element = input.displayScene.elements.find(({ id }) => id === activeSelection[0]);
        return element?.kind === "path" && isStraightPathVertexEditable(element.path)
            ? element
            : null;
    })();

    const straightPathHasMultipleSegments =
        (straightVertexEditablePath?.path.joins.length ?? 0) > 1;

    const hasTransformExtent = ((): boolean => {
        if (!selectionGeometryBounds) return false;
        const dx = selectionGeometryBounds.max[0] - selectionGeometryBounds.min[0];
        const dy = selectionGeometryBounds.max[1] - selectionGeometryBounds.min[1];
        return Math.hypot(dx, dy) > 1e-9;
    })();

    /**
     * A single selected, *rotated* smart rectangle whose selection box should
     * hug its orientation. Restricted to smart selections (the rectangle tool's
     * output), whose solver-owned perpendicular relations give local width and
     * height a stable meaning, and skipped when axis-aligned, where the AABB
     * path already produces the identical box.
     */
    const orientedRectangle = ((): {
        cornersAsy: [Pair, Pair, Pair, Pair];
        inflated: [Pair, Pair, Pair, Pair];
    } | null => {
        if (
            activeSelection.length !== 1 ||
            input.selectionPreview !== null ||
            input.toolKind !== "select" ||
            !input.selectionContainsSmartItems ||
            !hasTransformExtent
        ) return null;
        const element = input.displayScene.elements.find(({ id }) => id === activeSelection[0]);
        if (element?.kind !== "path" || !isStraightPathVertexEditable(element.path)) return null;
        const corners = rectangleCorners(element.path.nodes);
        if (!corners || isAxisAlignedEdge(corners[0], corners[1])) return null;
        const screenCorners = [
            project(corners[0]),
            project(corners[1]),
            project(corners[2]),
            project(corners[3]),
        ] as [Pair, Pair, Pair, Pair];
        return { cornersAsy: corners, inflated: inflateScreenRectangle(screenCorners, 6) };
    })();

    const selectionRect = ((): ScreenRect | null => {
        if (activeSelection.length === 0) return null;
        if (
            straightVertexEditablePath &&
            !straightPathHasMultipleSegments &&
            input.selectionPreview === null
        ) return null;
        if (selectionGeometryBounds && hasTransformExtent) {
            return screenRect(selectionGeometryBounds, 6);
        }
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const element of input.displayScene.elements) {
            if (!selectedIds.has(element.id)) continue;
            const rect = elementScreenRect(element, 6);
            if (!rect) continue;
            minX = Math.min(minX, rect.x);
            minY = Math.min(minY, rect.y);
            maxX = Math.max(maxX, rect.x + rect.width);
            maxY = Math.max(maxY, rect.y + rect.height);
        }
        return Number.isFinite(minX)
            ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
            : null;
    })();

    const resizeHandles = ((): OverlayResizeHandle[] => {
        if (
            (straightVertexEditablePath && !straightPathHasMultipleSegments) ||
            !selectionRect ||
            !selectionGeometryBounds ||
            !hasTransformExtent ||
            selectionIsPreview ||
            input.toolKind !== "select"
        ) return [];
        if (orientedRectangle) {
            const cornerPosition = ["nw", "ne", "se", "sw"] as const;
            const [c0, c1, c2, c3] = orientedRectangle.cornersAsy;
            const ux = c1[0] - c0[0];
            const uy = c1[1] - c0[1];
            const vx = c3[0] - c0[0];
            const vy = c3[1] - c0[1];
            const frame = {
                x: [ux / Math.hypot(ux, uy), uy / Math.hypot(ux, uy)] as Pair,
                y: [vx / Math.hypot(vx, vy), vy / Math.hypot(vx, vy)] as Pair,
            };
            const corners = orientedRectangle.cornersAsy.map((corner, index) => ({
                position: cornerPosition[index],
                screen: orientedRectangle.inflated[index],
                handle: corner,
                anchor: orientedRectangle.cornersAsy[(index + 2) % 4],
                axes: { x: true, y: true },
                frame,
                cursor: resizeCursor(corner, orientedRectangle.cornersAsy[(index + 2) % 4], true),
            }));
            const midpoint = (a: Pair, b: Pair): Pair => [
                (a[0] + b[0]) / 2,
                (a[1] + b[1]) / 2,
            ];
            const [s0, s1, s2, s3] = orientedRectangle.inflated;
            return [
                corners[0],
                {
                    position: "n",
                    screen: midpoint(s0, s1),
                    handle: midpoint(c0, c1),
                    anchor: midpoint(c3, c2),
                    axes: { x: false, y: true },
                    frame,
                    cursor: resizeCursor(midpoint(c0, c1), midpoint(c3, c2), false),
                },
                corners[1],
                {
                    position: "e",
                    screen: midpoint(s1, s2),
                    handle: midpoint(c1, c2),
                    anchor: midpoint(c0, c3),
                    axes: { x: true, y: false },
                    frame,
                    cursor: resizeCursor(midpoint(c1, c2), midpoint(c0, c3), false),
                },
                corners[2],
                {
                    position: "s",
                    screen: midpoint(s2, s3),
                    handle: midpoint(c2, c3),
                    anchor: midpoint(c1, c0),
                    axes: { x: false, y: true },
                    frame,
                    cursor: resizeCursor(midpoint(c2, c3), midpoint(c1, c0), false),
                },
                corners[3],
                {
                    position: "w",
                    screen: midpoint(s3, s0),
                    handle: midpoint(c3, c0),
                    anchor: midpoint(c2, c1),
                    axes: { x: true, y: false },
                    frame,
                    cursor: resizeCursor(midpoint(c3, c0), midpoint(c2, c1), false),
                },
            ];
        }
        const { x, y, width: boxWidth, height: boxHeight } = selectionRect;
        const { min, max } = selectionGeometryBounds;
        const midX = (min[0] + max[0]) / 2;
        const midY = (min[1] + max[1]) / 2;
        const canResizeX = max[0] - min[0] > 1e-9;
        const canResizeY = max[1] - min[1] > 1e-9;
        const handles: OverlayResizeHandle[] = [
            {
                position: "nw",
                screen: [x, y],
                handle: [min[0], max[1]],
                anchor: [max[0], min[1]],
                axes: { x: canResizeX, y: canResizeY },
                frame: { x: [1, 0], y: [0, 1] },
                cursor: "nwse-resize",
            },
            {
                position: "ne",
                screen: [x + boxWidth, y],
                handle: [max[0], max[1]],
                anchor: [min[0], min[1]],
                axes: { x: canResizeX, y: canResizeY },
                frame: { x: [1, 0], y: [0, 1] },
                cursor: "nesw-resize",
            },
            {
                position: "se",
                screen: [x + boxWidth, y + boxHeight],
                handle: [max[0], min[1]],
                anchor: [min[0], max[1]],
                axes: { x: canResizeX, y: canResizeY },
                frame: { x: [1, 0], y: [0, 1] },
                cursor: "nwse-resize",
            },
            {
                position: "sw",
                screen: [x, y + boxHeight],
                handle: [min[0], min[1]],
                anchor: [max[0], max[1]],
                axes: { x: canResizeX, y: canResizeY },
                frame: { x: [1, 0], y: [0, 1] },
                cursor: "nesw-resize",
            },
        ];
        if (canResizeY) {
            handles.push(
                {
                    position: "n",
                    screen: [x + boxWidth / 2, y],
                    handle: [midX, max[1]],
                    anchor: [midX, min[1]],
                    axes: { x: false, y: true },
                    frame: { x: [1, 0], y: [0, 1] },
                    cursor: "ns-resize",
                },
                {
                    position: "s",
                    screen: [x + boxWidth / 2, y + boxHeight],
                    handle: [midX, min[1]],
                    anchor: [midX, max[1]],
                    axes: { x: false, y: true },
                    frame: { x: [1, 0], y: [0, 1] },
                    cursor: "ns-resize",
                },
            );
        }
        if (canResizeX) {
            handles.push(
                {
                    position: "e",
                    screen: [x + boxWidth, y + boxHeight / 2],
                    handle: [max[0], midY],
                    anchor: [min[0], midY],
                    axes: { x: true, y: false },
                    frame: { x: [1, 0], y: [0, 1] },
                    cursor: "ew-resize",
                },
                {
                    position: "w",
                    screen: [x, y + boxHeight / 2],
                    handle: [min[0], midY],
                    anchor: [max[0], midY],
                    axes: { x: true, y: false },
                    frame: { x: [1, 0], y: [0, 1] },
                    cursor: "ew-resize",
                },
            );
        }
        return handles;
    })();

    const vertexHandles = ((): OverlayVertexHandle[] => {
        if (
            !straightVertexEditablePath ||
            selectionIsPreview ||
            input.toolKind !== "select"
        ) return [];
        const path = straightVertexEditablePath;
        const activeSelectedVertex = activeSelectedVertexOf(path, input.selectedVertex);
        return path.path.nodes.map((handle, nodeIndex) => ({
            screen: project(handle),
            handle,
            elementId: path.id,
            nodeIndex,
            cursor: "move" as const,
            state: isVertex(activeSelectedVertex, path.id, nodeIndex)
                ? "selected"
                : isVertex(input.hoveredVertex, path.id, nodeIndex)
                  ? "hovered"
                  : "default",
        }));
    })();

    const rotationControl = ((): OverlayRotationControl | null => {
        if (
            (straightVertexEditablePath && !straightPathHasMultipleSegments) ||
            !selectionRect ||
            !selectionGeometryBounds ||
            !hasTransformExtent ||
            selectionIsPreview ||
            input.toolKind !== "select"
        ) return null;
        if (orientedRectangle) {
            const { inflated, cornersAsy } = orientedRectangle;
            const centerX = (inflated[0][0] + inflated[1][0] + inflated[2][0] + inflated[3][0]) / 4;
            const centerY = (inflated[0][1] + inflated[1][1] + inflated[2][1] + inflated[3][1]) / 4;
            // Anchor the stem to the visually topmost edge (smallest screen y).
            let stemStart = inflated[0];
            let bestY = Infinity;
            for (let index = 0; index < 4; index++) {
                const a = inflated[index];
                const b = inflated[(index + 1) % 4];
                const mid: Pair = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
                if (mid[1] < bestY) {
                    bestY = mid[1];
                    stemStart = mid;
                }
            }
            const outX = stemStart[0] - centerX;
            const outY = stemStart[1] - centerY;
            const outLength = Math.hypot(outX, outY) || 1;
            return {
                stemStart,
                screen: [stemStart[0] + (outX / outLength) * 24, stemStart[1] + (outY / outLength) * 24],
                // Diagonal midpoint == the rectangle's true center of rotation.
                pivot: [
                    (cornersAsy[0][0] + cornersAsy[2][0]) / 2,
                    (cornersAsy[0][1] + cornersAsy[2][1]) / 2,
                ],
            };
        }
        return {
            stemStart: [selectionRect.x + selectionRect.width / 2, selectionRect.y],
            screen: [selectionRect.x + selectionRect.width / 2, selectionRect.y - 24],
            pivot: [
                (selectionGeometryBounds.min[0] + selectionGeometryBounds.max[0]) / 2,
                (selectionGeometryBounds.min[1] + selectionGeometryBounds.max[1]) / 2,
            ],
        };
    })();

    return {
        selectionGeometryBounds,
        straightVertexEditablePath,
        selectionRect,
        selectionQuad: orientedRectangle?.inflated ?? null,
        resizeHandles,
        vertexHandles,
        rotationControl,
    };
}
