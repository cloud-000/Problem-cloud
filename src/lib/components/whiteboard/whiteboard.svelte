<script lang="ts">
    import { cn } from "$lib/utils.js";
    import type { Pair } from "$lib/asy/scene";
    import type { WhiteboardStore } from "$lib/state/whiteboard.svelte";
    import type { Project } from "./svg";
    import SceneElement from "./scene-element.svelte";

    let {
        store,
        backgroundSrc,
        showBackground = true,
        surface = $bindable(null),
        class: className,
    }: {
        store: WhiteboardStore;
        /** Optional image to trace over (e.g. a problem's pre-rendered diagram). */
        backgroundSrc?: string;
        showBackground?: boolean;
        /** Bindable ref to the underlying <svg> (for SVG/PNG export). */
        surface?: SVGSVGElement | null;
        class?: string;
    } = $props();
    let width = $state(0);
    let height = $state(0);
    let scale = $state(40); // px per asy unit
    let pointerId = $state<number | null>(null);

    const origin = $derived<[number, number]>([width / 2, height / 2]);
    const project = $derived.by<Project>(
        () => (p: Pair) => [origin[0] + p[0] * scale, origin[1] - p[1] * scale]
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

    function toAsy(e: PointerEvent): Pair {
        const rect = surface?.getBoundingClientRect();
        if (!rect) return [0, 0];
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        return [(px - origin[0]) / scale, (origin[1] - py) / scale];
    }

    function onPointerDown(e: PointerEvent) {
        if (e.button !== 0 || !surface) return;
        e.preventDefault();
        surface.focus(); // so keyboard shortcuts (undo/delete/Escape) work after a click
        pointerId = e.pointerId;
        try {
            surface.setPointerCapture(e.pointerId);
        } catch {
            // pointer capture is best-effort on some touch browsers
        }
        store.pointerDown(toAsy(e));
    }

    function onPointerMove(e: PointerEvent) {
        store.pointerMove(toAsy(e));
    }

    function onPointerUp(e: PointerEvent) {
        store.pointerUp(toAsy(e));
        if (surface && pointerId !== null && surface.hasPointerCapture(pointerId)) {
            try {
                surface.releasePointerCapture(pointerId);
            } catch {
                // already released
            }
        }
        pointerId = null;
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") {
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

    function onWheel(e: WheelEvent) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        scale = Math.max(8, Math.min(400, scale * factor));
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
</script>

<div
    class={cn("relative h-full w-full overflow-hidden bg-surface-container-lowest", className)}
    bind:clientWidth={width}
    bind:clientHeight={height}
>
    <!-- The whiteboard is a drawing surface: legitimately keyboard-focusable and
         pointer-interactive, but not one of ARIA's standard interactive elements. -->
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
        class="block touch-none select-none outline-none"
        class:cursor-crosshair={store.toolKind !== "select"}
        onkeydown={onKeyDown}
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerUp}
        onwheel={onWheel}
    >
        {#if width > 0}
            <!-- Trace backdrop -->
            {#if backgroundSrc && showBackground}
                <image
                    href={backgroundSrc}
                    x="0"
                    y="0"
                    {width}
                    {height}
                    opacity="0.35"
                    preserveAspectRatio="xMidYMid meet"
                />
            {/if}

            <!-- Grid -->
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

            <!-- Scene -->
            {#each store.displayScene.elements as element (element.id)}
                <SceneElement {element} {project} {scale} selected={selectedIds.has(element.id)} />
            {/each}
        {/if}
    </svg>
</div>
