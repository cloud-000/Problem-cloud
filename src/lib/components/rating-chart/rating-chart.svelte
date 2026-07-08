<script lang="ts">
    import { cn } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";
    import { Graph } from "$lib/components/graph";

    /** One point on the climb: a rated match's post-match rating (+ uncertainty). */
    export type RatingPoint = { at: string; rating: number; rd: number };

    let {
        points,
        height = 240,
        baseline = 1500,
        color = "var(--color-primary-foreground)",
        bandColor = "var(--color-primary)",
        bandOpacity = 0.12,
        class: className,
        ...restProps
    }: {
        /** Rating snapshots, oldest first (see `fetchPlayerRatingHistory`). */
        points: RatingPoint[];
        /** Plot height in px. Width fills the container. */
        height?: number;
        /** Reference line for the starting rating (dashed). `null` to hide. */
        baseline?: number | null;
        /** Color of the rating line and active marker. */
        color?: string;
        /** Color of the RD confidence band area. */
        bandColor?: string;
        /** Opacity of the RD confidence band area (0 to 1). */
        bandOpacity?: number;
    } & HTMLAttributes<HTMLDivElement> = $props();

    // Compute yMin and yMax boundaries from points + RD band + baseline
    let bounds = $derived.by(() => {
        if (points.length === 0) {
            return { yMin: 1200, yMax: 1800 };
        }
        let lo = Infinity;
        let hi = -Infinity;
        for (const p of points) {
            lo = Math.min(lo, p.rating - p.rd);
            hi = Math.max(hi, p.rating + p.rd);
        }
        if (baseline != null) {
            lo = Math.min(lo, baseline);
            hi = Math.max(hi, baseline);
        }
        // Pad the domain a touch so the band never kisses the edges.
        const span = Math.max(hi - lo, 1);
        lo -= span * 0.08;
        hi += span * 0.08;
        return { yMin: lo, yMax: hi };
    });

    let hoverIndex = $state<number | null>(null);
    let activeIndex = $state(0);

    const fmtDate = (iso: string) =>
        new Date(iso).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
        });

    // Default the readout to the latest point when not hovering.
    let activePt = $derived(points[activeIndex] ?? null);
</script>

<div
    class={cn("relative w-full", className)}
    {...restProps}
>
    {#if activePt}
        <!-- Floating readout for the active point -->
        <div
            class="pointer-events-none absolute right-0 top-0 flex items-baseline gap-2 text-right z-10"
        >
            <span class="font-mono text-2xl font-bold text-foreground">
                {Math.round(activePt.rating)}
            </span>
            <span class="text-xs text-muted-foreground">
                ± {Math.round(activePt.rd)} · {fmtDate(activePt.at)}
            </span>
        </div>
    {/if}

    {#if points.length > 0}
        <Graph
            xCount={points.length}
            yMin={bounds.yMin}
            yMax={bounds.yMax}
            {height}
            {baseline}
            bind:hover={hoverIndex}
            bind:active={activeIndex}
        >
            {#snippet children(geo)}
                <!-- Filled confidence band: upper edge (rating+rd) then lower edge reversed -->
                {#if points.length >= 2}
                    {@const up = points
                        .map((p, i) => `${i === 0 ? "M" : "L"}${geo.x(i)} ${geo.y(p.rating + p.rd)}`)
                        .join(" ")}
                    {@const down = points
                        .slice()
                        .reverse()
                        .map((p, i) => `L${geo.x(points.length - 1 - i)} ${geo.y(p.rating - p.rd)}`)
                        .join(" ")}
                    {@const bandD = `${up} ${down} Z`}
                    <path d={bandD} fill={bandColor} opacity={bandOpacity} />
                {/if}

                <!-- Rating line -->
                {@const lineD = points
                    .map((p, i) => `${i === 0 ? "M" : "L"}${geo.x(i)} ${geo.y(p.rating)}`)
                    .join(" ")}
                <path
                    d={lineD}
                    fill="none"
                    stroke={color}
                    stroke-width="2"
                    stroke-linejoin="round"
                    stroke-linecap="round"
                />

                <!-- Active point marker -->
                {#if activePt}
                    <circle
                        cx={geo.x(activeIndex)}
                        cy={geo.y(activePt.rating)}
                        r="4"
                        fill={color}
                        stroke="var(--color-surface-container-low)"
                        stroke-width="2"
                    />
                {/if}

                <!-- X-axis endpoints -->
                {#if points.length > 1}
                    <text
                        x={geo.x(0)}
                        y={height - 8}
                        text-anchor="start"
                        fill="var(--color-muted-foreground)"
                        font-size="10"
                    >
                        {fmtDate(points[0].at)}
                    </text>
                    <text
                        x={geo.x(points.length - 1)}
                        y={height - 8}
                        text-anchor="end"
                        fill="var(--color-muted-foreground)"
                        font-size="10"
                    >
                        {fmtDate(points[points.length - 1].at)}
                    </text>
                {/if}
            {/snippet}
        </Graph>
    {/if}
</div>
