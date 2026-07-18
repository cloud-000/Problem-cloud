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
 * Any subset may be present; an empty result means "no change".
 */

import type { Pair, Pen, Scene } from "../../scene/types";

export type ToolKind =
    | "select"
    | "pen"
    | "line"
    | "circle"
    | "arc"
    | "point"
    | "label"
    | "eraser";

export interface ToolContext {
    /** Pen applied to newly created elements. */
    pen: Pen;
    /** Hit-test tolerance in asy-space (view derives from its px->asy scale). */
    tolerance: number;
    /** RDP tolerance for freehand simplification, in asy-space. */
    simplifyEpsilon: number;
    /** Supplied by the view for the label tool; returns text or null if cancelled. */
    promptLabel?: (at: Pair) => string | null;
}

export interface ToolResult {
    commit?: Scene;
    preview?: Scene | null;
    selection?: string[];
}

export interface Tool {
    readonly kind: ToolKind;
    onPointerDown(scene: Scene, p: Pair, ctx: ToolContext): ToolResult;
    onPointerMove(scene: Scene, p: Pair, ctx: ToolContext): ToolResult;
    onPointerUp(scene: Scene, p: Pair, ctx: ToolContext): ToolResult;
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
