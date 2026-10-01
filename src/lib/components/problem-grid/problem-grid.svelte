<script lang="ts" module>
    /** Outcome/answer state a cell paints. `answered`/`unanswered` are used while a
     *  test is in progress (grading deferred); the correct/incorrect/skipped trio is
     *  used on review and for Countdown per-segment reveal. */
    export type ProblemGridCellState =
        | "answered"
        | "unanswered"
        | "correct"
        | "incorrect"
        | "ungraded"
        | "skipped";

    export type ProblemGridCell = {
        /** 1-based label shown in the cell. */
        label: number;
        state: ProblemGridCellState;
        /** Ring the cell as the one currently on screen. */
        current?: boolean;
        /** Show the flag corner. */
        flagged?: boolean;
        /** Locked/non-jumpable (e.g. a locked segment); rendered dimmed + inert. */
        disabled?: boolean;
    };

    export type ProblemGridVariant = "grid" | "strip";
</script>

<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { cn } from "$lib/utils";

    let {
        cells,
        onSelect,
        variant = "grid",
        class: className,
    }: {
        cells: ProblemGridCell[];
        /** Jump to a cell (by its array index). Omitted → cells are display-only. */
        onSelect?: (index: number) => void;
        variant?: ProblemGridVariant;
        class?: string;
    } = $props();

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

    function autoScrollCell(node: HTMLElement, isCurrent: boolean | undefined) {
        $effect(() => {
            if (isCurrent && variant === "strip") {
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

<div
    class={cn(
        variant === "strip"
            ? "flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none scroll-smooth overscroll-x-contain"
            : "grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1.5",
        className,
    )}
    onwheel={handleWheel}
>
    {#each cells as cell, index (index)}
        {@const interactive = !!onSelect && !cell.disabled}
        <svelte:element
            this={interactive ? "button" : "div"}
            use:autoScrollCell={cell.current}
            role={interactive ? "button" : undefined}
            type={interactive ? "button" : undefined}
            tabindex={interactive ? 0 : undefined}
            aria-label={`Problem ${cell.label}`}
            aria-current={cell.current ? "true" : undefined}
            onclick={interactive ? () => onSelect?.(index) : undefined}
            class={cn(
                "relative flex aspect-square min-w-0 items-center justify-center rounded-md border text-xs font-medium tabular-nums transition-colors",
                variant === "strip" && "size-8 shrink-0",
                stateClass(cell.state),
                cell.current && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                cell.disabled && "opacity-45",
                interactive &&
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
        </svelte:element>
    {/each}
</div>
