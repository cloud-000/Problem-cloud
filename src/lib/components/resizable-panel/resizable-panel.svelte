<script lang="ts" module>
    import type { Snippet } from "svelte";
    import type { PanelSize, ResizeEdge } from "./resize";

    export interface ResizablePanelProps {
        children: Snippet;
        edges?: ResizeEdge[];
        initialWidth?: number;
        initialHeight?: number;
        minWidth?: number;
        maxWidth?: number;
        minHeight?: number;
        maxHeight?: number;
        storageKey?: string;
        revealAxis?: "horizontal" | "vertical";
        collapseWidthBelowMin?: boolean;
        collapseHeightBelowMin?: boolean;
        collapseThresholdRatio?: number;
        class?: string;
        ref?: HTMLElement | null;
        onSizeChange?: (size: PanelSize) => void;
        onResizeEnd?: (size: PanelSize) => void;
        onCollapse?: () => void;
    }
</script>

<script lang="ts">
    import { onMount } from "svelte";
    import { cubicOut } from "svelte/easing";
    import type { TransitionConfig } from "svelte/transition";
    import { cn } from "$lib/utils";
    import {
        clampPanelSize,
        mergePanelSize,
        parsePersistedPanelSize,
        resizePanel,
        serializePanelSize,
    } from "./resize";

    let {
        children,
        edges = [],
        initialWidth,
        initialHeight,
        minWidth = 0,
        maxWidth = Number.POSITIVE_INFINITY,
        minHeight = 0,
        maxHeight = Number.POSITIVE_INFINITY,
        storageKey,
        revealAxis,
        collapseWidthBelowMin = false,
        collapseHeightBelowMin = false,
        collapseThresholdRatio = 0.5,
        class: className,
        ref = $bindable(null),
        onSizeChange,
        onResizeEnd,
        onCollapse,
    }: ResizablePanelProps = $props();

    let storedSize = $state<PanelSize>({});
    let mounted = $state(false);
    let ready = $state(false);
    let activeEdges = $state<ResizeEdge[]>([]);
    let startX = 0;
    let startY = 0;
    let startSize: PanelSize = {};
    let activePointerId: number | null = null;
    let activeHandle: HTMLElement | null = null;

    let constraints = $derived({ minWidth, maxWidth, minHeight, maxHeight });
    let horizontalEdges = $derived(edges.filter((edge) => edge === "left" || edge === "right"));
    let verticalEdges = $derived(edges.filter((edge) => edge === "top" || edge === "bottom"));
    let horizontalEnabled = $derived(horizontalEdges.length > 0);
    let verticalEnabled = $derived(verticalEdges.length > 0);
    let activeConstraints = $derived({
        minWidth: horizontalEnabled ? minWidth : undefined,
        maxWidth: horizontalEnabled ? maxWidth : undefined,
        minHeight: verticalEnabled ? minHeight : undefined,
        maxHeight: verticalEnabled ? maxHeight : undefined,
    });
    let collapsible = $derived({
        width: collapseWidthBelowMin,
        height: collapseHeightBelowMin,
        thresholdRatio: collapseThresholdRatio,
    });
    let size = $derived.by(() => {
        const requested = {
            width: horizontalEnabled ? (storedSize.width ?? initialWidth) : undefined,
            height: verticalEnabled ? (storedSize.height ?? initialHeight) : undefined,
        };
        const clamped = clampPanelSize(requested, constraints);
        return {
            width:
                collapseWidthBelowMin && requested.width === 0
                    ? 0
                    : clamped.width,
            height:
                collapseHeightBelowMin && requested.height === 0
                    ? 0
                    : clamped.height,
        };
    });
    let dragging = $derived(activeEdges.length > 0);

    $effect(() => {
        if (!mounted) return;
        const fallback = { width: initialWidth, height: initialHeight };
        if (storageKey) {
            try {
                storedSize = parsePersistedPanelSize(
                    localStorage.getItem(storageKey),
                    fallback,
                    activeConstraints,
                );
            } catch {
                storedSize = clampPanelSize(fallback, activeConstraints);
            }
        } else {
            storedSize = clampPanelSize(fallback, activeConstraints);
        }
        ready = true;
        queueMicrotask(() => notifySize());
    });

    onMount(() => {
        mounted = true;
        return cleanupDrag;
    });

    function resizeReveal(
        node: HTMLElement,
        { axis }: { axis?: "horizontal" | "vertical" },
    ): TransitionConfig {
        if (!axis) return { duration: 0 };
        const bounds = node.getBoundingClientRect();
        const dimension = axis === "horizontal" ? bounds.width : bounds.height;
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        return {
            duration: reducedMotion ? 0 : 220,
            easing: cubicOut,
            css: (t) =>
                axis === "horizontal"
                    ? `width: ${dimension * t}px; opacity: ${t}`
                    : `height: ${dimension * t}px; opacity: ${t}`,
        };
    }

    function notifySize(end = false) {
        const current = { ...size };
        onSizeChange?.(current);
        if (end) onResizeEnd?.(current);
    }

    function cursorFor(handleEdges: readonly ResizeEdge[]) {
        const horizontal = handleEdges.some((edge) => edge === "left" || edge === "right");
        const vertical = handleEdges.some((edge) => edge === "top" || edge === "bottom");
        if (horizontal && vertical) {
            const sameDirection =
                (handleEdges.includes("left") && handleEdges.includes("top")) ||
                (handleEdges.includes("right") && handleEdges.includes("bottom"));
            return sameDirection ? "cursor-nwse-resize" : "cursor-nesw-resize";
        }
        return horizontal ? "cursor-col-resize" : "cursor-row-resize";
    }

    function beginResize(event: PointerEvent, handleEdges: ResizeEdge[]) {
        if (event.button !== 0 || !ref) return;
        event.preventDefault();
        event.stopPropagation();
        activeEdges = handleEdges;
        startX = event.clientX;
        startY = event.clientY;
        const bounds = ref.getBoundingClientRect();
        startSize = {
            width: horizontalEnabled ? bounds.width : undefined,
            height: verticalEnabled ? bounds.height : undefined,
        };
        activePointerId = event.pointerId;
        activeHandle = event.currentTarget as HTMLElement;
        try {
            activeHandle.setPointerCapture(event.pointerId);
        } catch {
            // Pointer capture is best-effort on older touch browsers.
        }
        document.body.classList.add("select-none", cursorFor(handleEdges));
    }

    function moveResize(event: PointerEvent) {
        if (!dragging) return;
        storedSize = mergePanelSize(
            storedSize,
            resizePanel(
                startSize,
                event.clientX - startX,
                event.clientY - startY,
                activeEdges,
                constraints,
                collapsible,
            ),
        );
        notifySize();
    }

    function persistSize() {
        if (!storageKey) return;
        const serialized = serializePanelSize(mergePanelSize(storedSize, size));
        try {
            if (serialized) localStorage.setItem(storageKey, serialized);
            else localStorage.removeItem(storageKey);
        } catch {
            // Storage can be unavailable in privacy-restricted browser contexts.
        }
    }

    function endResize() {
        if (!dragging) return;
        const collapsed = size.width === 0 || size.height === 0;
        cleanupDrag();
        if (collapsed) {
            onCollapse?.();
            return;
        }
        persistSize();
        notifySize(true);
        window.dispatchEvent(new Event("resize"));
    }

    function cleanupDrag() {
        if (activeHandle && activePointerId !== null && activeHandle.hasPointerCapture(activePointerId)) {
            try {
                activeHandle.releasePointerCapture(activePointerId);
            } catch {
                // The browser may already have released a cancelled pointer.
            }
        }
        document.body.classList.remove(
            "select-none",
            "cursor-col-resize",
            "cursor-row-resize",
            "cursor-nwse-resize",
            "cursor-nesw-resize",
        );
        activeEdges = [];
        activePointerId = null;
        activeHandle = null;
    }

    function keyboardResize(event: KeyboardEvent, handleEdges: ResizeEdge[]) {
        const step = event.shiftKey ? 64 : 16;
        let deltaX = 0;
        let deltaY = 0;
        if (event.key === "ArrowLeft") deltaX = -step;
        else if (event.key === "ArrowRight") deltaX = step;
        else if (event.key === "ArrowUp") deltaY = -step;
        else if (event.key === "ArrowDown") deltaY = step;
        else return;

        const usesHorizontal = handleEdges.some((edge) => edge === "left" || edge === "right");
        const usesVertical = handleEdges.some((edge) => edge === "top" || edge === "bottom");
        if ((!usesHorizontal && deltaX) || (!usesVertical && deltaY)) return;
        event.preventDefault();
        storedSize = mergePanelSize(
            storedSize,
            resizePanel(
                size,
                deltaX,
                deltaY,
                handleEdges,
                constraints,
                collapsible,
            ),
        );
        if (size.width === 0 || size.height === 0) {
            onCollapse?.();
            return;
        }
        persistSize();
        notifySize(true);
        window.dispatchEvent(new Event("resize"));
    }

    function edgeClass(edge: ResizeEdge) {
        if (edge === "left") return "inset-y-0 -left-2 w-4 cursor-col-resize";
        if (edge === "right") return "inset-y-0 -right-2 w-4 cursor-col-resize";
        if (edge === "top") return "inset-x-0 -top-2 h-4 cursor-row-resize";
        return "inset-x-0 -bottom-2 h-4 cursor-row-resize";
    }

    function cornerClass(horizontal: ResizeEdge, vertical: ResizeEdge) {
        const x = horizontal === "left" ? "-left-1" : "-right-1";
        const y = vertical === "top" ? "-top-1" : "-bottom-1";
        return `${x} ${y}`;
    }
</script>

<svelte:window onpointermove={moveResize} onpointerup={endResize} onpointercancel={endResize} />

{#if ready}
    <div
        bind:this={ref}
        data-slot="resizable-panel"
        data-resizing={dragging}
        class={cn("relative", className)}
        style:width={size.width === undefined ? undefined : `${size.width}px`}
        style:height={size.height === undefined ? undefined : `${size.height}px`}
        transition:resizeReveal|global={{ axis: revealAxis }}
    >
        {@render children()}

        {#each edges as edge (edge)}
            <button
                type="button"
                aria-label={`Resize panel from ${edge} edge`}
                title={`Resize from ${edge} edge`}
                class={cn(
                    "group absolute z-50 touch-none select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/60",
                    edgeClass(edge),
                )}
                onpointerdown={(event) => beginResize(event, [edge])}
                onkeydown={(event) => keyboardResize(event, [edge])}
            >
                <span
                    class={cn(
                        "pointer-events-none absolute rounded-full bg-border transition-all group-hover:bg-primary-foreground group-focus-visible:bg-primary-foreground",
                        edge === "left" || edge === "right"
                            ? "left-1/2 top-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 group-hover:h-12"
                            : "left-1/2 top-1/2 h-0.5 w-8 -translate-x-1/2 -translate-y-1/2 group-hover:w-12",
                        dragging && "bg-primary-foreground",
                    )}
                ></span>
            </button>
        {/each}

        {#each horizontalEdges as horizontal (horizontal)}
            {#each verticalEdges as vertical (`${horizontal}-${vertical}`)}
                <button
                    type="button"
                    aria-label={`Resize panel from ${vertical} ${horizontal} corner`}
                    class={cn(
                        "absolute z-60 size-4 touch-none rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/60",
                        cursorFor([horizontal, vertical]),
                        cornerClass(horizontal, vertical),
                    )}
                    onpointerdown={(event) => beginResize(event, [horizontal, vertical])}
                    onkeydown={(event) => keyboardResize(event, [horizontal, vertical])}
                ></button>
            {/each}
        {/each}
    </div>
{/if}
