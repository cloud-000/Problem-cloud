<script lang="ts">
    import { Graph } from "$lib/components/graph";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { RangeSlider } from "$lib/components/range-slider";

    // Demo 1: Sine / Cosine Wave Generator
    let frequency = $state(1);
    let amplitude = $state(300);
    let offset = $state(1500);
    let sinePointsCount = $state(20);

    let sinePoints = $derived.by(() => {
        return Array.from({ length: sinePointsCount }, (_, i) => {
            const angle = (i / (sinePointsCount - 1)) * Math.PI * 2 * frequency;
            return offset + Math.sin(angle) * amplitude;
        });
    });

    let sineHover = $state<number | null>(null);

    // Demo 2: Stock Price Random Walk
    let stockPoints = $state<number[]>([150, 155, 148, 160, 165, 158, 172, 169, 175, 185]);
    let stockHover = $state<number | null>(null);
    let baselineValue = $state(150);

    function generateStockWalk() {
        let current = 150;
        const walk = [current];
        for (let i = 0; i < 14; i++) {
            current = Math.round(current + (Math.random() - 0.48) * 15);
            walk.push(current);
        }
        stockPoints = walk;
    }

    // Config props
    let height = $state(260);
    let customTicksEnabled = $state(false);
    let customTicksList = [1000, 1250, 1500, 1750, 2000];
    let ticks = $derived(customTicksEnabled ? customTicksList : null);

    let paddingVariant = $state<"standard" | "wide" | "narrow">("standard");
    let padding = $derived.by(() => {
        if (paddingVariant === "wide") return { t: 24, r: 24, b: 36, l: 60 };
        if (paddingVariant === "narrow") return { t: 8, r: 8, b: 20, l: 30 };
        return { t: 16, r: 16, b: 28, l: 44 };
    });
</script>

<div class="space-y-8 pb-12">
    <!-- Header -->
    <div class="border-b border-border/80 pb-4">
        <h1 class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Icon name="insights" fontsize="2.25rem" class="text-primary-foreground" />
            Base Graph Component Test Bench
        </h1>
        <p class="text-sm text-muted-foreground mt-1">
            Tests the raw, generic <code>&lt;Graph&gt;</code> canvas component. It computes SVG coordinates and renders gridlines, while leaving final content rendering (paths, labels, dots) to custom consumer snippets.
        </p>
    </div>

    <!-- Layout Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        <!-- Controls Column -->
        <div class="lg:col-span-4 space-y-6">
            
            <!-- Sine Wave Parameters -->
            <div class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs space-y-4">
                <h3 class="text-base font-semibold text-foreground border-b border-border/50 pb-2 flex items-center gap-1.5">
                    <Icon name="settings" fontsize="1.25rem" />
                    Sine Wave Inputs
                </h3>
                
                <div class="space-y-1.5">
                    <span class="text-xs font-semibold text-muted-foreground">FREQUENCY (CYCLES)</span>
                    <RangeSlider
                        single
                        bind:singleValue={frequency}
                        min={0.5}
                        max={3}
                        step={0.1}
                        label="Frequency"
                    />
                </div>

                <div class="space-y-1.5">
                    <span class="text-xs font-semibold text-muted-foreground">AMPLITUDE</span>
                    <RangeSlider
                        single
                        bind:singleValue={amplitude}
                        min={50}
                        max={600}
                        step={10}
                        label="Amplitude"
                    />
                </div>

                <div class="space-y-1.5">
                    <span class="text-xs font-semibold text-muted-foreground">RESOLUTION (POINTS)</span>
                    <RangeSlider
                        single
                        bind:singleValue={sinePointsCount}
                        min={5}
                        max={50}
                        step={1}
                        label="Resolution"
                    />
                </div>
            </div>

            <!-- Global Configurations -->
            <div class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs space-y-4">
                <h3 class="text-base font-semibold text-foreground border-b border-border/50 pb-2 flex items-center gap-1.5">
                    <Icon name="tune" fontsize="1.25rem" />
                    General Settings
                </h3>

                <div class="space-y-1.5">
                    <span class="text-xs font-semibold text-muted-foreground">CANVAS HEIGHT</span>
                    <RangeSlider
                        single
                        bind:singleValue={height}
                        min={150}
                        max={400}
                        step={10}
                        formatValue={(v) => `${v}px`}
                        label="Canvas Height"
                    />
                </div>

                <div class="space-y-1.5">
                    <span class="text-sm font-medium text-foreground block">Canvas Padding</span>
                    <div class="grid grid-cols-3 gap-2">
                        <Button variant={paddingVariant === "standard" ? "default" : "outline"} size="xs" onclick={() => paddingVariant = "standard"}>Standard</Button>
                        <Button variant={paddingVariant === "wide" ? "default" : "outline"} size="xs" onclick={() => paddingVariant = "wide"}>Wide</Button>
                        <Button variant={paddingVariant === "narrow" ? "default" : "outline"} size="xs" onclick={() => paddingVariant = "narrow"}>Narrow</Button>
                    </div>
                </div>

                <div class="space-y-1.5 pt-1">
                    <label class="flex items-center gap-2 text-sm text-foreground cursor-pointer font-medium">
                        <input type="checkbox" bind:checked={customTicksEnabled} class="rounded border-border text-primary size-4" />
                        Use Custom Y Ticks
                    </label>
                    {#if customTicksEnabled}
                        <p class="text-xs text-muted-foreground pl-6">
                            Forcing labels exactly at: 1000, 1250, 1500, 1750, 2000
                        </p>
                    {/if}
                </div>
            </div>

            <!-- Stock Price Control -->
            <div class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs space-y-4">
                <h3 class="text-base font-semibold text-foreground border-b border-border/50 pb-2 flex items-center gap-1.5">
                    <Icon name="trending_up" fontsize="1.25rem" />
                    Random Walk Settings
                </h3>
                
                <div class="space-y-1.5">
                    <span class="text-xs font-semibold text-muted-foreground">BASELINE PRICE</span>
                    <RangeSlider
                        single
                        bind:singleValue={baselineValue}
                        min={100}
                        max={200}
                        step={5}
                        formatValue={(v) => `$${v}`}
                        label="Baseline Price"
                    />
                </div>

                <Button variant="outline" size="sm" onclick={generateStockWalk} class="w-full">
                    <Icon name="refresh" fontsize="1.1rem" class="mr-1" />
                    Generate Stock History
                </Button>
            </div>

        </div>

        <!-- Visual Previews Column -->
        <div class="lg:col-span-8 space-y-6">
            
            <!-- Demo 1: Sine Wave Canvas -->
            <div class="border border-border/80 rounded-xl p-6 bg-surface-container-lowest shadow-xs space-y-4">
                <div class="flex justify-between items-center border-b border-border/50 pb-2">
                    <h3 class="text-lg font-semibold text-foreground flex items-center gap-2">
                        <Icon name="waves" />
                        Custom Sine Wave Plotting
                    </h3>
                    <div class="text-sm font-mono text-muted-foreground">
                        Hover index: {sineHover !== null ? sineHover : "none"} · Value: {sineHover !== null ? Math.round(sinePoints[sineHover]) : "—"}
                    </div>
                </div>

                <div class="bg-surface-container-low border border-border/40 rounded-xl p-4">
                    <Graph
                        xCount={sinePoints.length}
                        yMin={700}
                        yMax={2300}
                        {height}
                        baseline={offset}
                        ticks={ticks}
                        {padding}
                        bind:hover={sineHover}
                    >
                        {#snippet children(geo)}
                            <!-- Area fill -->
                            {@const areaD = [
                                `M${geo.x(0)} ${geo.y(700)}`,
                                ...sinePoints.map((v, i) => `L${geo.x(i)} ${geo.y(v)}`),
                                `L${geo.x(sinePoints.length - 1)} ${geo.y(700)}`,
                                "Z"
                            ].join(" ")}
                            <path d={areaD} fill="var(--color-primary)" opacity="0.06" />

                            <!-- Main spline path -->
                            {@const pathD = sinePoints
                                .map((v, i) => `${i === 0 ? "M" : "L"}${geo.x(i)} ${geo.y(v)}`)
                                .join(" ")}
                            <path
                                d={pathD}
                                fill="none"
                                stroke="var(--color-primary)"
                                stroke-width="2.5"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            />

                            <!-- Circular node markers -->
                            {#each sinePoints as v, i (i)}
                                <circle
                                    cx={geo.x(i)}
                                    cy={geo.y(v)}
                                    r="3"
                                    fill="var(--color-primary)"
                                    stroke="var(--color-surface-container-low)"
                                    stroke-width="1"
                                />
                            {/each}

                            <!-- Active pointer cursor overlay -->
                            {#if sineHover !== null}
                                <circle
                                    cx={geo.x(sineHover)}
                                    cy={geo.y(sinePoints[sineHover])}
                                    r="6.5"
                                    fill="var(--color-primary)"
                                    stroke="var(--color-surface-container-lowest)"
                                    stroke-width="2.5"
                                />
                            {/if}
                        {/snippet}
                    </Graph>
                </div>
            </div>

            <!-- Demo 2: Simulated Stock Canvas -->
            <div class="border border-border/80 rounded-xl p-6 bg-surface-container-lowest shadow-xs space-y-4">
                <div class="flex justify-between items-center border-b border-border/50 pb-2">
                    <h3 class="text-lg font-semibold text-foreground flex items-center gap-2">
                        <Icon name="query_stats" />
                        Simulated Stock Walk (Area + Gradient)
                    </h3>
                    <div class="text-sm font-mono text-muted-foreground">
                        Price: {stockHover !== null ? `$${stockPoints[stockHover]}` : "—"}
                    </div>
                </div>

                <div class="bg-surface-container-low border border-border/40 rounded-xl p-4">
                    <Graph
                        xCount={stockPoints.length}
                        yMin={80}
                        yMax={240}
                        {height}
                        baseline={baselineValue}
                        {padding}
                        bind:hover={stockHover}
                    >
                        {#snippet children(geo)}
                            <!-- Draw the stock line -->
                            {@const linePath = stockPoints
                                .map((v, i) => `${i === 0 ? "M" : "L"}${geo.x(i)} ${geo.y(v)}`)
                                .join(" ")}
                            
                            <!-- Positive green and negative red coloring depending on price relative to baseline -->
                            <path
                                d={linePath}
                                fill="none"
                                stroke={stockPoints[stockPoints.length - 1] >= baselineValue ? "var(--color-correct)" : "var(--color-destructive)"}
                                stroke-width="2.5"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            />

                            <!-- Area fill underneath stock line -->
                            {@const areaPath = [
                                `M${geo.x(0)} ${geo.y(80)}`,
                                ...stockPoints.map((v, i) => `L${geo.x(i)} ${geo.y(v)}`),
                                `L${geo.x(stockPoints.length - 1)} ${geo.y(80)}`,
                                "Z"
                            ].join(" ")}
                            <path 
                                d={areaPath} 
                                fill={stockPoints[stockPoints.length - 1] >= baselineValue ? "var(--color-correct)" : "var(--color-destructive)"} 
                                opacity="0.08" 
                            />

                            <!-- Circle nodes on endpoints -->
                            <circle
                                cx={geo.x(0)}
                                cy={geo.y(stockPoints[0])}
                                r="4"
                                fill="var(--color-muted-foreground)"
                            />
                            <circle
                                cx={geo.x(stockPoints.length - 1)}
                                cy={geo.y(stockPoints[stockPoints.length - 1])}
                                r="4"
                                fill={stockPoints[stockPoints.length - 1] >= baselineValue ? "var(--color-correct)" : "var(--color-destructive)"}
                            />

                            {#if stockHover !== null}
                                <circle
                                    cx={geo.x(stockHover)}
                                    cy={geo.y(stockPoints[stockHover])}
                                    r="5.5"
                                    fill="var(--foreground)"
                                    stroke="var(--color-surface-container-lowest)"
                                    stroke-width="2"
                                />
                            {/if}
                        {/snippet}
                    </Graph>
                </div>
            </div>

        </div>

    </div>
</div>
