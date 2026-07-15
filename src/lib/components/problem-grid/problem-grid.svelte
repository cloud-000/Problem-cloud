<script lang="ts" module>
    /** Outcome/answer state a cell paints. `answered`/`unanswered` are used while a
     *  test is in progress (grading deferred); the correct/incorrect/skipped trio is
     *  used on review and for Countdown per-segment reveal. */
    export type ProblemGridCellState =
        | "answered"
        | "unanswered"
        | "correct"
        | "incorrect"
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
</script>

<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { cn } from "$lib/utils";

    let {
        cells,
        onSelect,
        class: className,
    }: {
        cells: ProblemGridCell[];
        /** Jump to a cell (by its array index). Omitted → cells are display-only. */
        onSelect?: (index: number) => void;
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
            case "answered":
                return "border-primary-foreground bg-primary-foreground text-surface-container-lowest shadow-xs";
            default:
                return "border-border/60 bg-surface-container text-muted-foreground";
        }
    }
</script>

<div
    class={cn(
        "grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1.5",
        className,
    )}
>
    {#each cells as cell, index (index)}
        {@const interactive = !!onSelect && !cell.disabled}
        <svelte:element
            this={interactive ? "button" : "div"}
            role={interactive ? "button" : undefined}
            type={interactive ? "button" : undefined}
            tabindex={interactive ? 0 : undefined}
            aria-label={`Problem ${cell.label}`}
            aria-current={cell.current ? "true" : undefined}
            onclick={interactive ? () => onSelect?.(index) : undefined}
            class={cn(
                "relative flex aspect-square min-w-0 items-center justify-center rounded-md border text-xs font-medium tabular-nums transition-colors",
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
