/**
 * Screen-space overlay geometry for the whiteboard.
 *
 * Pure TypeScript: no Svelte, no DOM, no runes. `buildOverlay` takes plain
 * values (the projected Scene, the selection, hover refs, and the viewport's
 * two projection functions) and returns everything the canvas overlay and the
 * DOM overlays need, already in screen pixels.
 *
 * The Document/Scene stay untouched — this module only *reads* the projected
 * Scene (INVARIANTS §0.2) and converts asy-space to pixels via the injected
 * `project` / `toScreenLength`, so screen coordinates never leak downward
 * (INVARIANTS §2).
 */
import {
    elementBounds,
    isStraightPathVertexEditable,
    positiveArcSweep,
    principalEllipseGeometry,
    type ArcElement,
    type Bounds,
    type EllipticalArcElement,
    type Pair,
    type PathElement,
    type Scene,
    type SceneElement,
} from "$lib/asy/scene";
import type { ArcGuide } from "$lib/asy/engine";
import type {
    RenderArcGuide,
    RenderArcHandle,
    RenderResizeHandle,
    RenderRotationControl,
    RenderVertexHandle,
    ScreenRect,
    WhiteboardRenderOverlay,
} from "./render";

export type ResizePosition = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export type ResizeCursor = "nwse-resize" | "nesw-resize" | "ew-resize" | "ns-resize";

export interface VertexRef {
    elementId: string;
    nodeIndex: number;
}

export type ArcControl = "center" | "start" | "end" | "radius" | "focus1" | "focus2";

export interface ArcControlRef {
    elementId: string;
    control: ArcControl;
}

/** A corner/edge handle: the render position plus what a drag of it means. */
export interface OverlayResizeHandle extends RenderResizeHandle {
    position: ResizePosition;
    screen: Pair;
    handle: Pair;
    anchor: Pair;
    axes: { x: boolean; y: boolean };
    cursor: ResizeCursor;
}

export interface OverlayVertexHandle extends RenderVertexHandle {
    screen: Pair;
    handle: Pair;
    elementId: string;
    nodeIndex: number;
    cursor: "move";
    state: "default" | "hovered" | "selected";
}

export interface OverlayArcHandle extends RenderArcHandle {
    handle: Pair;
    elementId: string;
}

export interface OverlayArcGuide extends RenderArcGuide {
    /** Draggable handles; empty while the arc tool is still constructing. */
    editHandles: OverlayArcHandle[];
    /** The arc being edited, or `null` for a construction guide. */
    elementId: string | null;
    radiusEditable: boolean;
}

export interface OverlayRotationControl extends RenderRotationControl {
    /** Rotation pivot in asy-space. */
    pivot: Pair;
}

export interface OverlayDimension {
    id: string;
    a: Pair;
    b: Pair;
    label: Pair;
    text: string;
    mode: "driving" | "reference";
    selected: boolean;
    /** The measured length, for the inline driving-value editor. */
    value: number;
}

/**
 * A `WhiteboardRenderOverlay` (so it can be handed straight to
 * `renderWhiteboard`) widened with the fields hit-testing and the DOM overlays
 * need.
 */
export interface WhiteboardOverlay extends WhiteboardRenderOverlay {
    /**
     * True while *either* kind of preview is in flight, since both must
     * suppress transform affordances. Note this is deliberately broader than
     * the condition behind `previewElementRects`, which highlights only a
     * selection preview — a tool preview draws its own geometry. See
     * `OverlayInput.hasPreview`.
     */
    selectionIsPreview: boolean;
    resizeHandles: OverlayResizeHandle[];
    vertexHandles: OverlayVertexHandle[];
    arcGuide: OverlayArcGuide | null;
    rotationControl: OverlayRotationControl | null;
    constraintGlyphs: Array<{ id: string; screen: Pair; selected: boolean }>;
    dimensions: OverlayDimension[];
    /** Selection bounds in asy-space, used to size resize gestures. */
    selectionGeometryBounds: Bounds | null;
    /** The single all-straight path exposing per-node handles, if any. */
    straightVertexEditablePath: PathElement | null;
    selectedSegmentMarkers: Array<{ label: number; screen: Pair }>;
}

/** Label font size `render.ts` falls back to when a label carries no pen. */
const DEFAULT_LABEL_FONT_SIZE = 14;
/** Narrowest a label's selection box may get, so short labels stay grabbable. */
const MINIMUM_LABEL_WIDTH = 14;

/**
 * Width of a label when no measurer is injected (SSR, tests). A crude
 * per-character average — `measureLabelWidth` exists precisely because this is
 * wrong for anything but plain ASCII at the default size.
 */
export function estimateLabelWidth(text: string, fontSize: number): number {
    return text.length * fontSize * (7.5 / DEFAULT_LABEL_FONT_SIZE);
}

export interface OverlayInput {
    /** The projected Scene, including any in-flight preview.  */
    displayScene: Scene;
    selection: readonly string[];
    selectionPreview: readonly string[] | null;
    /**
     * Whether a *tool* preview is in flight (`store.preview !== null`) — an
     * in-flight drawing that renders itself. Distinct from `selectionPreview`,
     * which is a preview of *which elements would be selected* (marquee hover).
     * Both suppress transform affordances; only the latter draws per-element
     * rects. See `selectionIsPreview` vs `previewElementRects` on the output.
     */
    hasPreview: boolean;
    toolKind: string;
    selectionContainsSmartItems: boolean;
    /** The arc tool's transient construction guide, if any. */
    constructionArcGuide: ArcGuide | null;
    marquee: { start: Pair; end: Pair } | null;
    snapProposal: { from: Pair; to: Pair } | null;
    constraintGlyphs: ReadonlyArray<{ id: string; at: Pair; selected: boolean }>;
    dimensionGlyphs: ReadonlyArray<{
        id: string;
        a: Pair;
        b: Pair;
        at: Pair;
        value: number;
        mode: "driving" | "reference";
        selected: boolean;
    }>;
    selectedFeatureGeometry: {
        points: readonly Pair[];
        segments: ReadonlyArray<{ a: Pair; b: Pair }>;
    };
    selectedVertex: VertexRef | null;
    hoveredVertex: VertexRef | null;
    selectedArcControl: ArcControlRef | null;
    hoveredArcControl: ArcControlRef | null;
    /** asy-space point → screen point. */
    project: (point: Pair) => Pair;
    /** scene-unit distance → screen pixels. */
    toScreenLength: (units: number) => number;
    /**
     * Rendered width of a label's text at `fontSize`, in pixels. Text metrics
     * are a DOM capability, so the view injects this; returning `undefined`
     * (no canvas available) falls back to `estimateLabelWidth`.
     */
    measureLabelWidth?: (text: string, fontSize: number) => number | undefined;
}

function isVertex(ref: VertexRef | null, elementId: string, nodeIndex: number): boolean {
    return ref?.elementId === elementId && ref.nodeIndex === nodeIndex;
}

function isArcControl(
    ref: ArcControlRef | null,
    elementId: string,
    control: ArcControl,
): boolean {
    return ref?.elementId === elementId && ref.control === control;
}

function arcPoint(center: Pair, radius: number, angle: number): Pair {
    const radians = (angle * Math.PI) / 180;
    return [
        center[0] + radius * Math.cos(radians),
        center[1] + radius * Math.sin(radians),
    ];
}

function selectedArcPoint(
    element: ArcElement | EllipticalArcElement,
    angle: number,
): Pair {
    if (element.kind === "arc") return arcPoint(element.center, element.radius, angle);
    const radians = (angle * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return [
        element.center[0] + element.axisX[0] * cos + element.axisY[0] * sin,
        element.center[1] + element.axisX[1] * cos + element.axisY[1] * sin,
    ];
}

function geometryLabel(value: number): string {
    return Number(value.toFixed(2)).toString();
}

export function buildOverlay(input: OverlayInput): WhiteboardOverlay {
    const { project, toScreenLength } = input;

    const activeSelection = input.selectionPreview ?? input.selection;
    const selectedIds = new Set(activeSelection);
    const selectionIsPreview = input.selectionPreview !== null || input.hasPreview;

    function screenRect(bounds: Bounds, padding = 0): ScreenRect {
        const a = project(bounds.min);
        const b = project(bounds.max);
        return {
            x: Math.min(a[0], b[0]) - padding,
            y: Math.min(a[1], b[1]) - padding,
            width: Math.abs(a[0] - b[0]) + padding * 2,
            height: Math.abs(a[1] - b[1]) + padding * 2,
        };
    }

    function elementScreenRect(element: SceneElement, padding = 0): ScreenRect | null {
        if (element.kind === "label") {
            const [x, y] = project(element.at);
            // `render.ts` draws a label as `fillText(text without "$", …)`,
            // centred on `at` at `${fontSize}px sans-serif`. Measuring that
            // exact string against that exact font makes the box match the ink
            // instead of approximating it.
            const text = element.text.replaceAll("$", "");
            const fontSize = element.pen?.fontSize ?? DEFAULT_LABEL_FONT_SIZE;
            const labelWidth = Math.max(
                MINIMUM_LABEL_WIDTH,
                input.measureLabelWidth?.(text, fontSize) ?? estimateLabelWidth(text, fontSize),
            );
            // Half-height scales with the font, reproducing the historical
            // 9px/18px box at the default size.
            const halfHeight = (fontSize / DEFAULT_LABEL_FONT_SIZE) * 9;
            return {
                x: x - labelWidth / 2 - padding,
                y: y - halfHeight - padding,
                width: labelWidth + padding * 2,
                height: halfHeight * 2 + padding * 2,
            };
        }
        const bounds = elementBounds(element);
        return bounds ? screenRect(bounds, padding) : null;
    }

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

    const selectedArcElement = ((): ArcElement | EllipticalArcElement | null => {
        if (
            activeSelection.length !== 1 ||
            input.selectionPreview !== null ||
            input.toolKind !== "select"
        ) return null;
        const element = input.displayScene.elements.find(({ id }) => id === activeSelection[0]);
        return element?.kind === "arc" || element?.kind === "elliptical-arc" ? element : null;
    })();

    const hasTransformExtent = ((): boolean => {
        if (!selectionGeometryBounds) return false;
        const dx = selectionGeometryBounds.max[0] - selectionGeometryBounds.min[0];
        const dy = selectionGeometryBounds.max[1] - selectionGeometryBounds.min[1];
        return Math.hypot(dx, dy) > 1e-9;
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

    const previewElementRects = ((): ScreenRect[] => {
        if (input.selectionPreview === null) return [];
        return input.displayScene.elements.flatMap((element) => {
            if (!selectedIds.has(element.id)) return [];
            const rect = elementScreenRect(element, 4);
            return rect ? [rect] : [];
        });
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
                cursor: "nwse-resize",
            },
            {
                position: "ne",
                screen: [x + boxWidth, y],
                handle: [max[0], max[1]],
                anchor: [min[0], min[1]],
                axes: { x: canResizeX, y: canResizeY },
                cursor: "nesw-resize",
            },
            {
                position: "se",
                screen: [x + boxWidth, y + boxHeight],
                handle: [max[0], min[1]],
                anchor: [min[0], max[1]],
                axes: { x: canResizeX, y: canResizeY },
                cursor: "nwse-resize",
            },
            {
                position: "sw",
                screen: [x, y + boxHeight],
                handle: [min[0], min[1]],
                anchor: [max[0], max[1]],
                axes: { x: canResizeX, y: canResizeY },
                cursor: "nesw-resize",
            },
        ];
        if (!input.selectionContainsSmartItems && canResizeY) {
            handles.push(
                {
                    position: "n",
                    screen: [x + boxWidth / 2, y],
                    handle: [midX, max[1]],
                    anchor: [midX, min[1]],
                    axes: { x: false, y: true },
                    cursor: "ns-resize",
                },
                {
                    position: "s",
                    screen: [x + boxWidth / 2, y + boxHeight],
                    handle: [midX, min[1]],
                    anchor: [midX, max[1]],
                    axes: { x: false, y: true },
                    cursor: "ns-resize",
                },
            );
        }
        if (!input.selectionContainsSmartItems && canResizeX) {
            handles.push(
                {
                    position: "e",
                    screen: [x + boxWidth, y + boxHeight / 2],
                    handle: [max[0], midY],
                    anchor: [min[0], midY],
                    axes: { x: true, y: false },
                    cursor: "ew-resize",
                },
                {
                    position: "w",
                    screen: [x, y + boxHeight / 2],
                    handle: [min[0], midY],
                    anchor: [max[0], midY],
                    axes: { x: true, y: false },
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

    const arcGuide = ((): OverlayArcGuide | null => {
        const construction = input.constructionArcGuide;
        if (construction) {
            const radiusEnd = construction.angle1 !== undefined
                ? arcPoint(construction.center, construction.radius, construction.angle1)
                : construction.radiusPoint ?? construction.center;
            const radiusLabelAt: Pair = [
                construction.center[0] + (radiusEnd[0] - construction.center[0]) * 0.55,
                construction.center[1] + (radiusEnd[1] - construction.center[1]) * 0.55,
            ];
            const handles: RenderArcHandle[] = [
                { control: "center", screen: project(construction.center) },
            ];
            if (construction.angle1 !== undefined) {
                handles.push({
                    control: "start",
                    screen: project(arcPoint(
                        construction.center,
                        construction.radius,
                        construction.angle1,
                    )),
                });
            }
            if (construction.angle2 !== undefined) {
                handles.push({
                    control: "end",
                    screen: project(arcPoint(
                        construction.center,
                        construction.radius,
                        construction.angle2,
                    )),
                });
            }
            return {
                center: project(construction.center),
                radius: toScreenLength(Math.abs(construction.radius)),
                handles,
                editHandles: [],
                elementId: null,
                points: undefined,
                radiusEditable: false,
                measurements: construction.radius > 1e-9
                    ? {
                          axes: [{
                              start: project(construction.center),
                              end: project(radiusEnd),
                              label: `r ${geometryLabel(construction.radius)}`,
                              labelAt: project(radiusLabelAt),
                          }],
                      }
                    : undefined,
            };
        }
        if (!selectedArcElement) return null;

        const start = selectedArcPoint(selectedArcElement, selectedArcElement.angle1);
        const end = selectedArcPoint(selectedArcElement, selectedArcElement.angle2);
        let startScreen = project(start);
        let endScreen = project(end);
        if (Math.hypot(startScreen[0] - endScreen[0], startScreen[1] - endScreen[1]) < 2) {
            const radians = (selectedArcElement.angle1 * Math.PI) / 180;
            const tangentWorld: Pair = selectedArcElement.kind === "arc"
                ? [-Math.sin(radians), Math.cos(radians)]
                : [
                      -selectedArcElement.axisX[0] * Math.sin(radians) +
                          selectedArcElement.axisY[0] * Math.cos(radians),
                      -selectedArcElement.axisX[1] * Math.sin(radians) +
                          selectedArcElement.axisY[1] * Math.cos(radians),
                  ];
            const tangentLength = Math.max(1e-9, Math.hypot(tangentWorld[0], tangentWorld[1]));
            const tangent: Pair = [
                (tangentWorld[0] / tangentLength) * 7,
                -(tangentWorld[1] / tangentLength) * 7,
            ];
            startScreen = [startScreen[0] - tangent[0], startScreen[1] - tangent[1]];
            endScreen = [endScreen[0] + tangent[0], endScreen[1] + tangent[1]];
        }

        const geometry = principalEllipseGeometry(selectedArcElement);
        const semanticHandles: Array<{
            control: Exclude<ArcControl, "radius">;
            handle: Pair;
            screen: Pair;
        }> = [
            { control: "center", handle: selectedArcElement.center, screen: project(selectedArcElement.center) },
            { control: "start", handle: start, screen: startScreen },
            { control: "end", handle: end, screen: endScreen },
        ];
        if (selectedArcElement.kind === "elliptical-arc" && geometry.eccentricity > 1e-4) {
            semanticHandles.push(
                { control: "focus1", handle: geometry.foci[0], screen: project(geometry.foci[0]) },
                { control: "focus2", handle: geometry.foci[1], screen: project(geometry.foci[1]) },
            );
        }
        const editHandles: OverlayArcHandle[] = semanticHandles.map((handle) => ({
            ...handle,
            elementId: selectedArcElement.id,
            state: isArcControl(input.selectedArcControl, selectedArcElement.id, handle.control)
                ? "selected"
                : isArcControl(input.hoveredArcControl, selectedArcElement.id, handle.control)
                  ? "hovered"
                  : "default",
        }));
        const points = selectedArcElement.kind === "elliptical-arc"
            ? Array.from({ length: 65 }, (_, index) =>
                  project(selectedArcPoint(selectedArcElement, (index / 64) * 360)),
              )
            : undefined;
        const majorOffset: Pair = [
            geometry.majorDirection[0] * geometry.semiMajor,
            geometry.majorDirection[1] * geometry.semiMajor,
        ];
        const minorOffset: Pair = [
            geometry.minorDirection[0] * geometry.semiMinor,
            geometry.minorDirection[1] * geometry.semiMinor,
        ];
        const center = selectedArcElement.center;
        const axes = selectedArcElement.kind === "arc"
            ? [{
                  start: project(center),
                  end: project(start),
                  label: `r ${geometryLabel(geometry.semiMajor)}`,
                  labelAt: project([
                      center[0] + (start[0] - center[0]) * 0.55,
                      center[1] + (start[1] - center[1]) * 0.55,
                  ]),
              }]
            : [
                  {
                      start: project([center[0] - majorOffset[0], center[1] - majorOffset[1]]),
                      end: project([center[0] + majorOffset[0], center[1] + majorOffset[1]]),
                      label: `a ${geometryLabel(geometry.semiMajor)}`,
                      labelAt: project([
                          center[0] + majorOffset[0] * 0.58,
                          center[1] + majorOffset[1] * 0.58,
                      ]),
                  },
                  {
                      start: project([center[0] - minorOffset[0], center[1] - minorOffset[1]]),
                      end: project([center[0] + minorOffset[0], center[1] + minorOffset[1]]),
                      label: `b ${geometryLabel(geometry.semiMinor)}`,
                      labelAt: project([
                          center[0] + minorOffset[0] * 0.58,
                          center[1] + minorOffset[1] * 0.58,
                      ]),
                  },
              ];
        const sweep = positiveArcSweep(selectedArcElement.angle1, selectedArcElement.angle2);
        const angleMidpoint = selectedArcPoint(
            selectedArcElement,
            selectedArcElement.angle1 + sweep / 2,
        );
        const angleLabelAt = project([
            center[0] + (angleMidpoint[0] - center[0]) * 0.38,
            center[1] + (angleMidpoint[1] - center[1]) * 0.38,
        ]);
        return {
            center: project(center),
            radius: selectedArcElement.kind === "arc"
                ? toScreenLength(Math.abs(selectedArcElement.radius))
                : undefined,
            points,
            handles: editHandles,
            editHandles,
            elementId: selectedArcElement.id,
            radiusEditable: selectedArcElement.kind === "arc",
            measurements: {
                axes,
                angleRays: [project(start), project(end)] as const,
                angleLabel: `θ ${geometryLabel(sweep)}°`,
                angleLabelAt,
            },
        };
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
        return {
            stemStart: [selectionRect.x + selectionRect.width / 2, selectionRect.y],
            screen: [selectionRect.x + selectionRect.width / 2, selectionRect.y - 24],
            pivot: [
                (selectionGeometryBounds.min[0] + selectionGeometryBounds.max[0]) / 2,
                (selectionGeometryBounds.min[1] + selectionGeometryBounds.max[1]) / 2,
            ],
        };
    })();

    const marqueeRect = ((): ScreenRect | null => {
        if (!input.marquee) return null;
        const a = project(input.marquee.start);
        const b = project(input.marquee.end);
        return {
            x: Math.min(a[0], b[0]),
            y: Math.min(a[1], b[1]),
            width: Math.abs(a[0] - b[0]),
            height: Math.abs(a[1] - b[1]),
        };
    })();

    const selectedSegmentMarkers = input.selectedFeatureGeometry.segments.map(
        (segment, index) => ({
            label: index + 1,
            screen: project([
                (segment.a[0] + segment.b[0]) / 2,
                (segment.a[1] + segment.b[1]) / 2,
            ]),
        }),
    );

    return {
        selectedIds,
        selectionIsPreview,
        previewElementRects,
        marqueeRect,
        selectionRect,
        rotationControl,
        resizeHandles,
        vertexHandles,
        arcGuide,
        snapProposal: input.snapProposal
            ? { from: project(input.snapProposal.from), to: project(input.snapProposal.to) }
            : null,
        constraintGlyphs: input.constraintGlyphs.map((glyph) => {
            const [x, y] = project(glyph.at);
            return { id: glyph.id, screen: [x + 12, y - 12] as Pair, selected: glyph.selected };
        }),
        dimensions: input.dimensionGlyphs.map((glyph) => ({
            id: glyph.id,
            a: project(glyph.a),
            b: project(glyph.b),
            label: project(glyph.at),
            text: `${glyph.value.toFixed(2)}${glyph.mode === "reference" ? " ref" : ""}`,
            mode: glyph.mode,
            selected: glyph.selected,
            value: glyph.value,
        })),
        featurePoints: input.selectedFeatureGeometry.points.map(project),
        featureSegments: input.selectedFeatureGeometry.segments.map((segment) => ({
            a: project(segment.a),
            b: project(segment.b),
        })),
        selectionGeometryBounds,
        straightVertexEditablePath,
        selectedSegmentMarkers,
    };
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
