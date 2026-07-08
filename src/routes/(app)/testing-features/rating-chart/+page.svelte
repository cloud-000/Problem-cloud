<script lang="ts">
    import { RatingChart } from "$lib/components/rating-chart";
    import type { RatingPoint } from "$lib/components/rating-chart";
    import { Button } from "$lib/components/button";
    import { Input } from "$lib/components/input";
    import { Icon } from "$lib/components/icon";
    import { RangeSlider } from "$lib/components/range-slider";

    // Standard preset data
    const PRESETS = {
        climb: [
            { at: "2026-06-01T10:00:00Z", rating: 1200, rd: 350 },
            { at: "2026-06-05T12:30:00Z", rating: 1280, rd: 280 },
            { at: "2026-06-10T14:15:00Z", rating: 1350, rd: 220 },
            { at: "2026-06-15T09:00:00Z", rating: 1420, rd: 180 },
            { at: "2026-06-20T18:45:00Z", rating: 1510, rd: 140 },
            { at: "2026-06-25T11:20:00Z", rating: 1590, rd: 110 },
            { at: "2026-06-30T16:00:00Z", rating: 1680, rd: 90 },
            { at: "2026-07-05T15:30:00Z", rating: 1750, rd: 75 },
        ],
        volatile: [
            { at: "2026-06-01T08:00:00Z", rating: 1400, rd: 200 },
            { at: "2026-06-04T12:00:00Z", rating: 1650, rd: 180 },
            { at: "2026-06-08T10:00:00Z", rating: 1350, rd: 190 },
            { at: "2026-06-12T15:00:00Z", rating: 1720, rd: 170 },
            { at: "2026-06-16T11:00:00Z", rating: 1480, rd: 180 },
            { at: "2026-06-20T14:00:00Z", rating: 1850, rd: 160 },
            { at: "2026-06-24T09:00:00Z", rating: 1550, rd: 170 },
            { at: "2026-06-28T16:00:00Z", rating: 1910, rd: 150 },
        ],
        plateau: [
            { at: "2026-06-01T00:00:00Z", rating: 1600, rd: 50 },
            { at: "2026-06-03T00:00:00Z", rating: 1595, rd: 48 },
            { at: "2026-06-05T00:00:00Z", rating: 1605, rd: 46 },
            { at: "2026-06-07T00:00:00Z", rating: 1602, rd: 45 },
            { at: "2026-06-09T00:00:00Z", rating: 1598, rd: 44 },
            { at: "2026-06-11T00:00:00Z", rating: 1601, rd: 43 },
            { at: "2026-06-13T00:00:00Z", rating: 1606, rd: 42 },
            { at: "2026-06-15T00:00:00Z", rating: 1599, rd: 41 },
        ],
        single: [
            { at: "2026-07-01T12:00:00Z", rating: 1550, rd: 120 },
        ],
        empty: [],
    };

    let selectedPreset = $state<keyof typeof PRESETS>("climb");
    let points = $state<RatingPoint[]>([...PRESETS.climb]);

    function loadPreset(presetKey: keyof typeof PRESETS) {
        selectedPreset = presetKey;
        points = JSON.parse(JSON.stringify(PRESETS[presetKey]));
    }

    // Config props
    let height = $state(280);
    let enableBaseline = $state(true);
    let baselineValue = $state(1500);
    let baseline = $derived(enableBaseline ? baselineValue : null);

    // Form inputs for adding points
    let newRating = $state(1600);
    let newRd = $state(100);
    let newDateStr = $state(new Date().toISOString().split("T")[0]);

    function addPoint() {
        const d = newDateStr ? new Date(newDateStr) : new Date();
        const at = d.toISOString();
        points = [...points, { at, rating: Number(newRating), rd: Number(newRd) }].sort(
            (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
        );
    }

    function removePoint(index: number) {
        points = points.filter((_, i) => i !== index);
    }

    function addRandomPoint() {
        const lastPoint = points[points.length - 1];
        const lastDate = lastPoint ? new Date(lastPoint.at) : new Date();
        const nextDate = new Date(lastDate.getTime() + 24 * 60 * 60 * 1000); // +1 day
        const lastRating = lastPoint ? lastPoint.rating : 1500;
        const lastRd = lastPoint ? lastPoint.rd : 350;

        const ratingChange = Math.round((Math.random() - 0.5) * 120);
        const nextRating = Math.max(100, lastRating + ratingChange);
        const nextRd = Math.max(30, Math.round(lastRd * 0.96)); // decay uncertainty

        points = [...points, {
            at: nextDate.toISOString(),
            rating: nextRating,
            rd: nextRd,
        }];
    }

    function clearAll() {
        points = [];
    }
</script>

<div class="space-y-8 pb-12">
    <!-- Header -->
    <div class="border-b border-border/80 pb-4">
        <h1 class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Icon name="show_chart" fontsize="2.25rem" class="text-primary-foreground" />
            Rating Chart Test Bench
        </h1>
        <p class="text-sm text-muted-foreground mt-1">
            Tests the responsive <code>&lt;RatingChart&gt;</code> SVG line graph with its Glicko RD confidence band, starting baseline, gridlines, and hover tracking.
        </p>
    </div>

    <!-- Layout Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        <!-- Controls Column -->
        <div class="lg:col-span-5 space-y-6">
            
            <!-- Preset Selector -->
            <div class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs space-y-4">
                <h3 class="text-base font-semibold text-foreground border-b border-border/50 pb-2 flex items-center gap-1.5">
                    <Icon name="settings_backup_restore" fontsize="1.25rem" />
                    Data Presets
                </h3>
                <div class="flex flex-wrap gap-2">
                    <Button 
                        variant={selectedPreset === "climb" ? "default" : "outline"} 
                        size="sm"
                        onclick={() => loadPreset("climb")}
                    >
                        Steady Climb
                    </Button>
                    <Button 
                        variant={selectedPreset === "volatile" ? "default" : "outline"} 
                        size="sm"
                        onclick={() => loadPreset("volatile")}
                    >
                        Volatile Swings
                    </Button>
                    <Button 
                        variant={selectedPreset === "plateau" ? "default" : "outline"} 
                        size="sm"
                        onclick={() => loadPreset("plateau")}
                    >
                        Stable Plateau
                    </Button>
                    <Button 
                        variant={selectedPreset === "single" ? "default" : "outline"} 
                        size="sm"
                        onclick={() => loadPreset("single")}
                    >
                        Single Point
                    </Button>
                    <Button 
                        variant={selectedPreset === "empty" ? "default" : "outline"} 
                        size="sm"
                        onclick={() => loadPreset("empty")}
                    >
                        Empty (0 Points)
                    </Button>
                </div>
            </div>

            <!-- Configuration Parameters -->
            <div class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs space-y-4">
                <h3 class="text-base font-semibold text-foreground border-b border-border/50 pb-2 flex items-center gap-1.5">
                    <Icon name="tune" fontsize="1.25rem" />
                    Chart Props
                </h3>
                
                <!-- Height Control -->
                <div class="space-y-1.5">
                    <span class="text-sm font-medium text-foreground">Chart Height</span>
                    <RangeSlider
                        single
                        bind:singleValue={height}
                        min={120}
                        max={500}
                        step={10}
                        formatValue={(v) => `${v}px`}
                        label="Chart Height"
                    />
                </div>

                <!-- Baseline Control -->
                <div class="space-y-3 pt-2">
                    <label class="flex items-center gap-2 cursor-pointer text-sm text-foreground font-medium">
                        <input 
                            type="checkbox" 
                            bind:checked={enableBaseline}
                            class="rounded border-border text-primary focus:ring-primary size-4" 
                        />
                        Show Baseline Reference Line
                    </label>

                    {#if enableBaseline}
                        <div class="space-y-1.5 pl-6">
                            <span class="text-sm text-muted-foreground">Baseline Rating</span>
                            <RangeSlider
                                single
                                bind:singleValue={baselineValue}
                                min={800}
                                max={2400}
                                step={50}
                                label="Baseline Rating"
                            />
                        </div>
                    {/if}
                </div>
            </div>

            <!-- Add New Point Form -->
            <div class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs space-y-4">
                <h3 class="text-base font-semibold text-foreground border-b border-border/50 pb-2 flex items-center gap-1.5">
                    <Icon name="add" fontsize="1.25rem" />
                    Add Rating Point
                </h3>
                <div class="grid grid-cols-3 gap-3">
                    <label class="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
                        RATING
                        <Input type="number" min="0" max="3000" bind:value={newRating} />
                    </label>
                    <label class="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
                        RD (± ERROR)
                        <Input type="number" min="0" max="500" bind:value={newRd} />
                    </label>
                    <label class="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
                        DATE
                        <Input type="date" bind:value={newDateStr} />
                    </label>
                </div>
                <div class="flex justify-between gap-3 pt-2">
                    <Button variant="outline" size="sm" onclick={addRandomPoint} class="flex-1">
                        <Icon name="casino" fontsize="1.1rem" class="mr-1" />
                        Generate Point
                    </Button>
                    <Button variant="default" size="sm" onclick={addPoint} class="flex-1">
                        Add Point
                    </Button>
                </div>
            </div>

        </div>

        <!-- Chart & Data Table Column -->
        <div class="lg:col-span-7 space-y-6">
            
            <!-- Live Preview Card -->
            <div class="border border-border/80 rounded-xl p-6 bg-surface-container-lowest shadow-xs space-y-6">
                <div class="flex justify-between items-center border-b border-border/50 pb-3">
                    <h3 class="text-lg font-semibold text-foreground flex items-center gap-2">
                        <Icon name="preview" />
                        Live Preview
                    </h3>
                    <div class="text-xs text-muted-foreground">
                        Points count: <strong class="font-mono text-foreground">{points.length}</strong>
                    </div>
                </div>

                <!-- Chart Box -->
                <div class="bg-surface-container-low border border-border/40 rounded-xl p-4 min-h-[160px] flex flex-col justify-center">
                    {#if points.length > 0}
                        <RatingChart {points} {height} {baseline} />
                    {:else}
                        <div class="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                            <Icon name="show_chart" fontsize="3rem" class="opacity-30" />
                            <p class="text-sm font-medium">No rating data points</p>
                            <p class="text-xs opacity-75">Click a preset or add a point to display the chart.</p>
                        </div>
                    {/if}
                </div>
            </div>

            <!-- Table of Points -->
            <div class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs space-y-4">
                <div class="flex justify-between items-center border-b border-border/50 pb-2">
                    <h3 class="text-base font-semibold text-foreground flex items-center gap-1.5">
                        <Icon name="list" fontsize="1.25rem" />
                        Manage Data Points
                    </h3>
                    {#if points.length > 0}
                        <Button variant="ghost" size="xs" onclick={clearAll} class="text-destructive hover:bg-destructive/10">
                            Clear All
                        </Button>
                    {/if}
                </div>

                {#if points.length > 0}
                    <div class="max-h-[300px] overflow-y-auto border border-border/60 rounded-lg">
                        <table class="w-full text-left border-collapse text-sm">
                            <thead>
                                <tr class="bg-surface-container-low border-b border-border/80 font-semibold text-muted-foreground">
                                    <th class="p-2.5 pl-4 w-12 text-center">#</th>
                                    <th class="p-2.5">Date</th>
                                    <th class="p-2.5 w-28">Rating</th>
                                    <th class="p-2.5 w-28">RD (Error)</th>
                                    <th class="p-2.5 w-16 text-center">Delete</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#each points as _, i (i)}
                                    <tr class="border-b border-border/40 last:border-0 hover:bg-surface-container-lowest/50">
                                        <td class="p-2 text-center font-mono text-muted-foreground text-xs">{i + 1}</td>
                                        <td class="p-2 text-xs truncate max-w-[120px]" title={points[i].at}>
                                            {new Date(points[i].at).toLocaleDateString(undefined, {
                                                month: "short",
                                                day: "numeric",
                                                year: "2-digit",
                                                hour: "2-digit",
                                                minute: "2-digit"
                                            })}
                                        </td>
                                        <td class="p-2">
                                            <Input 
                                                type="number" 
                                                class="h-8 py-1 px-2 font-mono text-xs w-24"
                                                bind:value={points[i].rating} 
                                            />
                                        </td>
                                        <td class="p-2">
                                            <Input 
                                                type="number" 
                                                class="h-8 py-1 px-2 font-mono text-xs w-24"
                                                bind:value={points[i].rd} 
                                            />
                                        </td>
                                        <td class="p-2 text-center">
                                            <Button 
                                                variant="ghost" 
                                                size="icon-xs" 
                                                onclick={() => removePoint(i)}
                                                class="text-destructive hover:bg-destructive/10"
                                                title="Remove Point"
                                            >
                                                <Icon name="delete" fontsize="1rem" />
                                            </Button>
                                        </td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                {:else}
                    <p class="text-sm text-muted-foreground text-center py-6">
                        No points to manage. Generate or add some points above!
                    </p>
                {/if}
            </div>

        </div>

    </div>
</div>
