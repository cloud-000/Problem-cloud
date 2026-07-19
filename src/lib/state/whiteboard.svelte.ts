/**
 * Per-instance whiteboard store (like `LibraryStore`, not a global singleton):
 * a whiteboard is a scoped document editor and there may be more than one open
 * at once (e.g. a scratch overlay plus a "trace this diagram" board).
 *
 * It bridges the three pure-TS layers to the Svelte view:
 *   - document / selection / tool / pen are reactive `$state`
 *   - edits flow through the engine tools and are recorded in snapshot history
 *   - `toAsy` / `loadAsy` use the codec; `persist` / `restore` use localStorage
 *
 * SSR caveat (per repo conventions): never mutate at module load; all
 * localStorage access is `browser`-guarded.
 */

import { browser } from "$app/environment";
import type { Pen, Scene } from "$lib/asy/scene/types";
import { isStraightPathVertexEditable } from "$lib/asy/scene";
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
import {
    emptyWhiteboardDocument,
    addCoincidentConstraint,
    appendSmartPathNode,
    closeSmartPath,
    createSmartPath,
    createSmartPointMarker,
    deleteWhiteboardItems,
    migrateSceneToWhiteboardDocument,
    nearestPointFeature,
    parsePersistedWhiteboardDocument,
    pathNodeFeature,
    pointFeaturePointId,
    pointFeaturePosition,
    reconcileResolvedScene,
    removeConstraint,
    resolveWhiteboardDocument,
    solveWhiteboardDocument,
    type PointFeatureRef,
    type SnapRelationProposal,
    type WhiteboardDocument,
} from "$lib/whiteboard/model";

function documentSnapshot(document: WhiteboardDocument): WhiteboardDocument {
    return $state.snapshot(document) as WhiteboardDocument;
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
    document = $state<WhiteboardDocument>(emptyWhiteboardDocument());
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
    /** Visible inference feedback; never persisted or exported. */
    snapProposal = $state<{ from: readonly [number, number]; to: readonly [number, number] } | null>(null);
    selectedConstraintId = $state<string | null>(null);
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

    #history = new History<WhiteboardDocument>();
    #tool: Tool = createTool("select");
    #propertyBaseline: WhiteboardDocument | null = null;
    #smartDrag: {
        base: WhiteboardDocument;
        feature: PointFeatureRef;
        pointerOffset: readonly [number, number];
        candidate: SnapRelationProposal | null;
    } | null = null;
    #suppressSnapCommit = false;

    constructor(initial?: Scene | WhiteboardDocument) {
        if (initial) {
            this.document = "schemaVersion" in initial
                ? initial
                : migrateSceneToWhiteboardDocument(initial);
        }
    }

    /** Concrete compatibility IR for tools, rendering, hit-testing, and export. */
    get scene(): Scene {
        return resolveWhiteboardDocument(this.document);
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
        this.snapProposal = null;
        this.selectedConstraintId = null;
        this.toolKind = kind;
        if (kind !== "pan") this.#tool = createTool(kind);
    }

    // --- pointer plumbing (the view maps screen->asy before calling these) ----

    pointerDown(
        p: PointerInput,
        selectionTransform?: SelectionTransformGesture,
        suppressSnap = false,
    ): void {
        const point = "point" in p ? p.point : p;
        const smartFeature = selectionTransform?.kind === "vertex"
            ? pathNodeFeature(this.document, selectionTransform.elementId, selectionTransform.nodeIndex)
            : selectionTransform?.kind === "move" && this.selection.length === 1
              ? this.#markerFeature(this.selection[0])
              : null;
        if (smartFeature) {
            const at = pointFeaturePosition(this.document, smartFeature);
            if (!at) return;
            this.#smartDrag = {
                base: documentSnapshot(this.document),
                feature: smartFeature,
                pointerOffset: [point[0] - at[0], point[1] - at[1]],
                candidate: null,
            };
            this.preview = this.scene;
            this.selectedConstraintId = null;
            if (!suppressSnap) this.#previewSmartDrag(point, false);
            return;
        }
        this.selectedConstraintId = null;
        this.#suppressSnapCommit = suppressSnap;
        this.#dispatch(this.#tool.onPointerDown(this.scene, p, this.#ctx({ selectionTransform })));
        this.#suppressSnapCommit = false;
    }
    pointerMove(p: PointerInput, shiftKey = false, suppressSnap = false): void {
        if (this.#smartDrag) {
            this.#previewSmartDrag("point" in p ? p.point : p, suppressSnap);
            return;
        }
        this.#suppressSnapCommit = suppressSnap;
        this.#dispatch(this.#tool.onPointerMove(
            this.scene,
            p,
            this.#ctx({ snapRotation: shiftKey, lockAspectRatio: shiftKey }),
        ));
        this.#suppressSnapCommit = false;
    }
    pointerMoves(points: readonly PointerInput[], shiftKey = false, suppressSnap = false): void {
        if (points.length === 0) return;
        if (this.#smartDrag) {
            const last = points[points.length - 1];
            this.#previewSmartDrag("point" in last ? last.point : last, suppressSnap);
            return;
        }
        const ctx = this.#ctx({ snapRotation: shiftKey, lockAspectRatio: shiftKey });
        const result = this.#tool.onPointerMoves
            ? this.#tool.onPointerMoves(this.scene, points, ctx)
            : this.#tool.onPointerMove(this.scene, points[points.length - 1], ctx);
        this.#suppressSnapCommit = suppressSnap;
        this.#dispatch(result);
        this.#suppressSnapCommit = false;
    }
    pointerUp(
        p: PointerInput,
        shiftKey = false,
        pendingMoves: readonly PointerInput[] = [],
        suppressSnap = false,
    ): void {
        if (this.#smartDrag) {
            this.#commitSmartDrag("point" in p ? p.point : p, suppressSnap);
            return;
        }
        this.#suppressSnapCommit = suppressSnap;
        this.#dispatch(this.#tool.onPointerUp(
            this.scene,
            p,
            this.#ctx({ snapRotation: shiftKey, lockAspectRatio: shiftKey }),
            pendingMoves,
        ));
        this.#suppressSnapCommit = false;
    }
    cancel(): void {
        this.#smartDrag = null;
        this.snapProposal = null;
        this.#dispatch(this.#tool.onCancel());
    }

    #markerFeature(itemId: string): PointFeatureRef | null {
        const item = this.document.items.find((candidate) =>
            candidate.kind === "sketch-point-marker" && candidate.id === itemId
        );
        return item?.kind === "sketch-point-marker"
            ? { kind: "point", pointId: item.pointId }
            : null;
    }

    #smartDragTarget(point: readonly [number, number]): readonly [number, number] {
        if (!this.#smartDrag) return point;
        return [
            point[0] - this.#smartDrag.pointerOffset[0],
            point[1] - this.#smartDrag.pointerOffset[1],
        ];
    }

    #smartDragCandidate(
        target: readonly [number, number],
        suppressSnap: boolean,
    ): SnapRelationProposal | null {
        if (!this.#smartDrag || suppressSnap) return null;
        const acquired = this.#smartDrag.candidate;
        const acquiredAt = acquired
            ? pointFeaturePosition(this.#smartDrag.base, acquired.target)
            : null;
        if (
            acquired && acquiredAt &&
            Math.hypot(acquiredAt[0] - target[0], acquiredAt[1] - target[1]) <=
                12 * this.sceneUnitsPerPixel
        ) {
            return { ...acquired, from: target, to: acquiredAt };
        }
        const candidate = nearestPointFeature(
            this.#smartDrag.base,
            target,
            8 * this.sceneUnitsPerPixel,
            this.#smartDrag.feature,
        );
        return candidate ? {
            source: this.#smartDrag.feature,
            target: candidate.ref,
            from: target,
            to: candidate.at,
        } : null;
    }

    #previewSmartDrag(point: readonly [number, number], suppressSnap: boolean): void {
        if (!this.#smartDrag) return;
        const rawTarget = this.#smartDragTarget(point);
        const candidate = this.#smartDragCandidate(rawTarget, suppressSnap);
        this.#smartDrag.candidate = candidate;
        const target = candidate?.to ?? rawTarget;
        const solved = solveWhiteboardDocument(this.#smartDrag.base, {
            affected: [this.#smartDrag.feature],
            drivers: [{ feature: this.#smartDrag.feature, target }],
            mode: "preview",
        });
        this.preview = solved.document ? resolveWhiteboardDocument(solved.document) : this.scene;
        this.snapProposal = candidate ? { from: rawTarget, to: candidate.to } : null;
    }

    #commitSmartDrag(point: readonly [number, number], suppressSnap: boolean): void {
        if (!this.#smartDrag) return;
        const drag = this.#smartDrag;
        const rawTarget = this.#smartDragTarget(point);
        const candidate = this.#smartDragCandidate(rawTarget, suppressSnap);
        const solved = solveWhiteboardDocument(drag.base, {
            affected: [drag.feature],
            drivers: [{ feature: drag.feature, target: candidate?.to ?? rawTarget }],
            mode: "commit",
        });
        this.#smartDrag = null;
        this.preview = null;
        this.snapProposal = null;
        if (!solved.document) {
            if (solved.diagnostic) console.info(`[Whiteboard] ${solved.diagnostic}`);
            return;
        }
        const committed = candidate
            ? addCoincidentConstraint(solved.document, drag.feature, candidate.target, "inferred")
            : solved.document;
        if (committed) this.applyDocument(committed);
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
        const priorContinuation = this.lineContinuation;
        if (result.consoleMessage) console.info(result.consoleMessage);
        if (result.selection !== undefined) this.selection = result.selection;
        if (result.selectionPreview !== undefined) this.selectionPreview = result.selectionPreview;
        if (result.marquee !== undefined) this.marquee = result.marquee;
        if (result.lineContinuation !== undefined) {
            this.lineContinuation = result.lineContinuation;
        }
        if (result.arcGuide !== undefined) this.arcGuide = result.arcGuide;
        if (result.commit !== undefined) {
            const smartCommit = this.#smartToolCommit(result.commit, priorContinuation);
            if (smartCommit) this.applyDocument(smartCommit);
            else this.apply(result.commit);
            this.preview = null;
            this.snapProposal = null;
            this.selectionPreview = null;
            this.marquee = null;
            if (result.nextTool) {
                const continuation = result.lineContinuation;
                this.setTool(result.nextTool);
                if (continuation !== undefined) this.lineContinuation = continuation;
            }
        } else if (result.preview !== undefined) {
            this.preview = this.#snapCreationPreview(result.preview);
        }
    }

    #smartToolCommit(scene: Scene, priorContinuation: LineContinuation | null): WhiteboardDocument | null {
        if (this.toolKind === "select" && priorContinuation) {
            const item = this.document.items.find((candidate) =>
                candidate.kind === "sketch-path" && candidate.id === priorContinuation.elementId
            );
            if (item?.kind === "sketch-path") {
                const committedPath = scene.elements.find((element) =>
                    element.id === item.id && element.kind === "path"
                );
                if (committedPath?.kind !== "path") return null;
                if (committedPath.path.cyclic && !item.cyclic) {
                    return closeSmartPath(this.document, item.id);
                }
                if (committedPath.path.nodes.length === item.uses.length + 2) {
                    const at = committedPath.path.nodes.at(-1)!;
                    const appended = appendSmartPathNode(this.document, item.id, at);
                    return this.#conjoinCreatedFeature(appended.document, appended.feature, this.document);
                }
            }
        }

        const currentIds = this.scene.elements.map(({ id }) => id);
        const added = scene.elements.find((element) => !currentIds.includes(element.id));
        if (this.toolKind === "line" && added?.kind === "path") {
            const created = createSmartPath(
                this.document,
                added.path.nodes,
                false,
                added.pen,
                added.fillPen,
                added.id,
            );
            return this.#conjoinCreatedFeatures(created.document, created.endpointFeatures, this.document);
        }
        if (this.toolKind === "rectangle" && added?.kind === "path") {
            const rawStart = added.path.nodes[0];
            const rawEnd = added.path.nodes[2];
            if (!rawStart || !rawEnd) return null;
            const snappedStart = this.#suppressSnapCommit
                ? rawStart
                : nearestPointFeature(this.document, rawStart, 8 * this.sceneUnitsPerPixel)?.at ?? rawStart;
            const snappedEnd = this.#suppressSnapCommit
                ? rawEnd
                : nearestPointFeature(this.document, rawEnd, 8 * this.sceneUnitsPerPixel)?.at ?? rawEnd;
            const created = createSmartPath(
                this.document,
                [
                    snappedStart,
                    [snappedEnd[0], snappedStart[1]],
                    snappedEnd,
                    [snappedStart[0], snappedEnd[1]],
                ],
                true,
                added.pen,
                added.fillPen,
                added.id,
            );
            return this.#conjoinCreatedFeatures(
                created.document,
                [created.endpointFeatures[0], created.endpointFeatures[2]].filter(
                    (feature): feature is PointFeatureRef => feature !== undefined,
                ),
                this.document,
            );
        }
        if (this.toolKind === "point" && added?.kind === "dot") {
            const created = createSmartPointMarker(this.document, added.at, added.pen, added.id);
            return this.#conjoinCreatedFeatures(created.document, created.endpointFeatures, this.document);
        }
        return null;
    }

    #conjoinCreatedFeatures(
        document: WhiteboardDocument,
        features: readonly PointFeatureRef[],
        candidateSource: WhiteboardDocument,
    ): WhiteboardDocument {
        return features.reduce(
            (current, feature) => this.#conjoinCreatedFeature(current, feature, candidateSource),
            document,
        );
    }

    #conjoinCreatedFeature(
        document: WhiteboardDocument,
        feature: PointFeatureRef,
        candidateSource: WhiteboardDocument,
    ): WhiteboardDocument {
        if (this.#suppressSnapCommit) return document;
        const at = pointFeaturePosition(document, feature);
        if (!at) return document;
        const candidate = nearestPointFeature(
            candidateSource,
            at,
            8 * this.sceneUnitsPerPixel,
        );
        if (!candidate) return document;
        const pointId = pointFeaturePointId(document, feature);
        if (!pointId) return document;
        const points = {
            ...document.sketch.points,
            [pointId]: { ...document.sketch.points[pointId], at: candidate.at },
        };
        const positioned = { ...document, sketch: { ...document.sketch, points } };
        return addCoincidentConstraint(positioned, feature, candidate.ref, "inferred") ?? document;
    }

    #snapCreationPreview(scene: Scene | null): Scene | null {
        if (!scene || (this.toolKind !== "line" && this.toolKind !== "rectangle" && this.toolKind !== "point")) {
            this.snapProposal = null;
            return scene;
        }
        const currentIds = this.scene.elements.map(({ id }) => id);
        const added = scene.elements.findLast((element) => !currentIds.includes(element.id));
        if (!added) return scene;
        const at = added.kind === "dot"
            ? added.at
            : added.kind === "path"
              ? added.path.nodes[this.toolKind === "rectangle" ? 2 : added.path.nodes.length - 1]
              : undefined;
        if (!at) {
            this.snapProposal = null;
            return scene;
        }
        const candidate = nearestPointFeature(this.document, at, 8 * this.sceneUnitsPerPixel);
        if (!candidate) {
            this.snapProposal = null;
            return scene;
        }
        const addedId = added.id;
        this.snapProposal = { from: at, to: candidate.at };
        return {
            ...scene,
            elements: scene.elements.map((element) => {
                if (element.id !== addedId) return element;
                if (element.kind === "dot") return { ...element, at: candidate.at };
                if (element.kind === "path") {
                    const start = element.path.nodes[0];
                    const nodes = this.toolKind === "rectangle" && start
                        ? [
                              start,
                              [candidate.at[0], start[1]] as const,
                              candidate.at,
                              [start[0], candidate.at[1]] as const,
                          ]
                        : element.path.nodes.map((node, index) =>
                              index === element.path.nodes.length - 1 ? candidate.at : node
                          );
                    return { ...element, path: { ...element.path, nodes } };
                }
                return element;
            }),
        };
    }

    // --- history --------------------------------------------------------------

    /** Reconcile a legacy Scene operation without flattening canonical smart items. */
    apply(next: Scene): void {
        try {
            this.applyDocument(reconcileResolvedScene(documentSnapshot(this.document), next));
        } catch (error) {
            console.info(`[Whiteboard] ${error instanceof Error ? error.message : "unsupported smart edit"}`);
        }
    }

    applyDocument(next: WhiteboardDocument): void {
        this.#history.push(documentSnapshot(this.document));
        this.document = next;
        this.#syncFlags();
    }

    undo(): void {
        const prev = this.#history.undo(documentSnapshot(this.document));
        if (prev) {
            this.document = prev;
            this.selection = [];
            this.preview = null;
            this.selectionPreview = null;
            this.lineContinuation = null;
            this.arcGuide = null;
            this.selectedConstraintId = null;
            this.snapProposal = null;
        }
        this.#syncFlags();
    }

    redo(): void {
        const next = this.#history.redo(documentSnapshot(this.document));
        if (next) {
            this.document = next;
            this.selection = [];
            this.preview = null;
            this.selectionPreview = null;
            this.lineContinuation = null;
            this.arcGuide = null;
            this.selectedConstraintId = null;
            this.snapProposal = null;
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
        const base = this.#propertyBaseline
            ? resolveWhiteboardDocument(this.#propertyBaseline)
            : this.scene;
        const next = {
            ...base,
            elements: base.elements.map((element) => this.selection.includes(element.id)
                ? writeElementProperty(element, id, value)
                : element),
        };
        if (this.#propertyBaseline) {
            try {
                this.document = reconcileResolvedScene(this.#propertyBaseline, next);
            } catch (error) {
                console.info(`[Whiteboard] ${error instanceof Error ? error.message : "unsupported smart edit"}`);
            }
        }
        else this.apply(next);
    }

    beginPropertyEdit(): void {
        if (this.selection.length > 0 && !this.#propertyBaseline) {
            this.#propertyBaseline = documentSnapshot(this.document);
        }
    }

    commitPropertyEdit(): void {
        if (!this.#propertyBaseline) return;
        const baseline = this.#propertyBaseline;
        this.#propertyBaseline = null;
        if (JSON.stringify(baseline) !== JSON.stringify(documentSnapshot(this.document))) {
            this.#history.push(baseline);
            this.#syncFlags();
        }
    }

    cancelPropertyEdit(): void {
        if (!this.#propertyBaseline) return;
        this.document = this.#propertyBaseline;
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
        const smartFeature = pathNodeFeature(this.document, elementId, nodeIndex);
        if (smartFeature) {
            // Structural smart-path vertex deletion changes topology and remains deferred.
            return;
        }
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
        if (this.selectedConstraintId) {
            this.deleteSelectedConstraint();
            return;
        }
        if (this.selection.length === 0) return;
        this.applyDocument(deleteWhiteboardItems(this.document, this.selection));
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
        this.applyDocument(emptyWhiteboardDocument());
        this.selection = [];
        this.selectionPreview = null;
        this.marquee = null;
        this.lineContinuation = null;
        this.arcGuide = null;
    }

    get constraintGlyphs(): Array<{
        id: string;
        at: readonly [number, number];
        a: readonly [number, number];
        b: readonly [number, number];
        selected: boolean;
    }> {
        return Object.values(this.document.sketch.constraints).flatMap((constraint) => {
            if (!constraint.enabled || constraint.kind !== "coincident") return [];
            const a = pointFeaturePosition(this.document, constraint.a);
            const b = pointFeaturePosition(this.document, constraint.b);
            if (!a || !b) return [];
            return [{
                id: constraint.id,
                at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const,
                a,
                b,
                selected: this.selectedConstraintId === constraint.id,
            }];
        });
    }

    selectConstraint(id: string | null): void {
        this.selectedConstraintId = id && this.document.sketch.constraints[id] ? id : null;
        if (this.selectedConstraintId) this.selection = [];
    }

    updateSnapProposal(at: readonly [number, number], suppressSnap = false): void {
        if (suppressSnap || !["line", "rectangle", "point"].includes(this.toolKind)) {
            this.snapProposal = null;
            return;
        }
        const candidate = nearestPointFeature(this.document, at, 8 * this.sceneUnitsPerPixel);
        this.snapProposal = candidate ? { from: at, to: candidate.at } : null;
    }

    deleteSelectedConstraint(): void {
        if (!this.selectedConstraintId) return;
        const next = removeConstraint(this.document, this.selectedConstraintId);
        if (next !== this.document) this.applyDocument(next);
        this.selectedConstraintId = null;
        this.snapProposal = null;
    }

    // --- asy codec ------------------------------------------------------------

    toAsy(): string {
        return serialize(resolveWhiteboardDocument(documentSnapshot(this.document)));
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
            localStorage.setItem(key, JSON.stringify(documentSnapshot(this.document)));
        } catch {
            // best-effort; a full/blocked store must not break editing
        }
    }

    static restore(key: string): WhiteboardDocument | null {
        if (!browser) return null;
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            return parsePersistedWhiteboardDocument(JSON.parse(raw));
        } catch {
            return null;
        }
    }
}
