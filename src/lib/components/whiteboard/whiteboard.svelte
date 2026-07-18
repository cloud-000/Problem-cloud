<script lang="ts">
    import { cn } from "$lib/utils.js";
    import { SvelteMap } from "svelte/reactivity";
    import type { Pair } from "$lib/asy/scene";
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
    let interaction = $state<"idle" | "draw" | "pan" | "pinch">("idle");
    let spacePressed = $state(false);
    let panStart: { clientX: number; clientY: number; x: number; y: number } | null = null;
    const activeTouches = new SvelteMap<number, { clientX: number; clientY: number }>();
    let pinchStart: { distance: number; scale: number; world: Pair } | null = null;

    const origin = $derived<[number, number]>([width / 2 + panX, height / 2 + panY]);
    const project = $derived.by<Project>(
        () => (p: Pair) => [origin[0] + p[0] * scale, origin[1] - p[1] * scale],
    );
    const selectedIds = $derived(new Set(store.selection));

    // Keep the engine's asy-space tolerances in sync with the current zoom.
    $effect(() => {
        store.tolerance = 8 / scale;
        store.simplifyEpsilon = 2.5 / scale;
    });

    // Supply a text prompt for the label tool.
    $effect(() => {
        store.promptLabel = () =>
            typeof window !== "undefined" ? window.prompt("Label (LaTeX, e.g. $A$):") : null;
        return () => {
            store.promptLabel = undefined;
        };
    });

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

        interaction = "draw";
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
        } else if (interaction === "draw") {
            store.pointerMove(toAsyAt(e.clientX, e.clientY));
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
        if (interaction === "draw") store.pointerUp(toAsyAt(e.clientX, e.clientY));
        pointerId = null;
        panStart = null;
        interaction = "idle";
    }

    function onKeyDown(e: KeyboardEvent) {
        if (navigation && e.key === " ") {
            e.preventDefault();
            spacePressed = true;
        } else if (e.key === "Escape") {
            store.cancel();
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
        bind:this={surface}
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
        onkeydown={onKeyDown}
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerUp}
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
                />
            {/if}
        {/if}
    </svg>
</div>
