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
    type Bounds,
    type Pair,
    type PathElement,
    type Scene,
    type SceneElement,
} from "$lib/asy/scene";
import type { ArcGuide } from "$lib/asy/engine";
import { buildArcGuide } from "./overlay/arc-guide";
import { buildSelectionTransform } from "./overlay/selection-transform";
export { activeSelectedVertexOf } from "./overlay/selection-transform";
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
    /**
     * Screen-space corners (in path order) of a single selected rotated smart
     * rectangle's oriented selection box, or `null` when the axis-aligned
     * `selectionRect` is used instead. When present, the outline, resize
     * handles, and rotation stem all follow the rectangle's orientation.
     */
    selectionQuad: [Pair, Pair, Pair, Pair] | null;
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
    /** Live screen position of the arc handle currently being dragged. */
    activeArcPointer: Pair | null;
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

export function buildOverlay(input: OverlayInput): WhiteboardOverlay {
    const { project } = input;

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

    const {
        selectionGeometryBounds,
        straightVertexEditablePath,
        selectionRect,
        selectionQuad,
        resizeHandles,
        vertexHandles,
        rotationControl,
    } = buildSelectionTransform({
        input,
        activeSelection,
        selectedIds,
        selectionIsPreview,
        project,
        screenRect,
        elementScreenRect,
    });

    const previewElementRects = ((): ScreenRect[] => {
        if (input.selectionPreview === null) return [];
        return input.displayScene.elements.flatMap((element) => {
            if (!selectedIds.has(element.id)) return [];
            const rect = elementScreenRect(element, 4);
            return rect ? [rect] : [];
        });
    })();

    const arcGuide = buildArcGuide(input, activeSelection);

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
        selectionQuad,
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
        // A smart arc drag already has a live edit handle sourced from the
        // preview Scene. Its selected-feature marker still comes from the
        // committed Document, so drawing both leaves a stale "old endpoint".
        featurePoints: input.activeArcPointer
            ? []
            : input.selectedFeatureGeometry.points.map(project),
        featureSegments: input.selectedFeatureGeometry.segments.map((segment) => ({
            a: project(segment.a),
            b: project(segment.b),
        })),
        selectionGeometryBounds,
        straightVertexEditablePath,
        selectedSegmentMarkers,
    };
}
