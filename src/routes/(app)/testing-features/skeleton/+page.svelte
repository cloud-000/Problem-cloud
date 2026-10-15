<script lang="ts">
    import { Button } from "#lib/components/button/index.js";
    import { Icon } from "#lib/components/icon/index.js";
    import {
        Skeleton,
        ProblemSkeleton,
        ListRowSkeleton,
        DeferredLoading,
        type SkeletonEffect,
    } from "#lib/components/skeleton/index.js";
    import { StatusTag } from "#lib/components/status-tag/index.js";
    import { Switch } from "#lib/components/toggle/index.js";

    // Controls
    let isLoading = $state(true);
    let isSimulating = $state(false);
    let effectStyle = $state<SkeletonEffect>("shimmer");
    let simulateTimeout: ReturnType<typeof setTimeout> | null = null;

    function simulateFetch() {
        if (simulateTimeout) clearTimeout(simulateTimeout);
        isLoading = true;
        isSimulating = true;
        simulateTimeout = setTimeout(() => {
            isLoading = false;
            isSimulating = false;
        }, 1600);
    }

    // Anti-Flicker Interactive Lab State
    let labQueryActive = $state(false);
    let labQueryResult = $state<string | null>("Initial query result from cache");
    const deferredLab = new DeferredLoading(false, { delayMs: 120, minDurationMs: 200 });

    function runFastQuery() {
        labQueryActive = true;
        deferredLab.setLoading(true);
        labQueryResult = null;
        setTimeout(() => {
            labQueryActive = false;
            deferredLab.setLoading(false);
            labQueryResult = `Fast result fetched at ${new Date().toLocaleTimeString()} (50ms cache hit - skipped skeleton!)`;
        }, 50);
    }

    function runSlowQuery() {
        labQueryActive = true;
        deferredLab.setLoading(true);
        labQueryResult = null;
        setTimeout(() => {
            labQueryActive = false;
            deferredLab.setLoading(false);
            labQueryResult = `Full network result fetched at ${new Date().toLocaleTimeString()} (750ms server roundtrip)`;
        }, 750);
    }
</script>

<svelte:head>
    <title>Skeleton · ProblemCloud</title>
</svelte:head>

<div class="space-y-10 pb-16">
    <!-- Header -->
    <div class="border-b border-border/80 pb-4">
        <h1
            class="flex items-center gap-2 text-3xl font-semibold tracking-tight text-foreground"
        >
            <Icon
                name="pending"
                fontsize="2.25rem"
                class="text-primary-foreground"
            />
            Skeleton Primitives
        </h1>
        <p class="mt-1 text-sm text-muted-foreground">
            Calm, layout-preserving loading placeholder primitives with directional shimmer, anti-flicker deferred loading, and smooth fade-in transitions.
        </p>
    </div>

    <!-- Master State Control Bar -->
    <section
        class="sticky top-4 z-20 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/80 bg-surface-container-lowest/95 p-4 shadow-sm backdrop-blur-md"
        aria-label="Interactive Controls"
    >
        <div class="flex flex-wrap items-center gap-6">
            <div class="flex items-center gap-2.5">
                <span
                    class="text-xs font-semibold {isLoading
                        ? 'text-primary-foreground font-bold'
                        : 'text-muted-foreground'}"
                >
                    Skeleton View
                </span>
                <Switch
                    checked={!isLoading}
                    onchange={() => (isLoading = !isLoading)}
                    aria-label="Toggle loaded content state"
                />
                <span
                    class="text-xs font-semibold {!isLoading
                        ? 'text-primary-foreground font-bold'
                        : 'text-muted-foreground'}"
                >
                    Loaded View
                </span>
            </div>

            <div class="flex items-center gap-2 border-l border-border/60 pl-4">
                <span class="text-xs font-medium text-muted-foreground">Effect:</span>
                <button
                    type="button"
                    class="rounded-md px-2 py-1 text-xs font-medium transition-colors {effectStyle === 'shimmer' ? 'bg-primary text-primary-foreground font-semibold' : 'bg-surface-container text-muted-foreground hover:text-foreground'}"
                    onclick={() => (effectStyle = "shimmer")}
                >
                    Shimmer (Sweep)
                </button>
                <button
                    type="button"
                    class="rounded-md px-2 py-1 text-xs font-medium transition-colors {effectStyle === 'pulse' ? 'bg-primary text-primary-foreground font-semibold' : 'bg-surface-container text-muted-foreground hover:text-foreground'}"
                    onclick={() => (effectStyle = "pulse")}
                >
                    Pulse (Breathe)
                </button>
            </div>
        </div>

        <div class="flex items-center gap-2">
            <Button
                variant="outline"
                size="sm"
                onclick={simulateFetch}
                disabled={isSimulating}
            >
                <Icon name="replay" class={isSimulating ? "animate-spin" : ""} />
                {isSimulating ? "Simulating Fetch..." : "Simulate 1.6s Fetch"}
            </Button>
            <Button
                variant={isLoading ? "primary" : "secondary"}
                size="sm"
                onclick={() => (isLoading = !isLoading)}
            >
                <Icon name={isLoading ? "visibility" : "pending"} />
                {isLoading ? "Show Loaded View" : "Show Skeletons"}
            </Button>
        </div>
    </section>

    <!-- SECTION 1: Anti-Flicker & Transition Showcase -->
    <section class="space-y-4">
        <div>
            <h2 class="text-xl font-semibold text-foreground flex items-center gap-2">
                <Icon name="bolt" class="text-primary-foreground" />
                Anti-Flicker Deferred Loading Lab
            </h2>
            <p class="text-sm text-muted-foreground mt-0.5">
                Fast queries (&lt;120ms) bypass skeletons completely to eliminate sub-second visual flashes (FOIC). Slower queries display a calm shimmer and dissolve smoothly via <code class="font-mono text-xs bg-surface-container px-1 py-0.5 rounded">animate-fade-in</code>.
            </p>
        </div>

        <div class="rounded-xl border border-border/80 bg-surface-container-lowest p-5 shadow-xs space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
                <div class="flex items-center gap-2">
                    <Button size="sm" variant="outline" onclick={runFastQuery} disabled={labQueryActive}>
                        <Icon name="bolt" /> Fast Cache Hit (50ms)
                    </Button>
                    <Button size="sm" variant="outline" onclick={runSlowQuery} disabled={labQueryActive}>
                        <Icon name="download" /> Network Fetch (750ms)
                    </Button>
                </div>
                <div class="flex items-center gap-3 text-xs font-mono text-muted-foreground">
                    <span>Active Query: {labQueryActive ? "FETCHING" : "IDLE"}</span>
                    <span>Skeleton Rendered: <strong class={deferredLab.showSkeleton ? "text-primary-foreground" : "text-muted-foreground"}>{deferredLab.showSkeleton ? "YES" : "NO"}</strong></span>
                </div>
            </div>

            <!-- Content Area -->
            <div class="min-h-24 flex items-center">
                {#if deferredLab.showSkeleton}
                    <div class="w-full space-y-2.5 py-2">
                        <Skeleton class="h-5 w-48 rounded-sm" effect={effectStyle} />
                        <Skeleton class="h-4 w-full rounded-sm" effect={effectStyle} />
                        <Skeleton class="h-4 w-2/3 rounded-sm" effect={effectStyle} />
                    </div>
                {:else if labQueryResult}
                    <div class="w-full rounded-lg border border-border/70 bg-surface-container-low/40 p-4 animate-fade-in">
                        <div class="flex items-center gap-2">
                            <Icon name="check_circle" class="text-correct size-4 shrink-0" fill />
                            <span class="text-sm font-semibold text-foreground">Content Loaded Smoothly</span>
                        </div>
                        <p class="mt-1 text-xs text-muted-foreground font-mono">
                            {labQueryResult}
                        </p>
                    </div>
                {:else}
                    <div class="w-full text-xs text-muted-foreground font-mono italic">
                        Evaluating request (under 120ms debounce threshold)...
                    </div>
                {/if}
            </div>
        </div>
    </section>

    <!-- SECTION 2: Zero Cumulative Layout Shift (CLS) Playground -->
    <section class="space-y-4">
        <div>
            <h2 class="text-xl font-semibold text-foreground flex items-center gap-2">
                <Icon name="layers" class="text-primary-foreground" />
                Zero-CLS Composite Cards & Soft Fade-In
            </h2>
            <p class="text-sm text-muted-foreground mt-0.5">
                Toggle the switch above to compare placeholder geometry with real content. Skeletons occupy exact dimensions to prevent Cumulative Layout Shift, fading in seamlessly upon arrival.
            </p>
        </div>

        <div class="space-y-6">
            <!-- Simulated Problem Card -->
            <div class="space-y-2">
                <div class="flex items-center justify-between text-xs font-medium text-muted-foreground px-1">
                    <span>Problem Card (Card Appearance)</span>
                    <span class="font-mono">{isLoading ? "State: SKELETON" : "State: LOADED"}</span>
                </div>

                {#if isLoading}
                    <ProblemSkeleton appearance="card" />
                {:else}
                    <div
                        class="rounded-lg border border-border bg-surface-container-lowest p-6 shadow-xs flex flex-col gap-4 animate-fade-in"
                    >
                        <!-- Header -->
                        <div class="flex items-start justify-between gap-4">
                            <div class="flex min-w-0 flex-1 flex-col gap-2">
                                <!-- Line 1: Number + Test name -->
                                <div class="flex items-center gap-2">
                                    <span
                                        class="inline-flex shrink-0 items-center justify-center rounded-md border border-border/70 bg-surface-container-lowest px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-foreground shadow-xs"
                                    >
                                        #18
                                    </span>
                                    <span class="text-sm font-semibold text-foreground truncate">
                                        2023 AMC 10A
                                    </span>
                                    <Icon name="verified" class="size-4 text-correct shrink-0" fill />
                                </div>
                                <!-- Line 2: Topic + Rating + Status -->
                                <div class="flex items-center gap-2">
                                    <span class="inline-flex items-center rounded-full border border-border/60 bg-surface-container px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                                        Geometry
                                    </span>
                                    <span class="inline-flex items-center rounded-full border border-border/60 bg-surface-container px-2 py-0.5 text-xs font-semibold text-muted-foreground font-mono">
                                        124
                                    </span>
                                    <StatusTag status="solved" size="sm" />
                                </div>
                            </div>

                            <!-- Actions -->
                            <div class="flex shrink-0 items-center gap-1.5">
                                <Button variant="ghost" size="icon" class="size-7">
                                    <Icon name="bookmark" />
                                </Button>
                                <Button variant="ghost" size="icon" class="size-7">
                                    <Icon name="share" />
                                </Button>
                            </div>
                        </div>

                        <!-- Statement -->
                        <p class="text-sm text-foreground leading-relaxed">
                            A regular hexagon has area $120$. What is the area of the rectangle whose vertices are four of the vertices of the hexagon?
                        </p>

                        <!-- Choices -->
                        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 pt-2">
                            {#each ["40", "60", "80", "40√3", "60√3"] as choice, i (i)}
                                <button
                                    type="button"
                                    class="flex items-center gap-2.5 rounded-lg border border-border/70 bg-surface-container-lowest p-2.5 text-left text-xs font-medium text-foreground hover:bg-surface-container/50 transition-colors"
                                >
                                    <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-container text-[11px] font-semibold text-muted-foreground font-mono">
                                        {String.fromCharCode(65 + i)}
                                    </span>
                                    <span>{choice}</span>
                                </button>
                            {/each}
                        </div>
                    </div>
                {/if}
            </div>

            <!-- Simulated Problem Row in continuous list -->
            <div class="space-y-2">
                <div class="flex items-center justify-between text-xs font-medium text-muted-foreground px-1">
                    <span>Problem Row (Continuous List Appearance)</span>
                    <span class="font-mono">{isLoading ? "State: SKELETON" : "State: LOADED"}</span>
                </div>

                <div class="rounded-xl border border-border/80 bg-surface-container-lowest px-5 shadow-xs divide-y divide-border/60">
                    {#if isLoading}
                        <ProblemSkeleton appearance="row" showChoices={false} />
                        <ProblemSkeleton appearance="row" showChoices={false} />
                    {:else}
                        <div class="py-4 flex flex-col gap-2 animate-fade-in">
                            <div class="flex items-center justify-between">
                                <div class="flex items-center gap-2">
                                    <span class="type-caption tabular-nums text-muted-foreground font-mono">#1</span>
                                    <span class="text-sm font-semibold text-foreground">2022 AMC 12B</span>
                                    <StatusTag status="correct" size="sm" />
                                </div>
                                <span class="text-xs font-mono text-muted-foreground">1m 12s</span>
                            </div>
                            <p class="text-xs text-muted-foreground line-clamp-1">
                                What is the value of $(2022+2020)/(2022-2020)$?
                            </p>
                        </div>
                        <div class="py-4 flex flex-col gap-2 animate-fade-in">
                            <div class="flex items-center justify-between">
                                <div class="flex items-center gap-2">
                                    <span class="type-caption tabular-nums text-muted-foreground font-mono">#2</span>
                                    <span class="text-sm font-semibold text-foreground">2022 AMC 12B</span>
                                    <StatusTag status="incorrect" size="sm" />
                                </div>
                                <span class="text-xs font-mono text-muted-foreground">2m 45s</span>
                            </div>
                            <p class="text-xs text-muted-foreground line-clamp-1">
                                For how many positive integers $n$ is $n^2 - 3n + 2$ a prime number?
                            </p>
                        </div>
                    {/if}
                </div>
            </div>

            <!-- Simulated Goal Card -->
            <div class="space-y-2">
                <div class="flex items-center justify-between text-xs font-medium text-muted-foreground px-1">
                    <span>Goal / Metric Card (Zero-CLS)</span>
                    <span class="font-mono">{isLoading ? "State: SKELETON" : "State: LOADED"}</span>
                </div>

                <div class="rounded-xl border border-border/80 bg-surface-container-lowest p-5 shadow-xs">
                    {#if isLoading}
                        <div class="flex flex-col gap-3">
                            <div class="flex items-start justify-between gap-3">
                                <div class="min-w-0 flex-1 space-y-1.5">
                                    <Skeleton class="h-5 w-48 rounded-sm" effect={effectStyle} />
                                    <Skeleton class="h-4 w-32 rounded-sm" effect={effectStyle} />
                                </div>
                                <Skeleton class="h-8 w-20 rounded-md shrink-0" effect={effectStyle} />
                            </div>
                            <div class="space-y-1.5">
                                <div class="flex justify-between items-center">
                                    <Skeleton class="h-3 w-28 rounded-sm" effect={effectStyle} />
                                    <Skeleton class="h-3 w-10 rounded-sm" effect={effectStyle} />
                                </div>
                                <Skeleton class="h-2 w-full rounded-full" effect={effectStyle} />
                            </div>
                        </div>
                    {:else}
                        <div class="flex flex-col gap-3 animate-fade-in">
                            <div class="flex items-start justify-between gap-3">
                                <div class="min-w-0 flex-1">
                                    <span class="type-section-title block truncate text-foreground">Solve 50 AMC 10 Geometry</span>
                                    <span class="mt-0.5 block truncate type-secondary text-muted-foreground">AMC 10 · Geometry</span>
                                </div>
                                <Button size="sm" variant="outline">Practice</Button>
                            </div>
                            <div class="space-y-1.5">
                                <div class="flex justify-between items-center text-xs text-muted-foreground font-mono">
                                    <span>32 / 50 solved</span>
                                    <span>64%</span>
                                </div>
                                <div class="h-2 w-full rounded-full bg-surface-container overflow-hidden">
                                    <div class="h-full bg-primary rounded-full" style="width: 64%"></div>
                                </div>
                            </div>
                        </div>
                    {/if}
                </div>
            </div>

            <!-- Simulated Library / Test List Rows -->
            <div class="space-y-2">
                <div class="flex items-center justify-between text-xs font-medium text-muted-foreground px-1">
                    <span>Library Series / Test Rows (ListRowSkeleton)</span>
                    <span class="font-mono">{isLoading ? "State: SKELETON" : "State: LOADED"}</span>
                </div>

                <div class="rounded-xl border border-border/80 bg-surface-container-lowest px-5 shadow-xs divide-y divide-border/60">
                    {#if isLoading}
                        <ListRowSkeleton />
                        <ListRowSkeleton />
                    {:else}
                        <div class="py-4 flex flex-col gap-3 sm:flex-row sm:items-center animate-fade-in">
                            <div class="flex min-w-0 flex-1 flex-col gap-1">
                                <span class="text-sm font-semibold text-foreground">American Mathematics Competitions 10</span>
                                <div class="flex flex-wrap items-center gap-1.5">
                                    <span class="inline-flex items-center rounded-full bg-surface-container px-2 py-0.5 text-xs text-muted-foreground">Official</span>
                                    <span class="inline-flex items-center rounded-full bg-surface-container px-2 py-0.5 text-xs text-muted-foreground">Series 1</span>
                                </div>
                            </div>
                            <Button size="sm" variant="outline" class="shrink-0 gap-1">
                                <Icon name="play_arrow" /> Mock test
                            </Button>
                        </div>
                        <div class="py-4 flex flex-col gap-3 sm:flex-row sm:items-center animate-fade-in">
                            <div class="flex min-w-0 flex-1 flex-col gap-1">
                                <span class="text-sm font-semibold text-foreground">American Invitational Mathematics Examination</span>
                                <div class="flex flex-wrap items-center gap-1.5">
                                    <span class="inline-flex items-center rounded-full bg-surface-container px-2 py-0.5 text-xs text-muted-foreground">Official</span>
                                    <span class="inline-flex items-center rounded-full bg-surface-container px-2 py-0.5 text-xs text-muted-foreground">Series 2</span>
                                </div>
                            </div>
                            <Button size="sm" variant="outline" class="shrink-0 gap-1">
                                <Icon name="play_arrow" /> Mock test
                            </Button>
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    </section>

    <!-- SECTION 3: Primitive Shapes & Sizing Library -->
    <section class="space-y-4">
        <div>
            <h2 class="text-xl font-semibold text-foreground flex items-center gap-2">
                <Icon name="shapes" class="text-primary-foreground" />
                Primitive Shapes & Radius Variants
            </h2>
            <p class="text-sm text-muted-foreground mt-0.5">
                Standard placeholder tokens ready to compose custom cards, lists, inputs, and avatars.
            </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- Text Lines -->
            <div class="rounded-xl border border-border/80 bg-surface-container-lowest p-5 space-y-4 shadow-xs">
                <h3 class="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <Icon name="title" class="size-4 text-muted-foreground" />
                    Text Lines (Various Heights & Widths)
                </h3>
                <div class="space-y-3 p-4 rounded-lg bg-surface-container-low/60 border border-border/40">
                    <div class="space-y-1">
                        <span class="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Display / Heading (h-6, h-7)</span>
                        <Skeleton class="h-7 w-2/3" effect={effectStyle} />
                    </div>
                    <div class="space-y-1">
                        <span class="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Paragraph Body (h-4, varying widths)</span>
                        <div class="space-y-2">
                            <Skeleton class="h-4 w-full" effect={effectStyle} />
                            <Skeleton class="h-4 w-11/12" effect={effectStyle} />
                            <Skeleton class="h-4 w-4/5" effect={effectStyle} />
                            <Skeleton class="h-4 w-2/3" effect={effectStyle} />
                        </div>
                    </div>
                    <div class="space-y-1">
                        <span class="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Caption / Metadata (h-3, w-1/3)</span>
                        <Skeleton class="h-3 w-1/3 rounded-sm" effect={effectStyle} />
                    </div>
                </div>
            </div>

            <!-- Avatars & Circles -->
            <div class="rounded-xl border border-border/80 bg-surface-container-lowest p-5 space-y-4 shadow-xs">
                <h3 class="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <Icon name="person" class="size-4 text-muted-foreground" />
                    Circle & Avatar Primitives (`rounded="full"`)
                </h3>
                <div class="p-4 rounded-lg bg-surface-container-low/60 border border-border/40 flex flex-wrap items-center gap-6">
                    <div class="flex flex-col items-center gap-1.5">
                        <Skeleton class="size-8" rounded="full" effect={effectStyle} />
                        <span class="text-[10px] font-mono text-muted-foreground">size-8</span>
                    </div>
                    <div class="flex flex-col items-center gap-1.5">
                        <Skeleton class="size-10" rounded="full" effect={effectStyle} />
                        <span class="text-[10px] font-mono text-muted-foreground">size-10</span>
                    </div>
                    <div class="flex flex-col items-center gap-1.5">
                        <Skeleton class="size-12" rounded="full" effect={effectStyle} />
                        <span class="text-[10px] font-mono text-muted-foreground">size-12</span>
                    </div>
                    <div class="flex flex-col items-center gap-1.5">
                        <Skeleton class="size-16" rounded="full" effect={effectStyle} />
                        <span class="text-[10px] font-mono text-muted-foreground">size-16</span>
                    </div>
                    <div class="flex flex-col items-center gap-1.5">
                        <Skeleton class="size-20" rounded="full" effect={effectStyle} />
                        <span class="text-[10px] font-mono text-muted-foreground">size-20</span>
                    </div>
                </div>

                <!-- Combined Avatar + Meta Mockup -->
                <div class="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-surface-container-lowest">
                    <Skeleton class="size-10 shrink-0" rounded="full" effect={effectStyle} />
                    <div class="space-y-1.5 flex-1 min-w-0">
                        <Skeleton class="h-4 w-32 rounded-sm" effect={effectStyle} />
                        <Skeleton class="h-3 w-48 rounded-sm" effect={effectStyle} />
                    </div>
                    <Skeleton class="h-7 w-16 rounded-md shrink-0" effect={effectStyle} />
                </div>
            </div>

            <!-- Buttons & Badges -->
            <div class="rounded-xl border border-border/80 bg-surface-container-lowest p-5 space-y-4 shadow-xs">
                <h3 class="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <Icon name="pill" class="size-4 text-muted-foreground" />
                    Buttons & Status Pill Placeholders
                </h3>
                <div class="p-4 rounded-lg bg-surface-container-low/60 border border-border/40 flex flex-wrap items-center gap-3">
                    <Skeleton class="h-9 w-28 rounded-md" effect={effectStyle} />
                    <Skeleton class="h-8 w-24 rounded-full" effect={effectStyle} />
                    <Skeleton class="h-7 w-20 rounded-md" effect={effectStyle} />
                    <Skeleton class="size-9 rounded-md" effect={effectStyle} />
                    <Skeleton class="size-8 rounded-full" effect={effectStyle} />
                    <Skeleton class="h-6 w-16 rounded-full" effect={effectStyle} />
                </div>
            </div>

            <!-- Radius Variants -->
            <div class="rounded-xl border border-border/80 bg-surface-container-lowest p-5 space-y-4 shadow-xs">
                <h3 class="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <Icon name="rectangle" class="size-4 text-muted-foreground" />
                    Corner Radius Variants (`rounded` prop)
                </h3>
                <div class="grid grid-cols-3 sm:grid-cols-6 gap-3 p-4 rounded-lg bg-surface-container-low/60 border border-border/40 text-center">
                    <div class="flex flex-col items-center gap-1.5">
                        <Skeleton class="size-12" rounded="none" effect={effectStyle} />
                        <span class="text-[10px] font-mono text-muted-foreground">none</span>
                    </div>
                    <div class="flex flex-col items-center gap-1.5">
                        <Skeleton class="size-12" rounded="sm" effect={effectStyle} />
                        <span class="text-[10px] font-mono text-muted-foreground">sm</span>
                    </div>
                    <div class="flex flex-col items-center gap-1.5">
                        <Skeleton class="size-12" rounded="md" effect={effectStyle} />
                        <span class="text-[10px] font-mono text-muted-foreground">md (def)</span>
                    </div>
                    <div class="flex flex-col items-center gap-1.5">
                        <Skeleton class="size-12" rounded="lg" effect={effectStyle} />
                        <span class="text-[10px] font-mono text-muted-foreground">lg</span>
                    </div>
                    <div class="flex flex-col items-center gap-1.5">
                        <Skeleton class="size-12" rounded="full" effect={effectStyle} />
                        <span class="text-[10px] font-mono text-muted-foreground">full</span>
                    </div>
                    <div class="flex flex-col items-center gap-1.5">
                        <Skeleton class="size-12 rounded-2xl" effect={effectStyle} />
                        <span class="text-[10px] font-mono text-muted-foreground">class 2xl</span>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <!-- SECTION 4: Accessibility & Motion Tokens -->
    <section
        class="rounded-xl border border-border/80 bg-surface-container-lowest p-6 shadow-xs space-y-3"
    >
        <h2 class="text-base font-semibold text-foreground flex items-center gap-2">
            <Icon name="rule" class="text-primary-foreground" />
            Accessibility & Motion Tokens
        </h2>
        <ul class="text-sm text-muted-foreground space-y-2 list-disc list-inside">
            <li>
                <strong class="text-foreground">Anti-Flicker Thresholds:</strong> Uses <code class="font-mono text-xs bg-surface-container px-1 py-0.5 rounded">createDeferredLoading()</code> to ignore queries completing faster than 120ms, protecting user focus from FOIC flashes.
            </li>
            <li>
                <strong class="text-foreground">Smooth Entrance:</strong> Uses CSS <code class="font-mono text-xs bg-surface-container px-1 py-0.5 rounded">animate-fade-in</code> (180ms ease-out) so content eases into place rather than abruptly snapping in.
            </li>
            <li>
                <strong class="text-foreground">Screen Reader Calmness:</strong> Carries <code class="font-mono text-xs bg-surface-container px-1 py-0.5 rounded">aria-hidden="true"</code> by default so assistive technology does not announce noisy empty content.
            </li>
            <li>
                <strong class="text-foreground">Reduced Motion:</strong> Uses <code class="font-mono text-xs bg-surface-container px-1 py-0.5 rounded">motion-reduce:animate-none</code> so users who request reduced motion receive static, non-animated placeholders.
            </li>
            <li>
                <strong class="text-foreground">Kindle / E-Ink:</strong> Keyframe animations and transitions are automatically disabled under <code class="font-mono text-xs bg-surface-container px-1 py-0.5 rounded">html[data-theme="kindle"]</code> to prevent ghosting on e-ink displays.
            </li>
        </ul>
    </section>
</div>
