/**
 * Per-instance whiteboard store (like `LibraryStore`, not a global singleton):
 * a whiteboard is a scoped document editor and there may be more than one open
 * at once (e.g. a scratch overlay plus a "trace this diagram" board).
 *
 * It bridges the three pure-TS layers to the Svelte view:
 *   - scene / selection / tool / pen are reactive `$state`
 *   - edits flow through the engine tools and are recorded in snapshot history
 *   - `toAsy` / `loadAsy` use the codec; `persist` / `restore` use localStorage
 *
 * SSR caveat (per repo conventions): never mutate at module load; all
 * localStorage access is `browser`-guarded.
 */

import { browser } from "$app/environment";
import type { Pen, Scene } from "$lib/asy/scene/types";
import { emptyScene, isStraightPathVertexEditable } from "$lib/asy/scene";
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
import { parse, serialize } from "$lib/asy/codec";
import {
    createTool,
    type Tool,
    type ToolContext,
    type ToolKind,
    type ToolResult,
    type SelectionTransformGesture,
    type LineContinuation,
    type ArcGuide,
    DEFAULT_STROKE_PROCESSING_OPTIONS,
    type StrokeProcessingOptions,
    type PointerInput,
} from "$lib/asy/engine";
import { History } from "$lib/asy/engine";

function snapshot(scene: Scene): Scene {
    return $state.snapshot(scene) as Scene;
}

export type WhiteboardToolKind = ToolKind | "pan";

type StyledToolKind = Exclude<ToolKind, "select" | "eraser">;

const DEFAULT_TOOL_PENS: Record<StyledToolKind, Pen> = {
    pen: { lineWidth: 3, dash: "solid", opacity: 1 },
    line: { lineWidth: 3, dash: "solid", opacity: 1 },
    rectangle: { lineWidth: 3, dash: "solid", opacity: 1 },
    arc: { lineWidth: 3, dash: "solid", opacity: 1 },
    point: { lineWidth: 3, opacity: 1 },
    label: { fontSize: 14, opacity: 1 },
};

export class WhiteboardStore {
    scene = $state<Scene>(emptyScene());
    toolKind = $state<WhiteboardToolKind>("select");
    strokeColor = $state("#000000");
    toolPens = $state<Record<StyledToolKind, Pen>>(structuredClone(DEFAULT_TOOL_PENS));
    rectangleFillEnabled = $state(false);
    rectangleFillPen = $state<Pen>({ namedColor: "gray", opacity: 0.2 });
    eraserSize = $state(8);
    selection = $state<string[]>([]);
    /** Candidate selection while a marquee drag is in progress. */
    selectionPreview = $state<string[] | null>(null);
    /** Transient render override during a drag (rubber-band / live move). */
    preview = $state<Scene | null>(null);
    marquee = $state<{ start: readonly [number, number]; end: readonly [number, number] } | null>(null);
    /** Active path continuation offered immediately after a line is drawn. */
    lineContinuation = $state<LineContinuation | null>(null);
    /** Transient construction guide for the active arc tool. */
    arcGuide = $state<ArcGuide | null>(null);
    canUndo = $state(false);
    canRedo = $state(false);

    /** Hit-test / commit tolerance in asy-space; the view keeps this in sync
     *  with its current px->asy scale. */
    tolerance = 0.5;
    /** Pen travel that still counts as a tap; the view derives it from 2 CSS px. */
    penTapTolerance = 0.05;
    /** Freehand cleanup controls. The view keeps distance values in sync with
     *  its current px->scene scale; scalar values remain framework defaults. */
    strokeProcessing: StrokeProcessingOptions = { ...DEFAULT_STROKE_PROCESSING_OPTIONS };
    /** Scene-space distance represented by one CSS pixel at the active zoom. */
    sceneUnitsPerPixel = 1 / 40;
    /** Supplied by the view so the label tool can prompt for text. */
    promptLabel?: (at: readonly [number, number]) => string | null;

    #history = new History<Scene>();
    #tool: Tool = createTool("select");
    #propertyBaseline: Scene | null = null;

    constructor(initial?: Scene) {
        if (initial) this.scene = initial;
    }

    /** The scene the view should render (preview wins while dragging). */
    get displayScene(): Scene {
        return this.preview ?? this.scene;
    }

    /** Compatibility facade for callers that previously read/wrote one shared pen. */
    get pen(): Pen {
        return this.#activePen();
    }

    set pen(value: Pen) {
        if (value.namedColor || value.color) this.strokeColor = penColorHex(value);
        if (this.#isStyledTool(this.toolKind)) {
            const { namedColor: _namedColor, color: _color, ...settings } = value;
            this.toolPens[this.toolKind] = { ...this.toolPens[this.toolKind], ...settings };
        }
    }

    get inspectorTitle(): string {
        if (this.selection.length > 1) return `${this.selection.length} objects`;
        if (this.selection.length === 1) {
            const element = this.scene.elements.find(({ id }) => id === this.selection[0]);
            if (element) return element.kind === "fill" ? "Filled path" : element.kind.replaceAll("-", " ");
        }
        return this.toolKind === "pan" ? "Pan" : this.toolKind[0].toUpperCase() + this.toolKind.slice(1);
    }

    get inspectorProperties(): ResolvedEditorProperty[] {
        const selected = this.scene.elements.filter(({ id }) => this.selection.includes(id));
        if (selected.length > 0) return resolveElementProperties(selected);
        if (this.toolKind === "pan") return [];
        return toolPropertyIds(this.toolKind).map((id) => ({
            ...EDITOR_PROPERTY_DEFINITIONS[id],
            value: this.#readToolProperty(id),
            mixed: false,
        }));
    }

    setTool(kind: WhiteboardToolKind): void {
        this.commitPropertyEdit();
        this.#tool.onCancel();
        this.preview = null;
        this.selectionPreview = null;
        this.marquee = null;
        this.lineContinuation = null;
        this.arcGuide = null;
        this.toolKind = kind;
        if (kind !== "pan") this.#tool = createTool(kind);
    }

    // --- pointer plumbing (the view maps screen->asy before calling these) ----

    pointerDown(p: PointerInput, selectionTransform?: SelectionTransformGesture): void {
        this.#dispatch(this.#tool.onPointerDown(this.scene, p, this.#ctx({ selectionTransform })));
    }
    pointerMove(p: PointerInput, shiftKey = false): void {
        this.#dispatch(this.#tool.onPointerMove(
            this.scene,
            p,
            this.#ctx({ snapRotation: shiftKey, lockAspectRatio: shiftKey }),
        ));
    }
    pointerMoves(points: readonly PointerInput[], shiftKey = false): void {
        if (points.length === 0) return;
        const ctx = this.#ctx({ snapRotation: shiftKey, lockAspectRatio: shiftKey });
        const result = this.#tool.onPointerMoves
            ? this.#tool.onPointerMoves(this.scene, points, ctx)
            : this.#tool.onPointerMove(this.scene, points[points.length - 1], ctx);
        this.#dispatch(result);
    }
    pointerUp(
        p: PointerInput,
        shiftKey = false,
        pendingMoves: readonly PointerInput[] = [],
    ): void {
        this.#dispatch(this.#tool.onPointerUp(
            this.scene,
            p,
            this.#ctx({ snapRotation: shiftKey, lockAspectRatio: shiftKey }),
            pendingMoves,
        ));
    }
    cancel(): void {
        this.#dispatch(this.#tool.onCancel());
    }

    #ctx(
        overrides: Pick<
            ToolContext,
            "selectionTransform" | "snapRotation" | "lockAspectRatio"
        > = {},
    ): ToolContext {
        return {
            pen: $state.snapshot(this.#activePen()) as Pen,
            fillPen: this.toolKind === "rectangle" && this.rectangleFillEnabled
                ? ($state.snapshot(this.rectangleFillPen) as Pen)
                : undefined,
            eraserRadius: this.eraserSize,
            tolerance: this.tolerance,
            penTapTolerance: this.penTapTolerance,
            strokeProcessing: { ...this.strokeProcessing },
            sceneUnitsPerPixel: this.sceneUnitsPerPixel,
            selection: $state.snapshot(this.selection) as string[],
            lineContinuation: this.lineContinuation
                ? ($state.snapshot(this.lineContinuation) as LineContinuation)
                : null,
            promptLabel: this.promptLabel,
            ...overrides,
        };
    }

    #dispatch(result: ToolResult): void {
        if (result.consoleMessage) console.info(result.consoleMessage);
        if (result.selection !== undefined) this.selection = result.selection;
        if (result.selectionPreview !== undefined) this.selectionPreview = result.selectionPreview;
        if (result.marquee !== undefined) this.marquee = result.marquee;
        if (result.lineContinuation !== undefined) {
            this.lineContinuation = result.lineContinuation;
        }
        if (result.arcGuide !== undefined) this.arcGuide = result.arcGuide;
        if (result.commit !== undefined) {
            this.apply(result.commit);
            this.preview = null;
            this.selectionPreview = null;
            this.marquee = null;
            if (result.nextTool) {
                const continuation = result.lineContinuation;
                this.setTool(result.nextTool);
                if (continuation !== undefined) this.lineContinuation = continuation;
            }
        } else if (result.preview !== undefined) {
            this.preview = result.preview;
        }
    }

    // --- history --------------------------------------------------------------

    /** Replace the scene, recording the prior state for undo. */
    apply(next: Scene): void {
        this.#history.push(snapshot(this.scene));
        this.scene = next;
        this.#syncFlags();
    }

    undo(): void {
        const prev = this.#history.undo(snapshot(this.scene));
        if (prev) {
            this.scene = prev;
            this.selection = [];
            this.preview = null;
            this.selectionPreview = null;
            this.lineContinuation = null;
            this.arcGuide = null;
        }
        this.#syncFlags();
    }

    redo(): void {
        const next = this.#history.redo(snapshot(this.scene));
        if (next) {
            this.scene = next;
            this.selection = [];
            this.preview = null;
            this.selectionPreview = null;
            this.lineContinuation = null;
            this.arcGuide = null;
        }
        this.#syncFlags();
    }

    #syncFlags(): void {
        this.canUndo = this.#history.canUndo;
        this.canRedo = this.#history.canRedo;
    }

    // --- editing convenience --------------------------------------------------

    setInspectorProperty(id: EditorPropertyId, value: EditorPropertyValue): void {
        if (this.selection.length === 0) {
            this.#writeToolProperty(id, value);
            return;
        }
        const base = this.#propertyBaseline ?? this.scene;
        const next = {
            ...base,
            elements: base.elements.map((element) => this.selection.includes(element.id)
                ? writeElementProperty(element, id, value)
                : element),
        };
        if (this.#propertyBaseline) this.scene = next;
        else this.apply(next);
    }

    beginPropertyEdit(): void {
        if (this.selection.length > 0 && !this.#propertyBaseline) {
            this.#propertyBaseline = snapshot(this.scene);
        }
    }

    commitPropertyEdit(): void {
        if (!this.#propertyBaseline) return;
        const baseline = this.#propertyBaseline;
        this.#propertyBaseline = null;
        if (JSON.stringify(baseline) !== JSON.stringify(snapshot(this.scene))) {
            this.#history.push(baseline);
            this.#syncFlags();
        }
    }

    cancelPropertyEdit(): void {
        if (!this.#propertyBaseline) return;
        this.scene = this.#propertyBaseline;
        this.#propertyBaseline = null;
    }

    #isStyledTool(kind: WhiteboardToolKind): kind is StyledToolKind {
        return kind !== "select" && kind !== "eraser" && kind !== "pan";
    }

    #activePen(): Pen {
        const settings = this.#isStyledTool(this.toolKind)
            ? this.toolPens[this.toolKind]
            : DEFAULT_TOOL_PENS.pen;
        return penWithColor(settings, this.strokeColor);
    }

    #readToolProperty(id: EditorPropertyId): EditorPropertyValue {
        const pen = this.#activePen();
        switch (id) {
            case "strokeColor": return this.strokeColor;
            case "fillEnabled": return this.rectangleFillEnabled;
            case "fillColor": return penColorHex(this.rectangleFillPen);
            case "lineWidth": return pen.lineWidth ?? 3;
            case "dash": return typeof pen.dash === "string" ? pen.dash : "solid";
            case "strokeOpacity": return pen.opacity ?? 1;
            case "fillOpacity": return this.rectangleFillPen.opacity ?? 0.2;
            case "fontSize": return pen.fontSize ?? 14;
            case "pointSize": return pen.lineWidth ?? 3;
            case "eraserSize": return this.eraserSize;
            case "labelText": return "";
            case "radius":
            case "semiMajorAxis":
            case "semiMinorAxis":
            case "eccentricity":
            case "startAngle":
            case "arcAngle": return 0;
        }
    }

    #writeToolProperty(id: EditorPropertyId, value: EditorPropertyValue): void {
        if (id === "strokeColor") {
            this.strokeColor = String(value);
            return;
        }
        if (id === "fillEnabled") {
            this.rectangleFillEnabled = Boolean(value);
            return;
        }
        if (id === "fillColor") {
            this.rectangleFillPen = penWithColor(this.rectangleFillPen, String(value));
            return;
        }
        if (id === "fillOpacity") {
            this.rectangleFillPen = { ...this.rectangleFillPen, opacity: Number(value) };
            return;
        }
        if (id === "eraserSize") {
            this.eraserSize = Number(value);
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
        if (!this.#isStyledTool(this.toolKind)) return;
        const patch: Partial<Pen> = id === "lineWidth" || id === "pointSize"
            ? { lineWidth: Number(value) }
            : id === "dash"
              ? { dash: value as Pen["dash"] }
              : id === "strokeOpacity"
                ? { opacity: Number(value) }
                : id === "fontSize"
                  ? { fontSize: Number(value) }
                  : {};
        this.toolPens[this.toolKind] = { ...this.toolPens[this.toolKind], ...patch };
    }

    deletePathVertex(elementId: string, nodeIndex: number): void {
        const element = this.scene.elements.find(({ id }) => id === elementId);
        if (
            element?.kind !== "path" ||
            !isStraightPathVertexEditable(element.path) ||
            nodeIndex < 0 ||
            nodeIndex >= element.path.nodes.length
        ) return;

        const nodes = element.path.nodes.filter((_, index) => index !== nodeIndex);
        if (nodes.length < 2) {
            this.apply({
                ...this.scene,
                elements: this.scene.elements.filter(({ id }) => id !== elementId),
            });
            this.selection = this.selection.filter((id) => id !== elementId);
        } else {
            const cyclic = element.path.cyclic && nodes.length >= 3;
            const joinCount = cyclic ? nodes.length : nodes.length - 1;
            this.apply({
                ...this.scene,
                elements: this.scene.elements.map((candidate) =>
                    candidate.id === elementId && candidate.kind === "path"
                        ? {
                              ...candidate,
                              path: {
                                  ...candidate.path,
                                  nodes,
                                  joins: Array.from({ length: joinCount }, () => "--" as const),
                                  cyclic,
                              },
                          }
                        : candidate,
                ),
            });
        }
        this.preview = null;
        this.selectionPreview = null;
        this.marquee = null;
        this.lineContinuation = null;
        this.arcGuide = null;
    }

    deleteSelected(): void {
        if (this.selection.length === 0) return;
        this.apply({
            ...this.scene,
            elements: this.scene.elements.filter((element) => !this.selection.includes(element.id)),
        });
        this.selection = [];
        this.selectionPreview = null;
        this.marquee = null;
        this.lineContinuation = null;
        this.arcGuide = null;
    }

    selectAll(): void {
        this.selection = this.scene.elements.map(({ id }) => id);
        this.preview = null;
        this.selectionPreview = null;
        this.marquee = null;
        this.lineContinuation = null;
        this.arcGuide = null;
    }

    clearAll(): void {
        this.apply(emptyScene());
        this.selection = [];
        this.selectionPreview = null;
        this.marquee = null;
        this.lineContinuation = null;
        this.arcGuide = null;
    }

    // --- asy codec ------------------------------------------------------------

    toAsy(): string {
        return serialize(snapshot(this.scene));
    }

    /** Replace the scene with the result of parsing asy (undoable). */
    loadAsy(asy: string): void {
        this.apply(parse(asy).scene);
        this.selection = [];
        this.selectionPreview = null;
        this.lineContinuation = null;
        this.arcGuide = null;
    }

    static fromAsy(asy: string): WhiteboardStore {
        return new WhiteboardStore(parse(asy).scene);
    }

    // --- persistence (localStorage, browser-only) -----------------------------

    persist(key: string): void {
        if (!browser) return;
        try {
            localStorage.setItem(key, JSON.stringify(snapshot(this.scene)));
        } catch {
            // best-effort; a full/blocked store must not break editing
        }
    }

    static restore(key: string): Scene | null {
        if (!browser) return null;
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw) as Scene;
            if (!parsed || !Array.isArray(parsed.elements)) return null;
            return parsed;
        } catch {
            return null;
        }
    }
}
