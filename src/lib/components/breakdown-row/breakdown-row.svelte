<script lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLAttributes } from "svelte/elements";
    import { cn } from "$lib/utils.js";
    import { SegmentBar, type Segment } from "$lib/components/segment-bar";

    /** A trailing labelled figure (e.g. an eventual-accuracy or avg-time column). */
    export type BreakdownMetric = {
        label: string;
        value: string;
        title?: string;
    };

    let {
        label,
        sublabel,
        score,
        scoreLabel = "first-try",
        segments,
        metrics = [],
        highlight = false,
        action,
        class: className,
        ...restProps
    }: {
        /** Primary heading for the row (e.g. a topic or series name). */
        label: string;
        /** Small dimmed line under the label (e.g. "12 problems · 40 attempts"). */
        sublabel?: string;
        /** Headline ratio 0..1, or null when there's no data (renders "—"). */
        score: number | null;
        /** Caption under the headline percentage. */
        scoreLabel?: string;
        /** Optional distribution bar (e.g. correct / incorrect / skipped). */
        segments?: Segment[];
        /** Trailing labelled figures (eventual accuracy, avg time, …). */
        metrics?: BreakdownMetric[];
        /** Emphasize the row — used for flagged weaknesses. */
        highlight?: boolean;
        /** Trailing action slot (e.g. a Drill button). */
        action?: Snippet;
    } & HTMLAttributes<HTMLDivElement> = $props();

    const pct = (v: number | null) =>
        v == null ? "—" : `${Math.round(v * 100)}%`;

    // Tint the headline by performance band; neutral when there is no data.
    let scoreTone = $derived(
        score == null
            ? "text-muted-foreground"
            : score >= 0.8
              ? "text-correct"
              : score >= 0.5
                ? "text-foreground"
                : "text-destructive",
    );
</script>

<div
    class={cn(
        "flex flex-col gap-3 rounded-xl border border-border/60 bg-surface-container-lowest p-4 shadow-xs transition-colors sm:flex-row sm:items-center sm:gap-5",
        highlight && "border-destructive/40 bg-destructive/5",
        className,
    )}
    {...restProps}
>
    <!-- Label + distribution -->
    <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-semibold text-foreground">
            {label}
        </div>
        {#if sublabel}
            <div class="mt-0.5 truncate text-xs text-muted-foreground">
                {sublabel}
            </div>
        {/if}
        {#if segments && segments.length > 0}
            <SegmentBar {segments} class="mt-2 max-w-full" />
        {/if}
    </div>

    <!-- Headline score -->
    <div class="flex shrink-0 flex-col items-start sm:items-end">
        <div class={cn("font-mono text-2xl font-bold tabular-nums", scoreTone)}>
            {pct(score)}
        </div>
        <div
            class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
            {scoreLabel}
        </div>
    </div>

    <!-- Secondary metrics -->
    {#if metrics.length > 0}
        <div class="flex shrink-0 gap-4 sm:gap-5">
            {#each metrics as m (m.label)}
                <div class="flex flex-col" title={m.title}>
                    <span
                        class="font-mono text-sm font-semibold text-foreground tabular-nums"
                        >{m.value}</span
                    >
                    <span
                        class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                        >{m.label}</span
                    >
                </div>
            {/each}
        </div>
    {/if}

    <!-- Action -->
    {#if action}
        <div class="shrink-0">{@render action()}</div>
    {/if}
</div>
