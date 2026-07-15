<script lang="ts">
    import { cn } from "$lib/utils.js";
    import type { Snippet } from "svelte";
    import type { HTMLAttributes } from "svelte/elements";

    export type GraphPadding = { t: number; r: number; b: number; l: number };

    export interface GraphGeometry {
        n: number;
        plotW: number;
        plotH: number;
        width: number;
        height: number;
        x: (i: number) => number;
        y: (v: number) => number;
        ticks: number[];
        hover: number | null;
        active: number;
    }

    let {
        height = 240,
        xCount,
        yMin,
        yMax,
        baseline = null,
        ticks = null,
        padding = { t: 16, r: 16, b: 28, l: 44 },
        hover = $bindable(null),
        active = $bindable(0),
        formatY = null,
        class: className,
        children,
        ...restProps
    }: {
        /** Height in px. Width fills container. */
        height?: number;
        /** Number of points along x-axis. */
        xCount: number;
        /** Domain min y. */
        yMin: number;
        /** Domain max y. */
        yMax: number;
        /** Reference baseline line (dashed). `null` to hide. */
        baseline?: number | null;
        /** Custom ticks. Auto-generated if null. */
        ticks?: number[] | null;
        /** Custom padding. */
        padding?: Partial<GraphPadding>;
        /** Two-way bindable hover index. */
        hover?: number | null;
        /** Two-way bindable active index (defaults to latest point). */
        active?: number;
        /** Optional formatter for Y axis labels */
        formatY?: ((v: number) => string) | null;
        /** Custom Svelte 5 snippet drawing content inside the SVG canvas. */
        children: Snippet<[GraphGeometry]>;
    } & Omit<HTMLAttributes<HTMLDivElement>, "children"> = $props();

    let width = $state(0);

    let pad = $derived({
        t: padding?.t ?? 16,
        r: padding?.r ?? 16,
        b: padding?.b ?? 28,
        l: padding?.l ?? 44,
    });

    $effect(() => {
        active = hover ?? (xCount > 0 ? xCount - 1 : 0);
    });

    let geo = $derived.by<GraphGeometry | null>(() => {
        const n = xCount;
        const plotW = Math.max(width - pad.l - pad.r, 0);
        const plotH = Math.max(height - pad.t - pad.b, 0);
        if (n === 0 || plotW === 0) return null;

        const lo = yMin;
        const hi = yMax;

        const x = (i: number) =>
            pad.l + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
        const y = (v: number) =>
            pad.t + plotH - ((v - lo) / (hi - lo)) * plotH;

        let computedTicks: number[] = [];
        if (ticks) {
            computedTicks = ticks;
        } else {
            const step =
                [25, 50, 100, 200, 250, 500, 1000].find(
                    (s) => (hi - lo) / s <= 5,
                ) ?? 1000;
            for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) {
                computedTicks.push(t);
            }
        }

        return {
            n,
            plotW,
            plotH,
            width,
            height,
            x,
            y,
            ticks: computedTicks,
            hover,
            active,
        };
    });

    function onMove(e: PointerEvent) {
        if (!geo || geo.n === 0) return;
        const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
        const px = e.clientX - rect.left;
        if (geo.n === 1) {
            hover = 0;
            return;
        }
        const frac = (px - pad.l) / geo.plotW;
        hover = Math.max(0, Math.min(geo.n - 1, Math.round(frac * (geo.n - 1))));
    }

    function onLeave() {
        hover = null;
    }
</script>

<div
    class={cn("relative w-full", className)}
    bind:clientWidth={width}
    {...restProps}
>
    <svg
        {width}
        {height}
        viewBox="0 0 {width} {height}"
        role="img"
        aria-label="Graph"
        class="block touch-none select-none"
        onpointermove={onMove}
        onpointerleave={onLeave}
    >
        {#if geo}
            <!-- Horizontal gridlines + Y labels -->
            {#each geo.ticks as t (t)}
                <line
                    x1={pad.l}
                    x2={width - pad.r}
                    y1={geo.y(t)}
                    y2={geo.y(t)}
                    stroke="var(--color-border)"
                    stroke-width="1"
                    opacity="0.4"
                />
                <text
                    x={pad.l - 8}
                    y={geo.y(t)}
                    text-anchor="end"
                    dominant-baseline="middle"
                    fill="var(--color-muted-foreground)"
                    font-size="10"
                    font-family="var(--font-mono, monospace)"
                >
                    {formatY ? formatY(t) : t}
                </text>
            {/each}

            <!-- Reference baseline (dashed) -->
            {#if baseline != null && baseline >= yMin && baseline <= yMax}
                <line
                    x1={pad.l}
                    x2={width - pad.r}
                    y1={geo.y(baseline)}
                    y2={geo.y(baseline)}
                    stroke="var(--color-muted-foreground)"
                    stroke-width="1"
                    stroke-dasharray="3 3"
                    opacity="0.5"
                />
            {/if}

            <!-- Child elements via snippet -->
            {@render children(geo)}

            <!-- Hover guide line -->
            {#if hover != null}
                <line
                    x1={geo.x(hover)}
                    x2={geo.x(hover)}
                    y1={pad.t}
                    y2={height - pad.b}
                    stroke="var(--color-muted-foreground)"
                    stroke-width="1"
                    opacity="0.5"
                />
            {/if}
        {/if}
    </svg>
</div>
