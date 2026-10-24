<script lang="ts">
    import { onDestroy } from "svelte";
    import type { ProblemGridCell, ProblemGridCellState, ProblemGridVariant } from "#lib/components/problem-grid/index.js";
    import { TIME_RANGE_HOLD_MS, timeRangeGesture } from "./test-time-range-gesture";
    import type { TimeRangeSelection } from "./test-time-range";
    import { Icon } from "#lib/components/icon/index.js";
    import { cn } from "#lib/utils.js";

    let {
        cells,
        onSelect,
        selection,
        onEndpoint,
        variant = "grid",
        class: className,
    }: {
        cells: ProblemGridCell[];
        selection: TimeRangeSelection;
        onEndpoint: (index: number) => void;
        /** Keep the review navigation separate from range selection. */
        onSelect: (index: number) => void;
        variant?: ProblemGridVariant;
        class?: string;
    } = $props();

    let holding = $state<number | null>(null);
    const gesture = timeRangeGesture((index) => onEndpoint(index), (index) => holding = index);
    onDestroy(gesture.cancel);

    function click(event: MouseEvent, index: number) {
        if (gesture.consumeClick(index)) {
            event.preventDefault();
            return;
        }
        if (event.shiftKey) {
            event.preventDefault();
            onEndpoint(index);
        } else {
            onSelect(index);
        }
    }

    function keydown(event: KeyboardEvent, index: number) {
        gesture.resetClick();
        if (event.shiftKey && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            if (!event.repeat) onEndpoint(index);
        }
    }

    function stateClass(state: ProblemGridCellState): string {
        switch (state) {
            case "correct":
                return "border-correct/30 bg-correct/15 text-correct";
            case "incorrect":
                return "border-destructive/30 bg-destructive/15 text-destructive";
            case "skipped":
                return "border-unsure/30 bg-unsure/15 text-unsure";
            case "ungraded":
                return "border-border bg-surface-container-high text-muted-foreground";
            case "answered":
                return "border-primary-foreground bg-primary-foreground text-surface-container-lowest shadow-xs";
            default:
                return "border-border/60 bg-surface-container text-muted-foreground";
        }
    }

    function autoScrollCell(node: HTMLElement, isCurrent: () => boolean | undefined) {
        $effect(() => {
            if (isCurrent() && variant === "strip") {
                const parent = node.parentElement;
                if (!parent) return;
                const nodeLeft = node.offsetLeft;
                const nodeRight = nodeLeft + node.offsetWidth;
                const parentLeft = parent.scrollLeft;
                const parentRight = parentLeft + parent.clientWidth;
                if (nodeLeft < parentLeft) {
                    parent.scrollTo({ left: Math.max(0, nodeLeft - 8), behavior: "smooth" });
                } else if (nodeRight > parentRight) {
                    parent.scrollTo({
                        left: nodeRight - parent.clientWidth + 8,
                        behavior: "smooth",
                    });
                }
            }
        });
    }

    function handleWheel(e: WheelEvent) {
        if (variant !== "strip") return;
        const target = e.currentTarget as HTMLElement;
        if (e.deltaY !== 0 && e.deltaX === 0) {
            target.scrollLeft += e.deltaY;
        }
    }
</script>

<span id="test-time-range-hint" class="sr-only">Shift-click, hold, or Shift+Enter/Space to toggle a time range. Escape clears.</span>

<div
    class={cn(
        variant === "strip"
            ? "flex select-none items-center gap-1.5 overflow-x-auto py-1 scrollbar-none scroll-smooth overscroll-x-contain"
            : "grid select-none grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1.5",
        className,
    )}
    onwheel={handleWheel}
>
    {#each cells as cell, index (index)}
        {@const selected = selection !== null && index >= Math.min(selection.start, selection.end) && index <= Math.max(selection.start, selection.end)}
        {@const endpoint = selection !== null && (index === selection.start || index === selection.end)}
        <button
            use:autoScrollCell={() => cell.current}
            type="button"
            disabled={cell.disabled}
            aria-label={`Problem ${cell.label}, ${cell.state}${selected ? ", in time range" : ""}${endpoint ? ", range endpoint" : ""}`}
            aria-describedby="test-time-range-hint"
            aria-current={cell.current ? "true" : undefined}
            onclick={(event) => click(event, index)}
            onkeydown={(event) => keydown(event, index)}
            onpointerdown={(event) => gesture.down(event, index)}
            onpointermove={gesture.move}
            onpointerup={gesture.cancel}
            onpointercancel={gesture.cancel}
            onpointerleave={gesture.cancel}
            oncontextmenu={(event) => { if (gesture.preventContextMenu(index)) event.preventDefault(); }}
            style={`-webkit-touch-callout: none; -webkit-user-select: none; --hold-duration: ${TIME_RANGE_HOLD_MS}ms;`}
            class={cn(
                "relative flex select-none aspect-square min-w-0 items-center justify-center rounded-md border text-xs font-medium tabular-nums transition-colors",
                variant === "strip" && "size-11 shrink-0",
                stateClass(cell.state),
                cell.current && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                selected && "range-selected font-semibold",
                endpoint && "range-endpoint font-bold",
                holding === index && "hold-progress",
                cell.disabled && "opacity-45",
                "cursor-pointer hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
            )}
        >
            {cell.label}
            {#if cell.flagged}
                <Icon
                    name="flag"
                    class="absolute -right-0.5 -top-0.5 size-[0.85em] text-unsure"
                    fill
                />
            {/if}
        </button>
    {/each}
</div>

<style>
    .range-selected {
        background-image: linear-gradient(
            color-mix(in srgb, var(--color-primary-foreground) 14%, transparent),
            color-mix(in srgb, var(--color-primary-foreground) 14%, transparent)
        );
    }

    .range-selected::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-primary-foreground) 75%, transparent);
    }

    .range-endpoint {
        background-image: linear-gradient(
            color-mix(in srgb, var(--color-primary-foreground) 24%, transparent),
            color-mix(in srgb, var(--color-primary-foreground) 24%, transparent)
        );
        font-size: 0.875rem;
    }

    .range-endpoint::before {
        box-shadow: inset 0 0 0 3px var(--color-primary-foreground);
    }

    .range-endpoint::after {
        content: "";
        position: absolute;
        top: 0;
        left: 25%;
        right: 25%;
        height: 5px;
        border-radius: 0 0 3px 3px;
        background: var(--color-primary-foreground);
        pointer-events: none;
    }

    .hold-progress { animation: hold-confirm var(--hold-duration) linear forwards; }
    @keyframes hold-confirm {
        from { box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-primary-foreground) 15%, transparent); }
        to { box-shadow: inset 0 0 0 3px var(--color-primary-foreground); }
    }
</style>
