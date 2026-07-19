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
    hitTest,
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
    addLengthDimension,
    addRelationConstraint,
    applicableRelationActions,
    contextualRelationActions,
    appendSmartPathNode,
    closeSmartPath,
    createSmartPath,
    createSmartPointMarker,
    deleteWhiteboardItems,
    editDrivingLengthDimension,
    featureKey,
    lengthDimensionValue,
    lengthDimensionsForSelection,
    migrateSceneToWhiteboardDocument,
    nearestPointFeature,
    nearestSegmentFeature,
    parsePersistedWhiteboardDocument,
    pathNodeFeature,
    pointFeaturePointId,
    pointFeaturePosition,
    reconcileResolvedScene,
    removeConstraint,
    removeLengthDimension,
    resolveWhiteboardDocument,
    solveWhiteboardDocument,
    switchDirectionalRelationConstraint,
    translateWhiteboardItems,
    updateSmartPresentationStyle,
    type FeatureRef,
    type GeometryOperationResult,
    type RelationKind,
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
    featureSelection = $state<FeatureRef[]>([]);
    selectedDimensionId = $state<string | null>(null);
    solverDiagnostic = $state<string | null>(null);
    conflictingConstraintIds = $state<string[]>([]);
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
    #smartTranslation: {
        base: WhiteboardDocument;
        start: readonly [number, number];
        itemIds: string[];
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
        const changed = kind !== this.toolKind;
        this.commitPropertyEdit();
        this.#tool.onCancel();
        this.preview = null;
        this.selectionPreview = null;
        this.marquee = null;
        this.lineContinuation = null;
        this.arcGuide = null;
        this.snapProposal = null;
        this.selectedConstraintId = null;
        this.selectedDimensionId = null;
        this.featureSelection = [];
        if (changed) this.selection = [];
        this.toolKind = kind;
        if (kind !== "pan") this.#tool = createTool(kind);
    }

    // --- pointer plumbing (the view maps screen->asy before calling these) ----

    pointerDown(
        p: PointerInput,
        selectionTransform?: SelectionTransformGesture,
        suppressSnap = false,
        additiveFeatureSelection = false,
    ): void {
        const point = "point" in p ? p.point : p;
        const directMoveIds = !selectionTransform && this.toolKind === "select" && !this.lineContinuation
            ? (() => {
                  const hit = hitTest(this.scene, point, this.tolerance);
                  if (!hit || hit.kind === "raw") return null;
                  return this.selection.includes(hit.id) ? [...this.selection] : [hit.id];
              })()
            : null;
        const movingIds = selectionTransform?.kind === "move"
            ? [...this.selection]
            : directMoveIds;
        const smartFeature = selectionTransform?.kind === "vertex"
            ? pathNodeFeature(this.document, selectionTransform.elementId, selectionTransform.nodeIndex)
            : movingIds?.length === 1
              ? this.#markerFeature(movingIds[0])
              : null;
        if (movingIds && !smartFeature && this.#selectionHasSmartItems(movingIds)) {
            if (directMoveIds) this.#selectForDirectMove(directMoveIds);
            this.#smartTranslation = {
                base: documentSnapshot(this.document),
                start: point,
                itemIds: movingIds,
            };
            this.preview = this.scene;
            this.selectedConstraintId = null;
            this.selectedDimensionId = null;
            return;
        }
        if (smartFeature) {
            if (directMoveIds) this.#selectForDirectMove(directMoveIds);
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
            this.selectFeature(smartFeature, additiveFeatureSelection);
            if (!suppressSnap) this.#previewSmartDrag(point, false);
            return;
        }
        this.selectedConstraintId = null;
        this.#suppressSnapCommit = suppressSnap;
        this.#dispatch(this.#tool.onPointerDown(this.scene, p, this.#ctx({ selectionTransform })));
        this.#suppressSnapCommit = false;
    }
    pointerMove(p: PointerInput, shiftKey = false, suppressSnap = false): void {
        if (this.#smartTranslation) {
            this.#previewSmartTranslation("point" in p ? p.point : p);
            return;
        }
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
        if (this.#smartTranslation) {
            const last = points[points.length - 1];
            this.#previewSmartTranslation("point" in last ? last.point : last);
            return;
        }
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
        if (this.#smartTranslation) {
            this.#commitSmartTranslation("point" in p ? p.point : p);
            return;
        }
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
        this.#smartTranslation = null;
        this.snapProposal = null;
        this.clearFeatureSelection();
        this.#dispatch(this.#tool.onCancel());
    }

    clearFeatureSelection(): void {
        this.featureSelection = [];
        this.solverDiagnostic = null;
        this.conflictingConstraintIds = [];
    }

    #selectionHasSmartItems(itemIds: readonly string[] = this.selection): boolean {
        return this.document.items.some((item) => item.kind !== "baked" && itemIds.includes(item.id));
    }

    #selectForDirectMove(itemIds: string[]): void {
        this.selection = itemIds;
        this.featureSelection = [];
        this.selectedDimensionId = null;
    }

    #translationDelta(point: readonly [number, number]): readonly [number, number] {
        return this.#smartTranslation
            ? [point[0] - this.#smartTranslation.start[0], point[1] - this.#smartTranslation.start[1]]
            : [0, 0];
    }

    #previewSmartTranslation(point: readonly [number, number]): void {
        if (!this.#smartTranslation) return;
        const result = translateWhiteboardItems(
            this.#smartTranslation.base,
            this.#smartTranslation.itemIds,
            this.#translationDelta(point),
            "preview",
        );
        this.preview = result.document ? resolveWhiteboardDocument(result.document) : this.scene;
        this.#setSolverResult(result);
    }

    #commitSmartTranslation(point: readonly [number, number]): void {
        if (!this.#smartTranslation) return;
        const drag = this.#smartTranslation;
        const result = translateWhiteboardItems(
            drag.base,
            drag.itemIds,
            this.#translationDelta(point),
            "commit",
        );
        this.#smartTranslation = null;
        this.preview = null;
        this.#setSolverResult(result);
        if (result.document && JSON.stringify(result.document) !== JSON.stringify(drag.base)) {
            this.applyDocument(result.document);
        }
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
        this.#setSolverResult(solved);
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
        this.#setSolverResult(solved);
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
        if (committed && JSON.stringify(committed) !== JSON.stringify(drag.base)) this.applyDocument(committed);
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
        if (result.selection !== undefined) {
            this.selection = result.selection;
            this.featureSelection = [];
            this.selectedDimensionId = null;
        }
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
                const committedSelection = result.selection;
                this.setTool(result.nextTool);
                if (committedSelection !== undefined) this.selection = committedSelection;
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
            this.selectedDimensionId = null;
            this.featureSelection = [];
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
            this.selectedDimensionId = null;
            this.featureSelection = [];
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
        const baseDocument = this.#propertyBaseline ?? documentSnapshot(this.document);
        const baseScene = resolveWhiteboardDocument(baseDocument);
        let next = baseDocument;
        for (const element of baseScene.elements) {
            if (!this.selection.includes(element.id)) continue;
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
        if (this.#propertyBaseline) this.document = next;
        else if (JSON.stringify(next) !== JSON.stringify(baseDocument)) this.applyDocument(next);
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
        if (this.selectedDimensionId) {
            const next = removeLengthDimension(this.document, this.selectedDimensionId);
            if (next !== this.document) this.applyDocument(next);
            this.selectedDimensionId = null;
            return;
        }
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
            if (!constraint.enabled) return [];
            let a: readonly [number, number] | null = null;
            let b: readonly [number, number] | null = null;
            if (constraint.kind === "coincident" || constraint.kind === "distance") {
                a = pointFeaturePosition(this.document, constraint.a);
                b = pointFeaturePosition(this.document, constraint.b);
            } else if (constraint.kind === "fixed-point") {
                a = pointFeaturePosition(this.document, constraint.point);
                b = a;
            } else if (constraint.kind === "horizontal" || constraint.kind === "vertical") {
                const refs = this.#curvePointRefs(constraint.curveId);
                a = refs ? pointFeaturePosition(this.document, refs[0]) : null;
                b = refs ? pointFeaturePosition(this.document, refs[1]) : null;
            } else if (
                constraint.kind === "parallel" || constraint.kind === "perpendicular" ||
                constraint.kind === "equal-length" || constraint.kind === "angle"
            ) {
                a = this.#curveMidpoint(constraint.a);
                b = this.#curveMidpoint(constraint.b);
            } else return [];
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

    #curvePointRefs(curveId: string): [PointFeatureRef, PointFeatureRef] | null {
        const curve = this.document.sketch.curves[curveId];
        return curve?.kind === "segment" ? [
            { kind: "curve-point", curveId, feature: "start" },
            { kind: "curve-point", curveId, feature: "end" },
        ] : null;
    }

    #curveMidpoint(curveId: string): readonly [number, number] | null {
        const refs = this.#curvePointRefs(curveId);
        if (!refs) return null;
        const a = pointFeaturePosition(this.document, refs[0]);
        const b = pointFeaturePosition(this.document, refs[1]);
        return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null;
    }

    get dimensionGlyphs(): Array<{
        id: string;
        a: readonly [number, number];
        b: readonly [number, number];
        at: readonly [number, number];
        value: number;
        mode: "driving" | "reference";
        selected: boolean;
    }> {
        return Object.values(this.document.dimensions ?? {}).flatMap((dimension) => {
            const a = pointFeaturePosition(this.document, dimension.a);
            const b = pointFeaturePosition(this.document, dimension.b);
            const value = lengthDimensionValue(this.document, dimension.id);
            if (!a || !b || value === null) return [];
            const offset = dimension.labelOffset ?? [0, 0];
            return [{
                id: dimension.id,
                a,
                b,
                at: [(a[0] + b[0]) / 2 + offset[0], (a[1] + b[1]) / 2 + offset[1]],
                value,
                mode: dimension.mode,
                selected: this.selectedDimensionId === dimension.id,
            }];
        });
    }

    get applicableRelationActions() {
        return applicableRelationActions(this.document, this.featureSelection);
    }

    get contextualRelationActions() {
        return contextualRelationActions(this.document, this.featureSelection);
    }

    get selectedFeatureGeometry(): {
        points: Array<readonly [number, number]>;
        segments: Array<{ a: readonly [number, number]; b: readonly [number, number] }>;
    } {
        const points: Array<readonly [number, number]> = [];
        const segments: Array<{ a: readonly [number, number]; b: readonly [number, number] }> = [];
        for (const feature of this.featureSelection) {
            if (feature.kind !== "curve") {
                const at = pointFeaturePosition(this.document, feature);
                if (at) points.push(at);
                continue;
            }
            const refs = this.#curvePointRefs(feature.curveId);
            const a = refs ? pointFeaturePosition(this.document, refs[0]) : null;
            const b = refs ? pointFeaturePosition(this.document, refs[1]) : null;
            if (a && b) segments.push({ a, b });
        }
        return { points, segments };
    }

    get canDimensionSelection(): boolean {
        if (this.featureSelection.length === 1 && this.featureSelection[0].kind === "curve") {
            return this.document.sketch.curves[this.featureSelection[0].curveId]?.kind === "segment";
        }
        return this.featureSelection.length === 2 && this.featureSelection.every((feature) => feature.kind !== "curve");
    }

    get selectedFeatureDimensions() {
        return lengthDimensionsForSelection(this.document, this.featureSelection).flatMap((dimension) => {
            const value = lengthDimensionValue(this.document, dimension.id);
            return value === null ? [] : [{ ...dimension, value }];
        });
    }

    selectFeature(feature: FeatureRef, additive = false): void {
        const key = featureKey(feature);
        if (!additive) this.featureSelection = [feature];
        else if (this.featureSelection.some((selected) => featureKey(selected) === key)) {
            this.featureSelection = this.featureSelection.filter((selected) => featureKey(selected) !== key);
        } else this.featureSelection = [...this.featureSelection, feature];
        this.selectedConstraintId = null;
        this.selectedDimensionId = null;
    }

    selectCurveFeatureForItem(itemId: string, additive = false): void {
        const item = this.document.items.find((candidate) => candidate.kind !== "baked" && candidate.id === itemId);
        const curveId = item?.kind === "sketch-path" ? item.uses[0]?.curveId
            : item?.kind === "sketch-curve" ? item.curveId : undefined;
        if (curveId && this.document.sketch.curves[curveId]?.kind === "segment") {
            this.selectFeature({ kind: "curve", curveId }, additive);
        }
    }

    selectCurveFeatureAt(itemId: string, at: readonly [number, number], additive = false): void {
        const feature = nearestSegmentFeature(this.document, at, 8 * this.sceneUnitsPerPixel, itemId);
        if (feature) this.selectFeature(feature.ref, additive);
    }

    selectFeatureAtItem(itemId: string, at: readonly [number, number], additive = false): void {
        const marker = this.#markerFeature(itemId);
        if (marker) {
            this.selectFeature(marker, additive);
            return;
        }
        this.selectCurveFeatureAt(itemId, at, additive);
    }

    #setSolverResult(result: GeometryOperationResult): void {
        this.solverDiagnostic = result.diagnostic ?? (result.status === "under-constrained"
            ? `Geometry remains under-constrained${result.degreesOfFreedom === undefined ? "" : ` (${result.degreesOfFreedom} DOF)`}`
            : null);
        this.conflictingConstraintIds = [...result.conflictingConstraintIds];
    }

    applyRelation(kind: RelationKind): boolean {
        const result = addRelationConstraint(documentSnapshot(this.document), kind, this.featureSelection);
        this.#setSolverResult(result);
        if (!result.document || JSON.stringify(result.document) === JSON.stringify(documentSnapshot(this.document))) return false;
        this.applyDocument(result.document);
        return true;
    }

    toggleRelation(kind: RelationKind): boolean {
        const active = this.contextualRelationActions.find((action) => action.kind === kind)?.constraintId;
        if (active) return this.removeRelationConstraint(active);
        if (kind === "horizontal" || kind === "vertical") {
            const opposite = kind === "horizontal" ? "vertical" : "horizontal";
            const replaced = this.contextualRelationActions.find((action) => action.kind === opposite)?.constraintId;
            if (replaced) {
                const result = switchDirectionalRelationConstraint(
                    documentSnapshot(this.document),
                    kind,
                    this.featureSelection,
                    replaced,
                );
                this.#setSolverResult(result);
                if (!result.document) return false;
                this.applyDocument(result.document);
                return true;
            }
        }
        return this.applyRelation(kind);
    }

    removeRelationConstraint(constraintId: string): boolean {
        const next = removeConstraint(this.document, constraintId);
        if (next === this.document) return false;
        this.applyDocument(next);
        if (this.selectedConstraintId === constraintId) this.selectedConstraintId = null;
        this.solverDiagnostic = null;
        this.conflictingConstraintIds = [];
        return true;
    }

    addLengthDimension(mode: "driving" | "reference"): boolean {
        const result = addLengthDimension(documentSnapshot(this.document), this.featureSelection, mode);
        this.#setSolverResult(result);
        if (!result.document) return false;
        const newId = Object.keys(result.document.dimensions ?? {}).find((id) => !this.document.dimensions?.[id]);
        this.applyDocument(result.document);
        this.selectedDimensionId = newId ?? null;
        this.selectedConstraintId = null;
        return true;
    }

    removeDimension(dimensionId: string): boolean {
        const next = removeLengthDimension(this.document, dimensionId);
        if (next === this.document) return false;
        this.applyDocument(next);
        if (this.selectedDimensionId === dimensionId) this.selectedDimensionId = null;
        this.solverDiagnostic = null;
        this.conflictingConstraintIds = [];
        return true;
    }

    editDimension(dimensionId: string, value: number): boolean {
        const result = editDrivingLengthDimension(documentSnapshot(this.document), dimensionId, value);
        this.#setSolverResult(result);
        if (!result.document) return false;
        this.applyDocument(result.document);
        this.selectedDimensionId = dimensionId;
        return true;
    }

    selectDimension(id: string | null): void {
        this.selectedDimensionId = id && this.document.dimensions?.[id] ? id : null;
        if (this.selectedDimensionId) {
            this.selectedConstraintId = null;
            this.selection = [];
        }
    }

    selectConstraint(id: string | null): void {
        this.selectedConstraintId = id && this.document.sketch.constraints[id] ? id : null;
        if (this.selectedConstraintId) this.selection = [];
        if (this.selectedConstraintId) this.selectedDimensionId = null;
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
        this.removeRelationConstraint(this.selectedConstraintId);
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
