/**
 * Tool model. Each tool is a small state machine the *view* drives: the view
 * owns pointer capture and screen->asy coordinate mapping, then calls
 * onPointerDown/Move/Up with asy-space points. Tools never touch the DOM.
 *
 * A tool returns a `ToolResult`:
 *   - `preview` — a transient scene to render *instead of* the committed scene
 *     while dragging (rubber-band creation, live move). Not pushed to history.
 *     `null` clears any active preview.
 *   - `commit`  — the new authoritative scene. The store pushes history + swaps.
 *   - `selection` — updated selected element ids.
 *   - `nextTool` — optionally activate a different tool after a committed edit.
 *   - `selectionPreview` — transient marquee membership before pointer release.
 * Any subset may be present; an empty result means "no change".
 */

import type { Pair, Pen, Scene } from "../../scene/types";
import type { StrokeProcessingOptions } from "../simplify";

export interface LineContinuation {
    /** Open path created by the line tool and still accepting nodes. */
    elementId: string;
    /** Current last node, from which the next segment starts. */
    nodeIndex: number;
}

/** Transient construction/editing guide for a circular arc. */
export interface ArcGuide {
    center: Pair;
    radius: number;
    angle1?: number;
    angle2?: number;
}

export type SelectionTransformGesture =
    | {
          kind: "vertex";
          /** The all-straight path whose endpoint is being edited. */
          elementId: string;
          /** Index of the endpoint in the path's node array. */
          nodeIndex: number;
          /** Vertex position represented by the dragged UI handle. */
          handle: Pair;
      }
    | {
          kind: "resize";
          /** Opposite corner, fixed for the duration of the resize. */
          anchor: Pair;
          /** Unpadded geometry corner represented by the dragged UI handle. */
          handle: Pair;
          /** Dimensions controlled by this handle. */
          axes: { x: boolean; y: boolean };
          /** Smallest allowed positive scale per axis, preventing collapse/mirroring. */
          minimumScale: Pair;
      }
    | {
          kind: "rotate";
          /** Center of the selection bounds. */
          pivot: Pair;
      }
    | {
          kind: "arc";
          elementId: string;
          control: "center" | "start" | "end" | "radius";
          /** Semantic geometry point, used to keep center drags from jumping. */
          handle: Pair;
          /** Smallest radius allowed by a radius drag. */
          minimumRadius: number;
      };

export type ToolKind =
    | "select"
    | "pen"
    | "line"
    | "rectangle"
    | "arc"
    | "point"
    | "label"
    | "eraser";

export interface ToolContext {
    /** Pen applied to newly created elements. */
    pen: Pen;
    /** Hit-test tolerance in asy-space (view derives from its px->asy scale). */
    tolerance: number;
    /** Maximum pen travel that commits as one tap mark, in scene units. */
    penTapTolerance: number;
    /** Freehand cleanup controls; distance values are in scene units. */
    strokeProcessing: StrokeProcessingOptions;
    /** Current selected element ids, used by tools that operate on a group. */
    selection: string[];
    /** Connected-path preview handed from the Line tool to Select. */
    lineContinuation: LineContinuation | null;
    /** Present on pointer-down when the view hit a selection transform handle. */
    selectionTransform?: SelectionTransformGesture;
    /** Snap an active rotation gesture to 15-degree increments. */
    snapRotation?: boolean;
    /** Preserve the pointer-down selection aspect ratio during resize. */
    lockAspectRatio?: boolean;
    /** Supplied by the view for the label tool; returns text or null if cancelled. */
    promptLabel?: (at: Pair) => string | null;
}

export interface ToolResult {
    commit?: Scene;
    preview?: Scene | null;
    selection?: string[];
    /** Tool to activate after this result commits. Creation tools can use this
     *  to hand the newly-created element straight to the normal Select tool. */
    nextTool?: ToolKind;
    /** Start, advance, preserve, or clear the connected-path preview. */
    lineContinuation?: LineContinuation | null;
    /** Optional user-facing diagnostic emitted by the store after this result. */
    consoleMessage?: string;
    /** Candidate element ids while a marquee gesture is still in progress. */
    selectionPreview?: string[] | null;
    /** Transient select-tool marquee, rendered by the view rather than stored in the scene. */
    marquee?: { start: Pair; end: Pair } | null;
    /** Transient circular guide and semantic points for arc construction. */
    arcGuide?: ArcGuide | null;
}

export interface Tool {
    readonly kind: ToolKind;
    onPointerDown(scene: Scene, p: Pair, ctx: ToolContext): ToolResult;
    onPointerMove(scene: Scene, p: Pair, ctx: ToolContext): ToolResult;
    /** Process a coalesced/frame batch in one tool update when supported. */
    onPointerMoves?(scene: Scene, points: readonly Pair[], ctx: ToolContext): ToolResult;
    onPointerUp(
        scene: Scene,
        p: Pair,
        ctx: ToolContext,
        /** Samples buffered since the last preview, synchronously drained on release. */
        pendingMoves?: readonly Pair[],
    ): ToolResult;
    /** Abandon any in-progress interaction (e.g. Escape). */
    onCancel(): ToolResult;
}

// --- shared immutable scene helpers ------------------------------------------

export function addElement(scene: Scene, ...els: Scene["elements"]): Scene {
    return { ...scene, elements: [...scene.elements, ...els] };
}

export function removeElementById(scene: Scene, id: string): Scene {
    return { ...scene, elements: scene.elements.filter((e) => e.id !== id) };
}

export function mapElements(
    scene: Scene,
    fn: (el: Scene["elements"][number]) => Scene["elements"][number]
): Scene {
    return { ...scene, elements: scene.elements.map(fn) };
}

export const NO_RESULT: ToolResult = {};
