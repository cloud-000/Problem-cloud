import { SvelteMap } from "svelte/reactivity";
import type { Bounds, Pair } from "$lib/asy/scene";
import { hitTest, PointerSampleBatcher, type PointerSample } from "$lib/asy/engine";
import type { WhiteboardStore } from "$lib/state/whiteboard.svelte";
import type { Camera } from "./camera.svelte";
import { isArcGuideAt, isRotationHandleAt, isScreenPointInRect, resizeHandleAt } from "./render";
import type {
    ArcControl,
    ArcControlRef,
    OverlayResizeHandle,
    OverlayRotationControl,
    OverlayVertexHandle,
    ResizeCursor,
    VertexRef,
    WhiteboardOverlay,
} from "./overlay-model";

/** The gesture the canvas is currently in the middle of. */
export type InteractionMode = "idle" | "draw" | "transform" | "pan" | "pinch";

export type TransformCursor = ResizeCursor | "grab" | "grabbing" | "move";

/**
 * What a pointer-down landed on, decided by one hit-test pass. Each kind maps
 * to exactly one gesture-opening branch.
 */
type PointerHit =
    | { kind: "dimension"; id: string }
    | { kind: "constraint"; id: string }
    | { kind: "arc-control"; elementId: string; control: ArcControl; handle: Pair | null }
    | { kind: "vertex"; handle: OverlayVertexHandle }
    | { kind: "resize"; handle: OverlayResizeHandle; bounds: Bounds }
    | { kind: "rotation"; control: OverlayRotationControl }
    | { kind: "selection-body" }
    | { kind: "canvas" };

/**
 * What `pointer-input` needs from `whiteboard.svelte`. Everything here is state
 * the component owns (its props, its canvas, its keyboard state) or a read
 * model it computes; the adapter owns only the pointer gesture itself.
 */
export interface PointerInputHost {
    get store(): WhiteboardStore;
    get camera(): Camera;
    get surface(): HTMLCanvasElement | null;
    /** Screen-space overlay geometry, for handle hit-testing. */
    get overlay(): WhiteboardOverlay;
    /** Whether viewport gestures (pan/pinch/zoom) are enabled. */
    get navigation(): boolean;
    get spacePressed(): boolean;
    /** The vertex whose handle survives the current selection, if any. */
    get activeSelectedVertex(): VertexRef | null;
    /** This canvas just took the pointer, so it owns keyboard shortcuts. */
    onSurfaceActivated(): void;
    /** A canvas gesture cleared the feature selection under the toolbar. */
    closeLengthMenu(): void;
}

/**
 * Pointer/DOM plumbing for the whiteboard canvas: pointer capture, the
 * interaction mode, touch/pinch bookkeeping, pen sample batching, and the
 * translation of DOM events into Camera-mapped, asy-space calls on the store.
 *
 * It owns no geometry math (that is `Camera` / `overlay-model`) and no model
 * logic (that is the store) — it only decides *which* gesture a pointer-down
 * opens and forwards it.
 */
export class PointerInputController {
    #host: PointerInputHost;

    #pointerId = $state<number | null>(null);
    #mode = $state<InteractionMode>("idle");
    #transformCursor = $state<TransformCursor | null>(null);
    #eraserPointer = $state<Pair | null>(null);
    #selectedVertex = $state<VertexRef | null>(null);
    #hoveredVertex = $state<VertexRef | null>(null);
    #selectedArcControl = $state<ArcControlRef | null>(null);
    #hoveredArcControl = $state<ArcControlRef | null>(null);
    #activeArcPointer = $state<Pair | null>(null);

    #panStart: { clientX: number; clientY: number; x: number; y: number } | null = null;
    #featureClickStart:
        | { screen: Pair; selection: WhiteboardStore["featureSelection"] }
        | null = null;
    #activeTouches = new SvelteMap<number, { clientX: number; clientY: number }>();
    #penSamples: PointerSampleBatcher<PointerSample>;

    constructor(host: PointerInputHost) {
        this.#host = host;
        this.#penSamples = new PointerSampleBatcher<PointerSample>(
            (points) => {
                const { store } = this.#host;
                if (this.#mode === "draw" && store.toolKind === "pen") store.pointerMoves(points);
            },
            (callback) => requestAnimationFrame(callback),
            (handle) => cancelAnimationFrame(handle),
        );
    }

    get mode(): InteractionMode {
        return this.#mode;
    }

    /** Cursor override while a transform affordance is hovered or dragged. */
    get transformCursor(): TransformCursor | null {
        return this.#transformCursor;
    }

    /** Canvas-local position of the eraser puck, or `null` when it is hidden. */
    get eraserPointer(): Pair | null {
        return this.#eraserPointer;
    }

    get selectedVertex(): VertexRef | null {
        return this.#selectedVertex;
    }

    get hoveredVertex(): VertexRef | null {
        return this.#hoveredVertex;
    }

    get selectedArcControl(): ArcControlRef | null {
        return this.#selectedArcControl;
    }

    get activeArcPointer(): Pair | null {
        return this.#activeArcPointer;
    }

    get hoveredArcControl(): ArcControlRef | null {
        return this.#hoveredArcControl;
    }

    // --- lifecycle / shared entry points ------------------------------------

    /** Drop any batched pen samples (surface teardown, Escape, select-all). */
    cancelPenBatch(): void {
        this.#penSamples.cancel();
    }

    /** Forget the vertex/arc handle selection and hover. */
    clearHandleSelection(): void {
        this.#selectedVertex = null;
        this.#hoveredVertex = null;
        this.#selectedArcControl = null;
        this.#hoveredArcControl = null;
        this.#activeArcPointer = null;
    }

    /** Abandon an in-flight draw/transform gesture without committing it. */
    abortGesture(): void {
        if (this.#mode !== "draw" && this.#mode !== "transform") return;
        if (this.#pointerId !== null) this.#release(this.#pointerId);
        this.#pointerId = null;
        this.#transformCursor = null;
        this.#mode = "idle";
    }

    dispose(): void {
        this.#penSamples.cancel();
    }

    // --- pointer capture -----------------------------------------------------

    #capture(id: number) {
        try {
            this.#host.surface?.setPointerCapture(id);
        } catch {
            // Pointer capture is best-effort on some touch browsers.
        }
    }

    #release(id: number) {
        const surface = this.#host.surface;
        if (!surface?.hasPointerCapture(id)) return;
        try {
            surface.releasePointerCapture(id);
        } catch {
            // The browser may already have released it.
        }
    }

    // --- coordinate mapping (delegated to the Camera) ------------------------

    #local(e: { clientX: number; clientY: number }): Pair {
        return this.#host.camera.localPoint(e.clientX, e.clientY);
    }

    #asy(e: { clientX: number; clientY: number }): Pair {
        return this.#host.camera.toAsy(e.clientX, e.clientY);
    }

    #sample(e: PointerEvent): PointerSample {
        const pressure = e.pointerType === "pen" && Number.isFinite(e.pressure) && e.pressure > 0
            ? Math.max(0, Math.min(1, e.pressure))
            : undefined;
        return {
            point: this.#asy(e),
            timestamp: e.timeStamp,
            pointerType: e.pointerType || "mouse",
            ...(pressure === undefined ? {} : { pressure }),
        };
    }

    /** Push the pixel-sized tolerances through the current zoom to the store. */
    #syncToolScale() {
        const { store, camera } = this.#host;
        store.tolerance = camera.toAsyLength(8);
        store.penTapTolerance = camera.toAsyLength(2);
        store.sceneUnitsPerPixel = camera.toAsyLength(1);
        store.strokeProcessing = {
            ...store.strokeProcessing,
            sampleSpacing: camera.toAsyLength(1.5),
            simplifyTolerance: camera.toAsyLength(0.75),
        };
    }

    // --- pinch ---------------------------------------------------------------

    #beginPinch() {
        const touches = [...this.#activeTouches.values()];
        if (touches.length < 2) return;
        const [a, b] = touches;
        this.#penSamples.cancel();
        this.#host.store.cancel();
        this.#mode = "pinch";
        this.#transformCursor = null;
        this.#selectedArcControl = null;
        this.#hoveredArcControl = null;
        this.#activeArcPointer = null;
        this.#pointerId = null;
        this.#host.camera.beginPinch(a, b);
    }

    #updatePinch() {
        if (this.#activeTouches.size < 2) return;
        const [a, b] = [...this.#activeTouches.values()];
        this.#host.camera.updatePinch(a, b);
    }

    // --- pointer down: one hit-test, one branch ------------------------------

    pointerDown(e: PointerEvent) {
        const { store, camera, navigation } = this.#host;
        const surface = this.#host.surface;
        if (!surface || (e.button !== 0 && e.button !== 1)) return;
        this.#host.onSurfaceActivated();
        e.preventDefault();
        surface.focus();
        if (store.toolKind === "eraser") this.#eraserPointer = this.#local(e);
        this.#capture(e.pointerId);

        if (e.pointerType === "touch") {
            this.#activeTouches.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
            if (this.#activeTouches.size >= 2) {
                if (navigation) this.#beginPinch();
                return;
            }
        }

        if (e.button === 1 && !navigation) return;

        this.#pointerId = e.pointerId;
        this.#penSamples.cancel();
        if (navigation && (e.button === 1 || store.toolKind === "pan" || this.#host.spacePressed)) {
            this.#mode = "pan";
            this.#panStart = {
                clientX: e.clientX,
                clientY: e.clientY,
                x: camera.panX,
                y: camera.panY,
            };
            return;
        }

        // Every path from here is a primary-button press: middle-button presses
        // either opened the pan above or returned when navigation is disabled.
        if (e.button === 0 && store.toolKind === "select" && store.lineContinuation) {
            this.#continueLine(e);
            return;
        }

        const pointerScreen = this.#local(e);
        const hit = this.#hitAt(pointerScreen);
        switch (hit.kind) {
            case "dimension":
                return this.#pickDimension(hit.id);
            case "constraint":
                return this.#pickConstraint(hit.id);
            case "arc-control":
                return this.#beginArcTransform(e, hit);
            case "vertex":
                return this.#beginVertexTransform(e, hit.handle);
            case "resize":
                return this.#beginResize(e, hit);
            case "rotation":
                return this.#beginRotate(e, hit.control);
            case "selection-body":
                return this.#beginSelectionMove(e, pointerScreen);
            case "canvas":
                return this.#beginDraw(e, pointerScreen);
        }
    }

    /**
     * The single ownership decision: what is under the pointer. Handle affordances
     * (arc controls, path vertices, resize/rotation handles, the selection body)
     * only exist for the select tool, so everything else falls through to the
     * canvas — the tool pipeline.
     */
    #hitAt(pointerScreen: Pair): PointerHit {
        const { store, overlay } = this.#host;
        const [pointerX, pointerY] = pointerScreen;
        if (store.toolKind !== "select") return { kind: "canvas" };

        const dimensionGlyph = overlay.dimensions.find((glyph) =>
            Math.abs(glyph.label[0] - pointerX) <= 28 && Math.abs(glyph.label[1] - pointerY) <= 12
        );
        if (dimensionGlyph) return { kind: "dimension", id: dimensionGlyph.id };

        const constraintGlyph = overlay.constraintGlyphs.find((glyph) =>
            Math.hypot(glyph.screen[0] - pointerX, glyph.screen[1] - pointerY) <= 10
        );
        if (constraintGlyph) return { kind: "constraint", id: constraintGlyph.id };

        const arcGuide = overlay.arcGuide;
        const arcHandle = resizeHandleAt(pointerScreen, arcGuide?.editHandles ?? [], 6);
        // A construction guide (`elementId === null`) has no draggable radius.
        const overArcRadius = !arcHandle && arcGuide !== null && arcGuide.elementId !== null &&
            arcGuide.radiusEditable &&
            isArcGuideAt(pointerScreen, arcGuide);
        if (arcGuide?.elementId && (arcHandle || overArcRadius)) {
            return {
                kind: "arc-control",
                elementId: arcGuide.elementId,
                control: arcHandle?.control ?? "radius",
                handle: arcHandle?.handle ?? null,
            };
        }

        const vertexHandle = resizeHandleAt(pointerScreen, overlay.vertexHandles, 6);
        if (vertexHandle) return { kind: "vertex", handle: vertexHandle };

        // `resizeHandles` is only populated when the bounds exist, so this pair
        // always resolves together — carrying them keeps that provable downstream.
        const resizeHandle = resizeHandleAt(pointerScreen, overlay.resizeHandles);
        if (resizeHandle && overlay.selectionGeometryBounds) {
            return {
                kind: "resize",
                handle: resizeHandle,
                bounds: overlay.selectionGeometryBounds,
            };
        }

        if (isRotationHandleAt(pointerScreen, overlay.rotationControl) && overlay.rotationControl) {
            return { kind: "rotation", control: overlay.rotationControl };
        }

        if (
            !overlay.selectionIsPreview &&
            isScreenPointInRect(pointerScreen, overlay.selectionRect)
        ) return { kind: "selection-body" };

        return { kind: "canvas" };
    }

    /** Continue an open polyline: the next click extends it rather than hitting. */
    #continueLine(e: PointerEvent) {
        this.clearHandleSelection();
        this.#mode = "draw";
        this.#syncToolScale();
        this.#host.store.pointerDown(this.#asy(e), undefined, e.altKey);
    }

    #pickDimension(id: string) {
        this.#host.store.selectDimension(id);
        // `selectDimension` clears the item selection, so the vertex/arc handles
        // it belonged to are gone — drop the handle state with it, exactly as
        // the constraint-glyph branch does. Keeping it would let a stale vertex
        // ref revive (and capture Delete) when that path is selected again.
        this.clearHandleSelection();
        this.#mode = "idle";
    }

    #pickConstraint(id: string) {
        this.#host.store.selectConstraint(id);
        this.clearHandleSelection();
        this.#mode = "idle";
    }

    #beginArcTransform(e: PointerEvent, hit: Extract<PointerHit, { kind: "arc-control" }>) {
        const { store, camera } = this.#host;
        this.#selectedVertex = null;
        this.#hoveredVertex = null;
        this.#selectedArcControl = { elementId: hit.elementId, control: hit.control };
        this.#hoveredArcControl = this.#selectedArcControl;
        this.#activeArcPointer = this.#local(e);
        this.#mode = "transform";
        this.#transformCursor = "move";
        this.#syncToolScale();
        store.pointerDown(this.#asy(e), {
            kind: "arc",
            elementId: hit.elementId,
            control: hit.control,
            handle: hit.handle ?? this.#asy(e),
            minimumRadius: camera.toAsyLength(12),
        }, e.altKey);
    }

    #beginVertexTransform(e: PointerEvent, vertexHandle: OverlayVertexHandle) {
        this.#selectedVertex = {
            elementId: vertexHandle.elementId,
            nodeIndex: vertexHandle.nodeIndex,
        };
        this.#hoveredVertex = this.#selectedVertex;
        this.#selectedArcControl = null;
        this.#hoveredArcControl = null;
        this.#mode = "transform";
        this.#transformCursor = vertexHandle.cursor;
        this.#syncToolScale();
        this.#host.store.pointerDown(this.#asy(e), {
            kind: "vertex",
            elementId: vertexHandle.elementId,
            nodeIndex: vertexHandle.nodeIndex,
            handle: vertexHandle.handle,
        }, e.altKey, e.shiftKey);
    }

    #beginResize(e: PointerEvent, hit: Extract<PointerHit, { kind: "resize" }>) {
        const { store, camera } = this.#host;
        const { handle: resizeHandle, bounds } = hit;
        this.clearHandleSelection();
        const extentXpx = camera.toScreenLength(bounds.max[0] - bounds.min[0]);
        const extentYpx = camera.toScreenLength(bounds.max[1] - bounds.min[1]);
        this.#mode = "transform";
        this.#transformCursor = resizeHandle.cursor;
        this.#syncToolScale();
        store.pointerDown(this.#asy(e), {
            kind: "resize",
            anchor: resizeHandle.anchor,
            handle: resizeHandle.handle,
            axes: resizeHandle.axes,
            minimumScale: [
                extentXpx > 1e-9 ? Math.min(1, 12 / extentXpx) : 0,
                extentYpx > 1e-9 ? Math.min(1, 12 / extentYpx) : 0,
            ],
        }, e.altKey);
    }

    #beginRotate(e: PointerEvent, rotationControl: OverlayRotationControl) {
        this.clearHandleSelection();
        this.#mode = "transform";
        this.#transformCursor = "grabbing";
        this.#syncToolScale();
        this.#host.store.pointerDown(this.#asy(e), {
            kind: "rotate",
            pivot: rotationControl.pivot,
        }, e.altKey);
    }

    #beginSelectionMove(e: PointerEvent, pointerScreen: Pair) {
        const { store } = this.#host;
        this.clearHandleSelection();
        this.#featureClickStart = { screen: pointerScreen, selection: [...store.featureSelection] };
        this.#mode = "transform";
        this.#transformCursor = "move";
        this.#syncToolScale();
        store.pointerDown(this.#asy(e), { kind: "move" }, e.altKey, e.shiftKey);
    }

    /** Nothing was hit: hand the gesture to the active tool (Pipeline A). */
    #beginDraw(e: PointerEvent, pointerScreen: Pair) {
        const { store, camera } = this.#host;
        this.clearHandleSelection();
        if (store.toolKind === "select" && store.featureSelection.length > 0) {
            const element = hitTest(store.scene, this.#asy(e), camera.toAsyLength(8));
            if (!element) {
                store.clearFeatureSelection();
                this.#host.closeLengthMenu();
            }
        }

        this.#mode = "draw";
        if (store.toolKind === "select") {
            this.#featureClickStart = {
                screen: pointerScreen,
                selection: [...store.featureSelection],
            };
        }
        this.#syncToolScale();
        store.pointerDown(
            store.toolKind === "pen" ? this.#sample(e) : this.#asy(e),
            undefined,
            e.altKey,
        );
    }

    // --- pointer move / up / cancel ------------------------------------------

    pointerMove(e: PointerEvent) {
        const { store, camera } = this.#host;
        this.#eraserPointer = store.toolKind === "eraser" ? this.#local(e) : null;
        if (this.#activeTouches.has(e.pointerId)) {
            this.#activeTouches.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
        }
        if (this.#mode === "pinch") {
            this.#updatePinch();
            return;
        }
        if (this.#mode === "idle") {
            this.#hoverMove(e);
            return;
        }
        this.#hoveredVertex = null;
        this.#hoveredArcControl = null;
        if (e.pointerId !== this.#pointerId) return;
        if (this.#mode === "pan" && this.#panStart) {
            camera.panX = this.#panStart.x + e.clientX - this.#panStart.clientX;
            camera.panY = this.#panStart.y + e.clientY - this.#panStart.clientY;
        } else if (this.#mode === "draw" || this.#mode === "transform") {
            if (this.#mode === "transform" && this.#selectedArcControl) {
                this.#activeArcPointer = this.#local(e);
            }
            const drawingWithPen = this.#mode === "draw" && store.toolKind === "pen";
            const samples = drawingWithPen && typeof e.getCoalescedEvents === "function"
                ? e.getCoalescedEvents()
                : [];
            if (drawingWithPen) {
                this.#penSamples.add(
                    (samples.length > 0 ? samples : [e]).map((sample) => this.#sample(sample)),
                );
            } else {
                store.pointerMoves([this.#asy(e)], e.shiftKey, e.altKey);
            }
        }
    }

    /** No button down: update snap proposals and the hovered affordance/cursor. */
    #hoverMove(e: PointerEvent) {
        const { store, overlay } = this.#host;
        const pointerScreen = this.#local(e);
        const [pointerX, pointerY] = pointerScreen;
        if (["line", "rectangle", "point"].includes(store.toolKind)) {
            this.#syncToolScale();
            store.updateSnapProposal(this.#asy(e), e.altKey);
        }
        if (
            store.lineContinuation ||
            (store.toolKind === "line" && store.preview !== null) ||
            (store.toolKind === "arc" && store.arcGuide !== null)
        ) {
            this.#hoveredVertex = null;
            this.#hoveredArcControl = null;
            this.#transformCursor = null;
            this.#syncToolScale();
            store.pointerMove(this.#asy(e), e.shiftKey, e.altKey);
            return;
        }
        const arcGuide = overlay.arcGuide;
        const arcHandle = resizeHandleAt(pointerScreen, arcGuide?.editHandles ?? [], 6);
        // A construction guide (`elementId === null`) has no draggable radius.
        const overArcRadius = !arcHandle && arcGuide !== null && arcGuide.elementId !== null &&
            arcGuide.radiusEditable &&
            isArcGuideAt(pointerScreen, arcGuide);
        this.#hoveredArcControl = arcHandle
            ? { elementId: arcHandle.elementId, control: arcHandle.control }
            : null;
        if (arcHandle || overArcRadius) {
            this.#hoveredVertex = null;
            this.#transformCursor = "move";
            return;
        }
        const vertexHandle = resizeHandleAt([pointerX, pointerY], overlay.vertexHandles, 6);
        this.#hoveredVertex = vertexHandle
            ? { elementId: vertexHandle.elementId, nodeIndex: vertexHandle.nodeIndex }
            : null;
        const resizeHandle = resizeHandleAt([pointerX, pointerY], overlay.resizeHandles);
        const overRotation = isRotationHandleAt([pointerX, pointerY], overlay.rotationControl);
        const overSelectionBody = !overlay.selectionIsPreview &&
            isScreenPointInRect(pointerScreen, overlay.selectionRect);
        this.#transformCursor = vertexHandle?.cursor ?? resizeHandle?.cursor ??
            (overRotation ? "grab" : overSelectionBody ? "move" : null);
    }

    pointerUp(e: PointerEvent) {
        const { store, camera } = this.#host;
        const wasPinching = this.#mode === "pinch";
        this.#activeTouches.delete(e.pointerId);
        this.#release(e.pointerId);
        if (wasPinching) {
            if (this.#activeTouches.size < 2) {
                this.#mode = "idle";
                camera.endPinch();
            }
            return;
        }
        if (e.pointerId !== this.#pointerId) return;
        if (this.#mode === "draw" || this.#mode === "transform") {
            const drawingWithPen = this.#mode === "draw" && store.toolKind === "pen";
            const point = drawingWithPen ? this.#sample(e) : this.#asy(e);
            if (drawingWithPen) {
                const flushed = this.#penSamples.flushWith((points) =>
                    store.pointerUp(point, e.shiftKey, points, e.altKey)
                );
                if (!flushed) store.pointerUp(point, e.shiftKey, [], e.altKey);
            } else store.pointerUp(point, e.shiftKey, [], e.altKey);
        }
        if (store.toolKind === "select" && this.#featureClickStart) {
            const [pointerX, pointerY] = this.#local(e);
            const moved = Math.hypot(
                pointerX - this.#featureClickStart.screen[0],
                pointerY - this.#featureClickStart.screen[1],
            );
            if (moved <= 3) {
                const at = this.#asy(e);
                const element = hitTest(store.scene, at, camera.toAsyLength(8));
                if (element) {
                    store.selectFeatureAtItem(
                        element.id,
                        at,
                        e.shiftKey,
                        this.#featureClickStart.selection,
                    );
                }
            }
        }
        this.#featureClickStart = null;
        this.#pointerId = null;
        this.#panStart = null;
        this.#transformCursor = null;
        this.#hoveredVertex = this.#host.activeSelectedVertex;
        this.#activeArcPointer = null;
        this.#mode = "idle";
    }

    pointerCancel(e: PointerEvent) {
        this.#activeTouches.delete(e.pointerId);
        this.#release(e.pointerId);
        if (e.pointerId !== this.#pointerId && this.#mode !== "pinch") return;
        if (this.#mode === "draw" || this.#mode === "transform") {
            this.#penSamples.cancel();
            this.#host.store.cancel();
        }
        this.#pointerId = null;
        this.#panStart = null;
        this.#host.camera.endPinch();
        this.#transformCursor = null;
        this.#featureClickStart = null;
        this.#hoveredVertex = null;
        this.#selectedArcControl = null;
        this.#hoveredArcControl = null;
        this.#activeArcPointer = null;
        this.#mode = "idle";
    }

    pointerLeave() {
        if (this.#mode !== "idle") return;
        this.#eraserPointer = null;
        this.#transformCursor = null;
        this.#hoveredVertex = null;
        this.#hoveredArcControl = null;
    }

    doubleClick(e: MouseEvent) {
        const { store, camera } = this.#host;
        if (store.toolKind !== "select") return;
        const at = this.#asy(e);
        const element = hitTest(store.scene, at, camera.toAsyLength(8));
        if (element) store.selectCurveFeatureAt(element.id, at, e.shiftKey);
    }
}
