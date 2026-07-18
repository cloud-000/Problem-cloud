<script lang="ts">
    import { cn } from "$lib/utils.js";
    import { SvelteMap, SvelteSet } from "svelte/reactivity";
    import type { Attachment } from "svelte/attachments";
    import {
        elementBounds,
        type Bounds,
        type Pair,
        type SceneElement as SceneElementModel,
    } from "$lib/asy/scene";
    import type { WhiteboardStore } from "$lib/state/whiteboard.svelte";
    import type { Project } from "./svg";
    import SceneElement from "./scene-element.svelte";

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
        /** Leave the host's image/surface visible beneath the SVG. */
        transparent?: boolean;
        /** Disable viewport gestures when the host image must remain registration-locked. */
        navigation?: boolean;
        /** Bindable ref to the underlying <svg> (for SVG/PNG export). */
        surface?: SVGSVGElement | null;
        class?: string;
    } = $props();

    let width = $state(0);
    let height = $state(0);
    let scale = $state(40); // px per asy unit
    let panX = $state(0);
    let panY = $state(0);
    let pointerId = $state<number | null>(null);
    let interaction = $state<"idle" | "draw" | "transform" | "pan" | "pinch">("idle");
    let transformCursor = $state<"nwse-resize" | "nesw-resize" | "grabbing" | null>(null);
    let spacePressed = $state(false);
    let panStart: { clientX: number; clientY: number; x: number; y: number } | null = null;
    const activeTouches = new SvelteMap<number, { clientX: number; clientY: number }>();
    let pinchStart: { distance: number; scale: number; world: Pair } | null = null;

    const origin = $derived<[number, number]>([width / 2 + panX, height / 2 + panY]);
    const project = $derived.by<Project>(
        () => (p: Pair) => [origin[0] + p[0] * scale, origin[1] - p[1] * scale],
    );
    const activeSelection = $derived(store.selectionPreview ?? store.selection);
    const selectedIds = $derived(new SvelteSet(activeSelection));
    const selectionIsPreview = $derived(store.selectionPreview !== null || store.preview !== null);

    interface ScreenRect {
        x: number;
        y: number;
        width: number;
        height: number;
    }

    type ResizeCorner = "nw" | "ne" | "se" | "sw";

    interface ResizeHandle {
        corner: ResizeCorner;
        screen: Pair;
        handle: Pair;
        anchor: Pair;
        cursor: "nwse-resize" | "nesw-resize";
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

    const hasTransformExtent = $derived.by(() => {
        if (!selectionGeometryBounds) return false;
        const dx = selectionGeometryBounds.max[0] - selectionGeometryBounds.min[0];
        const dy = selectionGeometryBounds.max[1] - selectionGeometryBounds.min[1];
        return Math.hypot(dx, dy) > 1e-9;
    });

    const selectionRect = $derived.by(() => {
        if (activeSelection.length === 0) return null;
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
            !selectionRect ||
            !selectionGeometryBounds ||
            !hasTransformExtent ||
            selectionIsPreview ||
            store.toolKind !== "select"
        ) return [];
        const { x, y, width: boxWidth, height: boxHeight } = selectionRect;
        const { min, max } = selectionGeometryBounds;
        return [
            {
                corner: "nw",
                screen: [x, y],
                handle: [min[0], max[1]],
                anchor: [max[0], min[1]],
                cursor: "nwse-resize",
            },
            {
                corner: "ne",
                screen: [x + boxWidth, y],
                handle: [max[0], max[1]],
                anchor: [min[0], min[1]],
                cursor: "nesw-resize",
            },
            {
                corner: "se",
                screen: [x + boxWidth, y + boxHeight],
                handle: [max[0], min[1]],
                anchor: [min[0], max[1]],
                cursor: "nwse-resize",
            },
            {
                corner: "sw",
                screen: [x, y + boxHeight],
                handle: [min[0], min[1]],
                anchor: [max[0], max[1]],
                cursor: "nesw-resize",
            },
        ];
    });

    const rotationControl = $derived.by(() => {
        if (
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
        store.simplifyEpsilon = 2.5 / scale;
    }

    const attachSurface: Attachment<SVGSVGElement> = (node) => {
        surface = node;
        store.promptLabel = () =>
            typeof window !== "undefined" ? window.prompt("Label (LaTeX, e.g. $A$):") : null;
        return () => {
            if (surface === node) surface = null;
            store.promptLabel = undefined;
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
        store.cancel();
        interaction = "pinch";
        transformCursor = null;
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
        if (navigation && (e.button === 1 || store.toolKind === "pan" || spacePressed)) {
            interaction = "pan";
            panStart = { clientX: e.clientX, clientY: e.clientY, x: panX, y: panY };
            return;
        }

        const target = e.target instanceof Element ? e.target : null;
        const resizeTarget = target?.closest<SVGElement>("[data-selection-resize]");
        const rotationTarget = target?.closest<SVGElement>("[data-selection-rotate]");
        if (e.button === 0 && store.toolKind === "select" && resizeTarget) {
            const corner = resizeTarget.dataset.selectionResize as ResizeCorner | undefined;
            const handle = resizeHandles.find((candidate) => candidate.corner === corner);
            if (handle && selectionGeometryBounds) {
                const extentPx = Math.max(
                    (selectionGeometryBounds.max[0] - selectionGeometryBounds.min[0]) * scale,
                    (selectionGeometryBounds.max[1] - selectionGeometryBounds.min[1]) * scale,
                );
                interaction = "transform";
                transformCursor = handle.cursor;
                syncToolScale();
                store.pointerDown(toAsyAt(e.clientX, e.clientY), {
                    kind: "resize",
                    anchor: handle.anchor,
                    handle: handle.handle,
                    minimumScale: Math.min(1, 12 / Math.max(1, extentPx)),
                });
                return;
            }
        }
        if (e.button === 0 && store.toolKind === "select" && rotationTarget && rotationControl) {
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
        store.pointerDown(toAsyAt(e.clientX, e.clientY));
    }

    function onPointerMove(e: PointerEvent) {
        if (activeTouches.has(e.pointerId)) {
            activeTouches.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
        }
        if (interaction === "pinch") {
            updatePinch();
            return;
        }
        if (e.pointerId !== pointerId) return;
        if (interaction === "pan" && panStart) {
            panX = panStart.x + e.clientX - panStart.clientX;
            panY = panStart.y + e.clientY - panStart.clientY;
        } else if (interaction === "draw" || interaction === "transform") {
            store.pointerMove(toAsyAt(e.clientX, e.clientY), e.shiftKey);
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
            store.pointerUp(toAsyAt(e.clientX, e.clientY), e.shiftKey);
        }
        pointerId = null;
        panStart = null;
        transformCursor = null;
        interaction = "idle";
    }

    function onPointerCancel(e: PointerEvent) {
        activeTouches.delete(e.pointerId);
        release(e.pointerId);
        if (e.pointerId !== pointerId && interaction !== "pinch") return;
        if (interaction === "draw" || interaction === "transform") store.cancel();
        pointerId = null;
        panStart = null;
        pinchStart = null;
        transformCursor = null;
        interaction = "idle";
    }

    function onKeyDown(e: KeyboardEvent) {
        if (navigation && e.key === " ") {
            e.preventDefault();
            spacePressed = true;
        } else if (e.key === "Escape") {
            store.cancel();
            if (interaction === "draw" || interaction === "transform") {
                if (pointerId !== null) release(pointerId);
                pointerId = null;
                transformCursor = null;
                interaction = "idle";
            }
        } else if (e.key === "Delete" || e.key === "Backspace") {
            if (store.selection.length) {
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

    function zoomAt(clientX: number, clientY: number, factor: number) {
        const world = toAsyAt(clientX, clientY);
        const [px, py] = localPoint(clientX, clientY);
        scale = Math.max(8, Math.min(400, scale * factor));
        panX = px - width / 2 - world[0] * scale;
        panY = py - height / 2 + world[1] * scale;
    }

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

    // A light adaptive grid: pick a "nice" unit step that renders near ~32px.
    const gridStep = $derived.by(() => {
        const target = 32 / scale;
        const pow = Math.pow(10, Math.floor(Math.log10(target)));
        for (const m of [1, 2, 5, 10]) if (pow * m >= target) return pow * m;
        return pow * 10;
    });

    const gridLines = $derived.by(() => {
        if (width === 0 || height === 0) return { v: [] as number[], h: [] as number[] };
        const xMin = -origin[0] / scale;
        const xMax = (width - origin[0]) / scale;
        const yMin = (origin[1] - height) / scale;
        const yMax = origin[1] / scale;
        const v: number[] = [];
        const h: number[] = [];
        for (let x = Math.ceil(xMin / gridStep) * gridStep; x <= xMax; x += gridStep) v.push(x);
        for (let y = Math.ceil(yMin / gridStep) * gridStep; y <= yMax; y += gridStep) h.push(y);
        return { v, h };
    });

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
</script>

<svelte:window onkeyup={onWindowKeyUp} onblur={() => (spacePressed = false)} />

<div
    class={cn(
        "relative h-full w-full overflow-hidden",
        transparent ? "bg-transparent" : "bg-surface-container-lowest",
        className,
    )}
    bind:clientWidth={width}
    bind:clientHeight={height}
>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <svg
        {@attach attachSurface}
        {width}
        {height}
        viewBox="0 0 {width} {height}"
        role="application"
        aria-label="Whiteboard canvas"
        tabindex="0"
        class={cn(
            "block touch-none select-none outline-none",
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
        onwheel={onWheel}
    >
        {#if width > 0}
            {#if showGrid}
                {#each gridLines.v as x (x)}
                    <line
                        x1={project([x, 0])[0]}
                        x2={project([x, 0])[0]}
                        y1="0"
                        y2={height}
                        stroke="var(--color-border)"
                        stroke-width="1"
                        opacity={x === 0 ? 0.5 : 0.12}
                    />
                {/each}
                {#each gridLines.h as y (y)}
                    <line
                        x1="0"
                        x2={width}
                        y1={project([0, y])[1]}
                        y2={project([0, y])[1]}
                        stroke="var(--color-border)"
                        stroke-width="1"
                        opacity={y === 0 ? 0.5 : 0.12}
                    />
                {/each}
            {/if}

            {#each store.displayScene.elements as element (element.id)}
                <SceneElement {element} {project} {scale} selected={selectedIds.has(element.id)} />
            {/each}

            {#each previewElementRects as rect, index (`${index}-${rect.x}-${rect.y}`)}
                <rect
                    x={rect.x}
                    y={rect.y}
                    width={rect.width}
                    height={rect.height}
                    rx="2"
                    fill="var(--color-primary)"
                    fill-opacity="0.06"
                    stroke="var(--color-primary)"
                    stroke-width="1"
                    stroke-dasharray="3 3"
                    pointer-events="none"
                />
            {/each}

            {#if marqueeRect}
                <rect
                    x={marqueeRect.x}
                    y={marqueeRect.y}
                    width={marqueeRect.width}
                    height={marqueeRect.height}
                    fill="var(--color-primary)"
                    fill-opacity="0.08"
                    stroke="var(--color-primary)"
                    stroke-width="1"
                    stroke-dasharray="5 4"
                    pointer-events="none"
                />
            {/if}

            {#if selectionRect}
                <rect
                    x={selectionRect.x}
                    y={selectionRect.y}
                    width={selectionRect.width}
                    height={selectionRect.height}
                    fill="none"
                    stroke="var(--color-primary)"
                    stroke-width="1.5"
                    stroke-dasharray={selectionIsPreview ? "6 4" : undefined}
                    pointer-events="none"
                />
                {#if rotationControl}
                    <line
                        x1={rotationControl.stemStart[0]}
                        y1={rotationControl.stemStart[1]}
                        x2={rotationControl.screen[0]}
                        y2={rotationControl.screen[1]}
                        stroke="var(--color-primary)"
                        stroke-width="1.5"
                        pointer-events="none"
                    />
                    <circle
                        cx={rotationControl.screen[0]}
                        cy={rotationControl.screen[1]}
                        r="10"
                        fill="transparent"
                        pointer-events="all"
                        data-selection-rotate
                        style:cursor="grab"
                    />
                    <circle
                        cx={rotationControl.screen[0]}
                        cy={rotationControl.screen[1]}
                        r="4.5"
                        fill="var(--color-surface-container-lowest)"
                        stroke="var(--color-primary)"
                        stroke-width="1.5"
                        pointer-events="none"
                    />
                {/if}
                {#each resizeHandles as handle (handle.corner)}
                    <rect
                        x={handle.screen[0] - 10}
                        y={handle.screen[1] - 10}
                        width="20"
                        height="20"
                        fill="transparent"
                        pointer-events="all"
                        data-selection-resize={handle.corner}
                        style:cursor={handle.cursor}
                    />
                    <rect
                        x={handle.screen[0] - 4}
                        y={handle.screen[1] - 4}
                        width="8"
                        height="8"
                        rx="1"
                        fill="var(--color-surface-container-lowest)"
                        stroke="var(--color-primary)"
                        stroke-width="1.5"
                        pointer-events="none"
                    />
                {/each}
            {/if}
        {/if}
    </svg>
</div>
