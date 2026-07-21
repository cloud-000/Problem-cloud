/**
 * StyleModel — the whiteboard's presentation-style concern (ARCHITECTURE.md §5).
 *
 * Owns pen/tool defaults, the inspector's tool-property surface, and the
 * property-edit lifecycle (begin/commit/cancel). Everything below is either a
 * **pure** function over a plain `ToolStyleState` (framework-neutral, unit
 * testable without a browser) or the thin reactive `StyleModel` class that holds
 * that state as `$state` and forwards to a `StyleHost` for document/history
 * access. The store delegates to it and keeps no style logic of its own.
 *
 * Boundary: StyleModel never owns the Document. Selection-scoped edits are built
 * as `WhiteboardDocument` transactions and handed back through the host
 * (`applyDocument` / `pushBaseline`); the tool-default edits are the only state
 * it mutates directly. This keeps it subordinate to the single source of truth
 * (INVARIANTS §0) — it produces transactions, it does not become a second one.
 */

import type { Pen, Scene } from "$lib/asy/scene/types";
import {
    EDITOR_PROPERTY_DEFINITIONS,
    penColorHex,
    penWithColor,
    resolveElementProperties,
    toolPropertyIds,
    writeElementProperty,
    type EditorPropertyId,
    type EditorPropertyValue,
    type ResolvedEditorProperty,
} from "$lib/asy/editor-properties";
import type { ToolKind } from "$lib/asy/engine";
import {
    resolveWhiteboardDocument,
    updateSmartPresentationStyle,
    type WhiteboardDocument,
} from "$lib/whiteboard/model";

/** Tool kinds that carry an editable pen (everything but select/eraser/pan). */
export type WhiteboardToolKind = ToolKind | "pan";
export type StyledToolKind = Exclude<ToolKind, "select" | "eraser">;

const DEFAULT_TOOL_PENS: Record<StyledToolKind, Pen> = {
    pen: { lineWidth: 3, dash: "solid", opacity: 1 },
    line: { lineWidth: 3, dash: "solid", opacity: 1 },
    rectangle: { lineWidth: 3, dash: "solid", opacity: 1 },
    arc: { lineWidth: 3, dash: "solid", opacity: 1 },
    point: { lineWidth: 3, opacity: 1 },
    label: { fontSize: 14, opacity: 1 },
};

/** Plain, serializable tool-default style — mirrors the store's former fields. */
export interface ToolStyleState {
    strokeColor: string;
    toolPens: Record<StyledToolKind, Pen>;
    rectangleFillEnabled: boolean;
    rectangleFillPen: Pen;
    eraserSize: number;
}

export function createToolStyleState(): ToolStyleState {
    return {
        strokeColor: "#000000",
        toolPens: structuredClone(DEFAULT_TOOL_PENS),
        rectangleFillEnabled: false,
        rectangleFillPen: { namedColor: "gray", opacity: 0.2 },
        eraserSize: 8,
    };
}

export function isStyledTool(kind: WhiteboardToolKind): kind is StyledToolKind {
    return kind !== "select" && kind !== "eraser" && kind !== "pan";
}

/** The pen a tool draws with: its per-kind settings tinted by the stroke color. */
export function activePen(state: ToolStyleState, toolKind: WhiteboardToolKind): Pen {
    const settings = isStyledTool(toolKind) ? state.toolPens[toolKind] : DEFAULT_TOOL_PENS.pen;
    return penWithColor(settings, state.strokeColor);
}

/** Apply the shared-pen compatibility facade (color + per-tool settings). */
export function applyPenFacade(state: ToolStyleState, toolKind: WhiteboardToolKind, value: Pen): void {
    if (value.namedColor || value.color) state.strokeColor = penColorHex(value);
    if (isStyledTool(toolKind)) {
        const { namedColor: _namedColor, color: _color, ...settings } = value;
        state.toolPens[toolKind] = { ...state.toolPens[toolKind], ...settings };
    }
}

export function readToolProperty(
    state: ToolStyleState,
    toolKind: WhiteboardToolKind,
    id: EditorPropertyId,
): EditorPropertyValue {
    const pen = activePen(state, toolKind);
    switch (id) {
        case "strokeColor": return state.strokeColor;
        case "fillEnabled": return state.rectangleFillEnabled;
        case "fillColor": return penColorHex(state.rectangleFillPen);
        case "lineWidth": return pen.lineWidth ?? 3;
        case "dash": return typeof pen.dash === "string" ? pen.dash : "solid";
        case "strokeOpacity": return pen.opacity ?? 1;
        case "fillOpacity": return state.rectangleFillPen.opacity ?? 0.2;
        case "fontSize": return pen.fontSize ?? 14;
        case "pointSize": return pen.lineWidth ?? 3;
        case "eraserSize": return state.eraserSize;
        case "labelText": return "";
        case "radius":
        case "semiMajorAxis":
        case "semiMinorAxis":
        case "eccentricity":
        case "startAngle":
        case "arcAngle": return 0;
    }
}

export function writeToolProperty(
    state: ToolStyleState,
    toolKind: WhiteboardToolKind,
    id: EditorPropertyId,
    value: EditorPropertyValue,
): void {
    if (id === "strokeColor") {
        state.strokeColor = String(value);
        return;
    }
    if (id === "fillEnabled") {
        state.rectangleFillEnabled = Boolean(value);
        return;
    }
    if (id === "fillColor") {
        state.rectangleFillPen = penWithColor(state.rectangleFillPen, String(value));
        return;
    }
    if (id === "fillOpacity") {
        state.rectangleFillPen = { ...state.rectangleFillPen, opacity: Number(value) };
        return;
    }
    if (id === "eraserSize") {
        state.eraserSize = Number(value);
        return;
    }
    if (
        id === "radius" ||
        id === "semiMajorAxis" ||
        id === "semiMinorAxis" ||
        id === "eccentricity" ||
        id === "startAngle" ||
        id === "arcAngle"
    ) return;
    if (!isStyledTool(toolKind)) return;
    const patch: Partial<Pen> = id === "lineWidth" || id === "pointSize"
        ? { lineWidth: Number(value) }
        : id === "dash"
          ? { dash: value as Pen["dash"] }
          : id === "strokeOpacity"
            ? { opacity: Number(value) }
            : id === "fontSize"
              ? { fontSize: Number(value) }
              : {};
    state.toolPens[toolKind] = { ...state.toolPens[toolKind], ...patch };
}

/** The inspector rows shown when nothing is selected (tool defaults). */
export function toolInspectorProperties(
    state: ToolStyleState,
    toolKind: ToolKind,
): ResolvedEditorProperty[] {
    return toolPropertyIds(toolKind).map((id) => ({
        ...EDITOR_PROPERTY_DEFINITIONS[id],
        value: readToolProperty(state, toolKind, id),
        mixed: false,
    }));
}

/**
 * The store capabilities StyleModel needs: the active tool/selection, the
 * document (read + live overwrite for in-progress edits), the projected Scene,
 * and the two document→history entry points.
 */
export interface StyleHost {
    readonly toolKind: WhiteboardToolKind;
    readonly selection: readonly string[];
    readonly scene: Scene;
    document: WhiteboardDocument;
    /** Atomic commit of one transaction as a new undo step. */
    applyDocument(next: WhiteboardDocument): void;
    /** Record a pre-edit baseline as the undo step for a coalesced edit. */
    pushBaseline(baseline: WhiteboardDocument): void;
}

function snapshot(document: WhiteboardDocument): WhiteboardDocument {
    return $state.snapshot(document) as WhiteboardDocument;
}

export class StyleModel {
    /** Tool-default style; the only state StyleModel owns outright. */
    state = $state<ToolStyleState>(createToolStyleState());
    #host: StyleHost;
    #propertyBaseline: WhiteboardDocument | null = null;

    constructor(host: StyleHost) {
        this.#host = host;
    }

    get strokeColor(): string {
        return this.state.strokeColor;
    }
    get eraserSize(): number {
        return this.state.eraserSize;
    }
    get rectangleFillEnabled(): boolean {
        return this.state.rectangleFillEnabled;
    }
    get rectangleFillPen(): Pen {
        return this.state.rectangleFillPen;
    }
    /** The pen a given tool draws with (used to build the ToolContext). */
    activePen(toolKind: WhiteboardToolKind): Pen {
        return activePen(this.state, toolKind);
    }

    /** Compatibility facade for callers that read/wrote one shared pen. */
    get pen(): Pen {
        return activePen(this.state, this.#host.toolKind);
    }
    set pen(value: Pen) {
        applyPenFacade(this.state, this.#host.toolKind, value);
    }

    get inspectorProperties(): ResolvedEditorProperty[] {
        const selected = this.#host.scene.elements.filter(({ id }) => this.#host.selection.includes(id));
        if (selected.length > 0) return resolveElementProperties(selected);
        const toolKind = this.#host.toolKind;
        if (toolKind === "pan") return [];
        return toolInspectorProperties(this.state, toolKind);
    }

    setInspectorProperty(id: EditorPropertyId, value: EditorPropertyValue): void {
        const host = this.#host;
        if (host.selection.length === 0) {
            writeToolProperty(this.state, host.toolKind, id, value);
            return;
        }
        const baseDocument = this.#propertyBaseline ?? snapshot(host.document);
        const baseScene = resolveWhiteboardDocument(baseDocument);
        let next = baseDocument;
        for (const element of baseScene.elements) {
            if (!host.selection.includes(element.id)) continue;
            const updated = writeElementProperty(element, id, value);
            const item = next.items.find((candidate) =>
                (candidate.kind === "baked" ? candidate.element.id : candidate.id) === element.id
            );
            if (item?.kind === "baked") {
                next = {
                    ...next,
                    items: next.items.map((candidate) => candidate === item
                        ? { ...candidate, element: updated }
                        : candidate),
                };
            } else next = updateSmartPresentationStyle(next, element.id, updated);
        }
        if (this.#propertyBaseline) host.document = next;
        else if (JSON.stringify(next) !== JSON.stringify(baseDocument)) host.applyDocument(next);
    }

    beginPropertyEdit(): void {
        if (this.#host.selection.length > 0 && !this.#propertyBaseline) {
            this.#propertyBaseline = snapshot(this.#host.document);
        }
    }

    commitPropertyEdit(): void {
        if (!this.#propertyBaseline) return;
        const baseline = this.#propertyBaseline;
        this.#propertyBaseline = null;
        if (JSON.stringify(baseline) !== JSON.stringify(snapshot(this.#host.document))) {
            this.#host.pushBaseline(baseline);
        }
    }

    cancelPropertyEdit(): void {
        if (!this.#propertyBaseline) return;
        this.#host.document = this.#propertyBaseline;
        this.#propertyBaseline = null;
    }
}
