<script lang="ts">
    import { cn } from "$lib/utils.js";
    import { SvelteMap, SvelteSet } from "svelte/reactivity";
    import type { Attachment } from "svelte/attachments";
    import {
        elementBounds,
        isStraightPathVertexEditable,
        sceneBounds,
        type Bounds,
        type Pair,
        type Scene,
        type SceneElement as SceneElementModel,
    } from "$lib/asy/scene";
    import type { WhiteboardStore } from "$lib/state/whiteboard.svelte";
    import { PointerSampleBatcher, type PointerSample } from "$lib/asy/engine";
    import { Theme } from "$lib/utils/Theme.svelte";
    import {
        registerCanvasSnapshot,
        renderWhiteboard,
        resizeHandleAt,
        isRotationHandleAt,
        isArcGuideAt,
        type RenderResizeHandle,
        type RenderArcHandle,
        type ScreenRect,
        type WhiteboardPalette,
        type WhiteboardRenderOverlay,
        type WhiteboardRenderSnapshot,
    } from "./render";
    import ZoomControls from "./zoom-controls.svelte";

    let {
        store,
        showGrid = true,
        transparent = false,
        navigation = true,
        surface = $bindable(null),
        class: className,
    }: {
        store: WhiteboardStore;
        /** Hide the navigation grid for in-context annotation overlays. */
        showGrid?: boolean;
        /** Leave the host's image/surface visible beneath the canvas. */
        transparent?: boolean;
        /** Disable viewport gestures when the host image must remain registration-locked. */
        navigation?: boolean;
        /** Bindable ref to the underlying canvas (for SVG/PNG export). */
        surface?: HTMLCanvasElement | null;
        class?: string;
    } = $props();

    let width = $state(0);
    let height = $state(0);
    let pixelRatio = $state(1);
    let scale = $state(40); // px per asy unit
    let panX = $state(0);
    let panY = $state(0);
    let pointerId = $state<number | null>(null);
    let interaction = $state<"idle" | "draw" | "transform" | "pan" | "pinch">("idle");
    type TransformCursor =
        | "nwse-resize"
        | "nesw-resize"
        | "ew-resize"
        | "ns-resize"
        | "grab"
        | "grabbing"
        | "move";
    let transformCursor = $state<TransformCursor | null>(null);
    let spacePressed = $state(false);
    let selectedVertex = $state<VertexRef | null>(null);
    let hoveredVertex = $state<VertexRef | null>(null);
    let selectedArcControl = $state<ArcControlRef | null>(null);
    let hoveredArcControl = $state<ArcControlRef | null>(null);
    let panStart: { clientX: number; clientY: number; x: number; y: number } | null = null;
    const activeTouches = new SvelteMap<number, { clientX: number; clientY: number }>();
    let pinchStart: { distance: number; scale: number; world: Pair } | null = null;
    const penSamples = new PointerSampleBatcher<PointerSample>(
        (points) => {
            if (interaction === "draw" && store.toolKind === "pen") store.pointerMoves(points);
        },
        (callback) => requestAnimationFrame(callback),
        (handle) => cancelAnimationFrame(handle),
    );

    const origin = $derived<[number, number]>([width / 2 + panX, height / 2 + panY]);
    const project = $derived.by<(point: Pair) => Pair>(
        () => (p: Pair) => [origin[0] + p[0] * scale, origin[1] - p[1] * scale],
    );
    const activeSelection = $derived(store.selectionPreview ?? store.selection);
    const selectedIds = $derived(new SvelteSet(activeSelection));
    const selectionIsPreview = $derived(store.selectionPreview !== null || store.preview !== null);

    type ResizePosition = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

    interface VertexRef {
        elementId: string;
        nodeIndex: number;
    }

    type ArcControl = "center" | "start" | "end" | "radius";

    interface ArcControlRef {
        elementId: string;
        control: ArcControl;
    }

    interface ResizeHandle extends RenderResizeHandle {
        position: ResizePosition;
        screen: Pair;
        handle: Pair;
        anchor: Pair;
        axes: { x: boolean; y: boolean };
        cursor: Extract<TransformCursor, `${string}-resize`>;
    }

    interface VertexHandle extends RenderResizeHandle {
        screen: Pair;
        handle: Pair;
        elementId: string;
        nodeIndex: number;
        cursor: "move";
        state: "default" | "hovered" | "selected";
    }

    interface ArcHandle extends RenderArcHandle {
        handle: Pair;
        elementId: string;
    }

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

    function elementScreenRect(element: SceneElementModel, padding = 0): ScreenRect | null {
        if (element.kind === "label") {
            const [x, y] = project(element.at);
            const labelWidth = Math.max(14, element.text.replaceAll("$", "").length * 7.5);
            return {
                x: x - labelWidth / 2 - padding,
                y: y - 9 - padding,
                width: labelWidth + padding * 2,
                height: 18 + padding * 2,
            };
        }
        const bounds = elementBounds(element);
        return bounds ? screenRect(bounds, padding) : null;
    }

    const selectionGeometryBounds = $derived.by<Bounds | null>(() => {
        if (activeSelection.length === 0) return null;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const element of store.displayScene.elements) {
            if (!selectedIds.has(element.id)) continue;
            const bounds = elementBounds(element);
            if (!bounds) continue;
            minX = Math.min(minX, bounds.min[0]);
            minY = Math.min(minY, bounds.min[1]);
            maxX = Math.max(maxX, bounds.max[0]);
            maxY = Math.max(maxY, bounds.max[1]);
        }
        return Number.isFinite(minX) ? { min: [minX, minY], max: [maxX, maxY] } : null;
    });

    /** Only all-straight paths expose per-node handles; ink stays whole-object-only. */
    const selectedStraightVertexEditablePath = $derived.by(() => {
        if (activeSelection.length !== 1) return null;
        const element = store.displayScene.elements.find(({ id }) => id === activeSelection[0]);
        return element?.kind === "path" && isStraightPathVertexEditable(element.path)
            ? element
            : null;
    });

    const selectedStraightPathHasMultipleSegments = $derived(
        (selectedStraightVertexEditablePath?.path.joins.length ?? 0) > 1,
    );

    const selectedCircularArc = $derived.by(() => {
        if (
            activeSelection.length !== 1 ||
            store.selectionPreview !== null ||
            store.toolKind !== "select"
        ) return null;
        const element = store.displayScene.elements.find(({ id }) => id === activeSelection[0]);
        return element?.kind === "arc" ? element : null;
    });

    const activeSelectedVertex = $derived.by(() =>
        selectedVertex &&
        selectedStraightVertexEditablePath?.id === selectedVertex.elementId &&
        selectedVertex.nodeIndex >= 0 &&
        selectedVertex.nodeIndex < selectedStraightVertexEditablePath.path.nodes.length
            ? selectedVertex
            : null,
    );

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

    const hasTransformExtent = $derived.by(() => {
        if (!selectionGeometryBounds) return false;
        const dx = selectionGeometryBounds.max[0] - selectionGeometryBounds.min[0];
        const dy = selectionGeometryBounds.max[1] - selectionGeometryBounds.min[1];
        return Math.hypot(dx, dy) > 1e-9;
    });

    const selectionRect = $derived.by(() => {
        if (activeSelection.length === 0) return null;
        if (selectedCircularArc) return null;
        if (
            selectedStraightVertexEditablePath &&
            !selectedStraightPathHasMultipleSegments &&
            store.selectionPreview === null
        ) return null;
        if (selectionGeometryBounds && hasTransformExtent) {
            return screenRect(selectionGeometryBounds, 6);
        }
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const element of store.displayScene.elements) {
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
    });

    const previewElementRects = $derived.by(() => {
        if (store.selectionPreview === null) return [];
        return store.displayScene.elements.flatMap((element) => {
            if (!selectedIds.has(element.id)) return [];
            const rect = elementScreenRect(element, 4);
            return rect ? [rect] : [];
        });
    });

    const resizeHandles = $derived.by<ResizeHandle[]>(() => {
        if (
            (selectedStraightVertexEditablePath && !selectedStraightPathHasMultipleSegments) ||
            selectedCircularArc ||
            !selectionRect ||
            !selectionGeometryBounds ||
            !hasTransformExtent ||
            selectionIsPreview ||
            store.toolKind !== "select"
        ) return [];
        const { x, y, width: boxWidth, height: boxHeight } = selectionRect;
        const { min, max } = selectionGeometryBounds;
        const midX = (min[0] + max[0]) / 2;
        const midY = (min[1] + max[1]) / 2;
        const canResizeX = max[0] - min[0] > 1e-9;
        const canResizeY = max[1] - min[1] > 1e-9;
        const handles: ResizeHandle[] = [
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
        if (canResizeY) {
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
        if (canResizeX) {
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
    });

    const vertexHandles = $derived.by<VertexHandle[]>(() => {
        if (
            !selectedStraightVertexEditablePath ||
            selectionIsPreview ||
            store.toolKind !== "select"
        ) return [];
        return selectedStraightVertexEditablePath.path.nodes.map((handle, nodeIndex) => ({
            screen: project(handle),
            handle,
            elementId: selectedStraightVertexEditablePath.id,
            nodeIndex,
            cursor: "move",
            state: isVertex(activeSelectedVertex, selectedStraightVertexEditablePath.id, nodeIndex)
                ? "selected"
                : isVertex(hoveredVertex, selectedStraightVertexEditablePath.id, nodeIndex)
                  ? "hovered"
                  : "default",
        }));
    });

    const arcGuide = $derived.by(() => {
        const construction = store.arcGuide;
        if (construction) {
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
                radius: Math.abs(construction.radius * scale),
                handles,
                editHandles: [] as ArcHandle[],
                elementId: null,
            };
        }
        if (!selectedCircularArc) return null;

        const start = arcPoint(
            selectedCircularArc.center,
            selectedCircularArc.radius,
            selectedCircularArc.angle1,
        );
        const end = arcPoint(
            selectedCircularArc.center,
            selectedCircularArc.radius,
            selectedCircularArc.angle2,
        );
        let startScreen = project(start);
        let endScreen = project(end);
        if (Math.hypot(startScreen[0] - endScreen[0], startScreen[1] - endScreen[1]) < 2) {
            const radians = (selectedCircularArc.angle1 * Math.PI) / 180;
            const tangent: Pair = [-Math.sin(radians) * 7, -Math.cos(radians) * 7];
            startScreen = [startScreen[0] - tangent[0], startScreen[1] - tangent[1]];
            endScreen = [endScreen[0] + tangent[0], endScreen[1] + tangent[1]];
        }

        const editHandles: ArcHandle[] = ([
            { control: "center", handle: selectedCircularArc.center, screen: project(selectedCircularArc.center) },
            { control: "start", handle: start, screen: startScreen },
            { control: "end", handle: end, screen: endScreen },
        ] as const).map((handle) => ({
            ...handle,
            elementId: selectedCircularArc.id,
            state: isArcControl(selectedArcControl, selectedCircularArc.id, handle.control)
                ? "selected"
                : isArcControl(hoveredArcControl, selectedCircularArc.id, handle.control)
                  ? "hovered"
                  : "default",
        }));
        return {
            center: project(selectedCircularArc.center),
            radius: Math.abs(selectedCircularArc.radius * scale),
            handles: editHandles,
            editHandles,
            elementId: selectedCircularArc.id,
        };
    });

    const rotationControl = $derived.by(() => {
        if (
            (selectedStraightVertexEditablePath && !selectedStraightPathHasMultipleSegments) ||
            selectedCircularArc ||
            !selectionRect ||
            !selectionGeometryBounds ||
            !hasTransformExtent ||
            selectionIsPreview ||
            store.toolKind !== "select"
        ) return null;
        return {
            stemStart: [selectionRect.x + selectionRect.width / 2, selectionRect.y] as Pair,
            screen: [selectionRect.x + selectionRect.width / 2, selectionRect.y - 24] as Pair,
            pivot: [
                (selectionGeometryBounds.min[0] + selectionGeometryBounds.max[0]) / 2,
                (selectionGeometryBounds.min[1] + selectionGeometryBounds.max[1]) / 2,
            ] as Pair,
        };
    });

    function syncToolScale() {
        store.tolerance = 8 / scale;
        store.penTapTolerance = 2 / scale;
        store.sceneUnitsPerPixel = 1 / scale;
        store.strokeProcessing = {
            ...store.strokeProcessing,
            sampleSpacing: 1.5 / scale,
            simplifyTolerance: 0.75 / scale,
        };
    }

    const attachSurface: Attachment<HTMLCanvasElement> = (node) => {
        const attachedStore = store;
        const promptLabel = () =>
            typeof window !== "undefined" ? window.prompt("Label (LaTeX, e.g. $A$):") : null;

        surface = node;
        pixelRatio = window.devicePixelRatio || 1;
        attachedStore.promptLabel = promptLabel;
        return () => {
            penSamples.cancel();
            if (surface === node) surface = null;
            if (attachedStore.promptLabel === promptLabel) attachedStore.promptLabel = undefined;
        };
    };

    function localPoint(clientX: number, clientY: number): [number, number] {
        const rect = surface?.getBoundingClientRect();
        return rect ? [clientX - rect.left, clientY - rect.top] : [0, 0];
    }

    function toAsyAt(clientX: number, clientY: number): Pair {
        const [px, py] = localPoint(clientX, clientY);
        return [(px - origin[0]) / scale, (origin[1] - py) / scale];
    }

    function pointerSample(e: PointerEvent): PointerSample {
        const pressure = e.pointerType === "pen" && Number.isFinite(e.pressure) && e.pressure > 0
            ? Math.max(0, Math.min(1, e.pressure))
            : undefined;
        return {
            point: toAsyAt(e.clientX, e.clientY),
            timestamp: e.timeStamp,
            pointerType: e.pointerType || "mouse",
            ...(pressure === undefined ? {} : { pressure }),
        };
    }

    function capture(id: number) {
        try {
            surface?.setPointerCapture(id);
        } catch {
            // Pointer capture is best-effort on some touch browsers.
        }
    }

    function release(id: number) {
        if (!surface?.hasPointerCapture(id)) return;
        try {
            surface.releasePointerCapture(id);
        } catch {
            // The browser may already have released it.
        }
    }

    function beginPinch() {
        const touches = [...activeTouches.values()];
        if (touches.length < 2) return;
        const [a, b] = touches;
        const midX = (a.clientX + b.clientX) / 2;
        const midY = (a.clientY + b.clientY) / 2;
        penSamples.cancel();
        store.cancel();
        interaction = "pinch";
        transformCursor = null;
        selectedArcControl = null;
        hoveredArcControl = null;
        pointerId = null;
        pinchStart = {
            distance: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
            scale,
            world: toAsyAt(midX, midY),
        };
    }

    function updatePinch() {
        if (!pinchStart || activeTouches.size < 2) return;
        const [a, b] = [...activeTouches.values()];
        const midClientX = (a.clientX + b.clientX) / 2;
        const midClientY = (a.clientY + b.clientY) / 2;
        const [midX, midY] = localPoint(midClientX, midClientY);
        const distance = Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY));
        scale = Math.max(8, Math.min(400, pinchStart.scale * (distance / pinchStart.distance)));
        panX = midX - width / 2 - pinchStart.world[0] * scale;
        panY = midY - height / 2 + pinchStart.world[1] * scale;
    }

    function onPointerDown(e: PointerEvent) {
        if (!surface || (e.button !== 0 && e.button !== 1)) return;
        e.preventDefault();
        surface.focus();
        capture(e.pointerId);

        if (e.pointerType === "touch") {
            activeTouches.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
            if (activeTouches.size >= 2) {
                if (navigation) beginPinch();
                return;
            }
        }

        if (e.button === 1 && !navigation) return;

        pointerId = e.pointerId;
        penSamples.cancel();
        if (navigation && (e.button === 1 || store.toolKind === "pan" || spacePressed)) {
            interaction = "pan";
            panStart = { clientX: e.clientX, clientY: e.clientY, x: panX, y: panY };
            return;
        }

        if (e.button === 0 && store.toolKind === "select" && store.lineContinuation) {
            selectedVertex = null;
            hoveredVertex = null;
            selectedArcControl = null;
            hoveredArcControl = null;
            interaction = "draw";
            syncToolScale();
            store.pointerDown(toAsyAt(e.clientX, e.clientY));
            return;
        }

        const [pointerX, pointerY] = localPoint(e.clientX, e.clientY);
        const pointerScreen: Pair = [pointerX, pointerY];
        const arcHandle = resizeHandleAt(pointerScreen, arcGuide?.editHandles ?? [], 6);
        const overArcRadius = !arcHandle && arcGuide?.elementId !== null &&
            isArcGuideAt(pointerScreen, arcGuide);
        const vertexHandle = resizeHandleAt([pointerX, pointerY], vertexHandles, 6);
        const resizeHandle = resizeHandleAt([pointerX, pointerY], resizeHandles);
        const overRotation = isRotationHandleAt([pointerX, pointerY], rotationControl);
        if (
            e.button === 0 &&
            store.toolKind === "select" &&
            arcGuide?.elementId &&
            (arcHandle || overArcRadius)
        ) {
            const control = arcHandle?.control ?? "radius";
            const handle = arcHandle?.handle ?? toAsyAt(e.clientX, e.clientY);
            selectedVertex = null;
            hoveredVertex = null;
            selectedArcControl = { elementId: arcGuide.elementId, control };
            hoveredArcControl = selectedArcControl;
            interaction = "transform";
            transformCursor = "move";
            syncToolScale();
            store.pointerDown(toAsyAt(e.clientX, e.clientY), {
                kind: "arc",
                elementId: arcGuide.elementId,
                control,
                handle,
                minimumRadius: 12 / scale,
            });
            return;
        }
        if (e.button === 0 && store.toolKind === "select" && vertexHandle) {
            selectedVertex = {
                elementId: vertexHandle.elementId,
                nodeIndex: vertexHandle.nodeIndex,
            };
            hoveredVertex = selectedVertex;
            selectedArcControl = null;
            hoveredArcControl = null;
            interaction = "transform";
            transformCursor = vertexHandle.cursor;
            syncToolScale();
            store.pointerDown(toAsyAt(e.clientX, e.clientY), {
                kind: "vertex",
                elementId: vertexHandle.elementId,
                nodeIndex: vertexHandle.nodeIndex,
                handle: vertexHandle.handle,
            });
            return;
        }
        if (e.button === 0) {
            selectedVertex = null;
            hoveredVertex = null;
            selectedArcControl = null;
            hoveredArcControl = null;
        }
        if (e.button === 0 && store.toolKind === "select" && resizeHandle) {
            const handle = resizeHandle;
            if (handle && selectionGeometryBounds) {
                const extentXpx =
                    (selectionGeometryBounds.max[0] - selectionGeometryBounds.min[0]) * scale;
                const extentYpx =
                    (selectionGeometryBounds.max[1] - selectionGeometryBounds.min[1]) * scale;
                interaction = "transform";
                transformCursor = handle.cursor;
                syncToolScale();
                store.pointerDown(toAsyAt(e.clientX, e.clientY), {
                    kind: "resize",
                    anchor: handle.anchor,
                    handle: handle.handle,
                    axes: handle.axes,
                    minimumScale: [
                        extentXpx > 1e-9 ? Math.min(1, 12 / extentXpx) : 0,
                        extentYpx > 1e-9 ? Math.min(1, 12 / extentYpx) : 0,
                    ],
                });
                return;
            }
        }
        if (e.button === 0 && store.toolKind === "select" && overRotation && rotationControl) {
            interaction = "transform";
            transformCursor = "grabbing";
            syncToolScale();
            store.pointerDown(toAsyAt(e.clientX, e.clientY), {
                kind: "rotate",
                pivot: rotationControl.pivot,
            });
            return;
        }

        interaction = "draw";
        syncToolScale();
        store.pointerDown(store.toolKind === "pen" ? pointerSample(e) : toAsyAt(e.clientX, e.clientY));
    }

    function onPointerMove(e: PointerEvent) {
        if (activeTouches.has(e.pointerId)) {
            activeTouches.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
        }
        if (interaction === "pinch") {
            updatePinch();
            return;
        }
        if (interaction === "idle") {
            const [pointerX, pointerY] = localPoint(e.clientX, e.clientY);
            if (
                store.lineContinuation ||
                (store.toolKind === "line" && store.preview !== null) ||
                (store.toolKind === "arc" && store.arcGuide !== null)
            ) {
                hoveredVertex = null;
                hoveredArcControl = null;
                transformCursor = null;
                syncToolScale();
                store.pointerMove(toAsyAt(e.clientX, e.clientY), e.shiftKey);
                return;
            }
            const pointerScreen: Pair = [pointerX, pointerY];
            const arcHandle = resizeHandleAt(pointerScreen, arcGuide?.editHandles ?? [], 6);
            const overArcRadius = !arcHandle && arcGuide?.elementId !== null &&
                isArcGuideAt(pointerScreen, arcGuide);
            hoveredArcControl = arcHandle
                ? { elementId: arcHandle.elementId, control: arcHandle.control }
                : null;
            if (arcHandle || overArcRadius) {
                hoveredVertex = null;
                transformCursor = "move";
                return;
            }
            const vertexHandle = resizeHandleAt([pointerX, pointerY], vertexHandles, 6);
            hoveredVertex = vertexHandle
                ? { elementId: vertexHandle.elementId, nodeIndex: vertexHandle.nodeIndex }
                : null;
            const resizeHandle = resizeHandleAt([pointerX, pointerY], resizeHandles);
            const overRotation = isRotationHandleAt([pointerX, pointerY], rotationControl);
            transformCursor = vertexHandle?.cursor ?? resizeHandle?.cursor ?? (overRotation ? "grab" : null);
            return;
        }
        hoveredVertex = null;
        hoveredArcControl = null;
        if (e.pointerId !== pointerId) return;
        if (interaction === "pan" && panStart) {
            panX = panStart.x + e.clientX - panStart.clientX;
            panY = panStart.y + e.clientY - panStart.clientY;
        } else if (interaction === "draw" || interaction === "transform") {
            const samples = interaction === "draw" && store.toolKind === "pen" &&
                typeof e.getCoalescedEvents === "function"
                ? e.getCoalescedEvents()
                : [];
            if (interaction === "draw" && store.toolKind === "pen") {
                penSamples.add((samples.length > 0 ? samples : [e]).map(pointerSample));
            } else {
                store.pointerMoves([toAsyAt(e.clientX, e.clientY)], e.shiftKey);
            }
        }
    }

    function onPointerUp(e: PointerEvent) {
        const wasPinching = interaction === "pinch";
        activeTouches.delete(e.pointerId);
        release(e.pointerId);
        if (wasPinching) {
            if (activeTouches.size < 2) {
                interaction = "idle";
                pinchStart = null;
            }
            return;
        }
        if (e.pointerId !== pointerId) return;
        if (interaction === "draw" || interaction === "transform") {
            const point = interaction === "draw" && store.toolKind === "pen"
                ? pointerSample(e)
                : toAsyAt(e.clientX, e.clientY);
            if (interaction === "draw" && store.toolKind === "pen") {
                const flushed = penSamples.flushWith((points) =>
                    store.pointerUp(point, e.shiftKey, points)
                );
                if (!flushed) store.pointerUp(point, e.shiftKey);
            } else store.pointerUp(point, e.shiftKey);
        }
        pointerId = null;
        panStart = null;
        transformCursor = null;
        hoveredVertex = activeSelectedVertex;
        interaction = "idle";
    }

    function onPointerCancel(e: PointerEvent) {
        activeTouches.delete(e.pointerId);
        release(e.pointerId);
        if (e.pointerId !== pointerId && interaction !== "pinch") return;
        if (interaction === "draw" || interaction === "transform") {
            penSamples.cancel();
            store.cancel();
        }
        pointerId = null;
        panStart = null;
        pinchStart = null;
        transformCursor = null;
        hoveredVertex = null;
        selectedArcControl = null;
        hoveredArcControl = null;
        interaction = "idle";
    }

    function onKeyDown(e: KeyboardEvent) {
        if (navigation && e.key === " ") {
            e.preventDefault();
            spacePressed = true;
        } else if (e.key === "Escape") {
            penSamples.cancel();
            store.cancel();
            selectedVertex = null;
            hoveredVertex = null;
            selectedArcControl = null;
            hoveredArcControl = null;
            if (interaction === "draw" || interaction === "transform") {
                if (pointerId !== null) release(pointerId);
                pointerId = null;
                transformCursor = null;
                interaction = "idle";
            }
        } else if (e.key === "Delete" || e.key === "Backspace") {
            if (activeSelectedVertex) {
                e.preventDefault();
                store.deletePathVertex(
                    activeSelectedVertex.elementId,
                    activeSelectedVertex.nodeIndex,
                );
                selectedVertex = null;
                hoveredVertex = null;
                selectedArcControl = null;
                hoveredArcControl = null;
            } else if (store.selection.length) {
                e.preventDefault();
                store.deleteSelected();
            }
        } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
            e.preventDefault();
            if (e.shiftKey) store.redo();
            else store.undo();
        }
    }

    function onWindowKeyUp(e: KeyboardEvent) {
        if (e.key === " ") spacePressed = false;
    }

    function onWindowResize() {
        pixelRatio = window.devicePixelRatio || 1;
    }

    function zoomAt(clientX: number, clientY: number, factor: number) {
        const world = toAsyAt(clientX, clientY);
        const [px, py] = localPoint(clientX, clientY);
        scale = Math.max(8, Math.min(400, scale * factor));
        panX = px - width / 2 - world[0] * scale;
        panY = py - height / 2 + world[1] * scale;
    }

    function zoomBy(factor: number) {
        const rect = surface?.getBoundingClientRect();
        if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    }

    function zoomTo(percentage: number) {
        const targetScale = Math.max(8, Math.min(400, (percentage / 100) * 40));
        zoomBy(targetScale / scale);
    }

    function fitScene() {
        const bounds = sceneBounds(store.scene);
        if (!bounds || width <= 0 || height <= 0) return;

        const sceneWidth = bounds.max[0] - bounds.min[0];
        const sceneHeight = bounds.max[1] - bounds.min[1];
        const availableWidth = Math.max(1, width - 64);
        const availableHeight = Math.max(1, height - 64);
        const widthScale = sceneWidth > 1e-9 ? availableWidth / sceneWidth : Infinity;
        const heightScale = sceneHeight > 1e-9 ? availableHeight / sceneHeight : Infinity;
        const fittedScale = Math.min(widthScale, heightScale);

        scale = Number.isFinite(fittedScale)
            ? Math.max(8, Math.min(400, fittedScale))
            : 40;
        const centerX = (bounds.min[0] + bounds.max[0]) / 2;
        const centerY = (bounds.min[1] + bounds.max[1]) / 2;
        panX = -centerX * scale;
        panY = centerY * scale;
    }

    const zoomPercentage = $derived(Math.round((scale / 40) * 100));
    const canFitScene = $derived(sceneBounds(store.scene) !== null);

    function onWheel(e: WheelEvent) {
        e.preventDefault();
        if (!navigation) return;
        // Trackpad scroll pans. Pinch gestures arrive as ctrl-wheel; discrete
        // mouse-wheel events zoom. Every zoom stays anchored under the cursor.
        const discreteWheel = e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL ||
            (Math.abs(e.deltaY) >= 80 && Math.abs(e.deltaX) < 1);
        if (e.ctrlKey || e.metaKey || discreteWheel) {
            zoomAt(e.clientX, e.clientY, Math.exp(-Math.max(-240, Math.min(240, e.deltaY)) * 0.002));
        } else {
            panX -= e.deltaX;
            panY -= e.deltaY;
        }
    }

    const marqueeRect = $derived.by(() => {
        if (!store.marquee) return null;
        const a = project(store.marquee.start);
        const b = project(store.marquee.end);
        return {
            x: Math.min(a[0], b[0]),
            y: Math.min(a[1], b[1]),
            width: Math.abs(a[0] - b[0]),
            height: Math.abs(a[1] - b[1]),
        };
    });

    function currentPalette(): WhiteboardPalette {
        const current = Theme.currentTheme;
        const light = Theme.themes.get("light");
        return {
            background: current?.theme["surface-container-lowest"] ?? "#ffffff",
            foreground: current?.theme.foreground ?? "#191c1e",
            inverseInk: light?.theme.foreground ?? "#191c1e",
            border: current?.theme.border ?? "#e2e8f0",
            primary: current?.theme["primary-foreground"] ?? "#326cec",
            isDark: Theme.isDark,
        };
    }

    $effect(() => {
        const canvas = surface;
        if (!canvas || width <= 0 || height <= 0) return;

        void Theme.theme;
        const displayScene = $state.snapshot(store.displayScene) as Scene;
        const committedScene = $state.snapshot(store.scene) as Scene;
        const viewport = {
            width,
            height,
            scale,
            origin: [origin[0], origin[1]] as Pair,
        };
        const palette = currentPalette();
        const runtimeSnapshot: WhiteboardRenderSnapshot = {
            scene: displayScene,
            viewport,
            showGrid,
            transparent,
            palette,
        };
        const overlay: WhiteboardRenderOverlay = {
            selectedIds: new Set(activeSelection),
            selectionIsPreview,
            previewElementRects: previewElementRects.map((rect) => ({ ...rect })),
            marqueeRect: marqueeRect ? { ...marqueeRect } : null,
            selectionRect: selectionRect ? { ...selectionRect } : null,
            rotationControl: rotationControl
                ? { stemStart: rotationControl.stemStart, screen: rotationControl.screen }
                : null,
            resizeHandles: resizeHandles.map((handle) => ({ screen: handle.screen })),
            vertexHandles: vertexHandles.map((handle) => ({
                screen: handle.screen,
                state: handle.state,
            })),
            arcGuide: arcGuide
                ? {
                      center: arcGuide.center,
                      radius: arcGuide.radius,
                      handles: arcGuide.handles.map((handle) => ({
                          control: handle.control,
                          screen: handle.screen,
                          state: handle.state,
                      })),
                  }
                : null,
        };

        const backingWidth = Math.max(1, Math.round(width * pixelRatio));
        const backingHeight = Math.max(1, Math.round(height * pixelRatio));
        if (canvas.width !== backingWidth) canvas.width = backingWidth;
        if (canvas.height !== backingHeight) canvas.height = backingHeight;
        registerCanvasSnapshot(canvas, { ...runtimeSnapshot, scene: committedScene });
        const frame = requestAnimationFrame(() => {
            const context = canvas.getContext("2d");
            if (context) renderWhiteboard(context, runtimeSnapshot, overlay, pixelRatio);
        });
        return () => cancelAnimationFrame(frame);
    });
</script>

<svelte:window
    onkeyup={onWindowKeyUp}
    onresize={onWindowResize}
    onblur={() => (spacePressed = false)}
/>

<div
    class={cn(
        "relative h-full w-full overflow-hidden",
        transparent ? "bg-transparent" : "bg-surface-container-lowest",
        className,
    )}
    bind:clientWidth={width}
    bind:clientHeight={height}
>
    {#if navigation}
        <div class="absolute bottom-3 right-3 z-10">
            <ZoomControls
                percentage={zoomPercentage}
                onZoomOut={() => zoomBy(1 / 1.2)}
                onZoomIn={() => zoomBy(1.2)}
                onZoomTo={zoomTo}
                onFitScene={fitScene}
                {canFitScene}
            />
        </div>
    {/if}

    <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
    <canvas
        {@attach attachSurface}
        role="application"
        aria-label="Whiteboard canvas"
        tabindex="0"
        class={cn(
            "block h-full w-full touch-none select-none outline-none",
            interaction === "pan"
                ? "cursor-grabbing"
                : navigation && (store.toolKind === "pan" || spacePressed)
                  ? "cursor-grab"
                  : store.toolKind === "select"
                    ? "cursor-default"
                    : "cursor-crosshair",
        )}
        style:cursor={transformCursor}
        onkeydown={onKeyDown}
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerCancel}
        onpointerleave={() => {
            if (interaction === "idle") {
                transformCursor = null;
                hoveredVertex = null;
                hoveredArcControl = null;
            }
        }}
        onwheel={onWheel}
    ></canvas>
</div>
