<script lang="ts">
    import ReviewProblemNavigation from "../../practice/ReviewProblemNavigation.svelte";
    import { selectTimeEndpoint, summarizeTimeRange, type TimeRangeSelection } from "../../practice/test-time-range";
    import { Icon } from "#lib/components/icon/index.js";
    import { formatElapsed } from "#lib/utils.js";

    const problems = [
        { n: 1, seconds: 74, result: "correct" },
        { n: 2, seconds: 186, result: "incorrect" },
        { n: 3, seconds: 92, result: "correct" },
        { n: 4, seconds: 248, result: "skipped" },
        { n: 5, seconds: 131, result: "correct" },
        { n: 6, seconds: 63, result: "correct" },
        { n: 7, seconds: 207, result: "incorrect" },
        { n: 8, seconds: 116, result: "correct" },
        { n: 9, seconds: 155, result: "correct" },
        { n: 10, seconds: 83, result: "correct" },
        { n: 11, seconds: 221, result: "skipped" },
        { n: 12, seconds: 101, result: "correct" },
    ] as const;

    let selection = $state<TimeRangeSelection>(null);
    let focusedIndex = $state<number | null>(null);
    let range = $derived(summarizeTimeRange(problems.map(p => ({ elapsedMs: p.seconds * 1000 })), selection));
    let rangeTotalMs = $derived(range?.totalMs ?? 0);
    let selectedCount = $derived(range?.count ?? 0);
    const fullTestTimeMs = problems.reduce((sum, problem) => sum + problem.seconds * 1000, 0);
    const cells = problems.map(problem => ({ label: problem.n, state: problem.result }));
</script>

<svelte:head>
    <title>Test Time Range · ProblemCloud</title>
</svelte:head>

<svelte:window onkeydown={(event) => { if (event.key === "Escape") selection = null; }} />

<div class="space-y-6 pb-12">
    <div class="border-b border-border/80 pb-4">
        <h1 class="flex items-center gap-2 text-3xl font-semibold tracking-tight text-foreground">
            <Icon name="schedule" fontsize="2.25rem" class="text-primary-foreground" />
            Test Time Range
        </h1>
    </div>

    <section class="rounded-xl border border-border/80 bg-surface-container-lowest p-4 shadow-xs sm:p-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
                <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">AMC 10A · Test review</p>
                <h2 class="mt-1 text-lg font-semibold">Problem time</h2>
            </div>
            <div class="inline-flex items-center gap-1.5 rounded-md bg-surface-container-low px-2.5 py-1.5 font-mono text-sm tabular-nums">
                <Icon name="timer" fontsize={16} class="text-muted-foreground" />
                {#if range}
                    {formatElapsed(rangeTotalMs)}
                {:else}
                    {formatElapsed(fullTestTimeMs)}
                {/if}
            </div>
        </div>

        <div class="mt-5 rounded-lg border border-border/50 bg-surface-container-low/40 p-4">
            <div class="mb-3 flex items-center justify-between gap-3">
                <p class="text-sm font-medium">Problems</p>
                {#if focusedIndex !== null}<p class="text-xs text-muted-foreground">Problem {problems[focusedIndex].n}</p>{/if}
            </div>

            <ReviewProblemNavigation
                {cells}
                selection={selection}
                onSelect={(index) => focusedIndex = index}
                onEndpoint={(index) => selection = selectTimeEndpoint(selection, index)}
            />

            {#if range}
                <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/50 pt-3 text-sm">
                    <span class="font-semibold">Problems {problems[range.from].n}–{problems[range.to].n}</span>
                    <span class="text-muted-foreground">{selectedCount} consecutive problems</span>
                    <span class="font-mono font-semibold tabular-nums">{formatElapsed(rangeTotalMs)} total</span>
                    <button type="button" class="underline" onclick={() => selection = null}>Clear range</button>
                </div>
            {/if}
        </div>

    </section>

    <section class="rounded-xl border border-border/80 bg-surface-container-lowest p-4 shadow-xs sm:p-6">
        <h2 class="text-lg font-semibold">Per-problem time</h2>
        <div class="mt-4 space-y-2">
            {#each problems as problem, index (problem.n)}
                {@const inRange = range !== null && index >= range.from && index <= range.to}
                <div class={`grid grid-cols-[3rem_1fr_4.5rem] items-center gap-3 rounded-md px-2 py-1.5 ${inRange ? "bg-primary-foreground/12 ring-1 ring-inset ring-primary-foreground/60" : ""}`}>
                    <span class="text-xs text-muted-foreground">#{problem.n}</span>
                    <div class="h-2 overflow-hidden rounded-full bg-surface-container-high">
                        <div class={`h-full rounded-full ${problem.result === "correct" ? "bg-correct" : problem.result === "incorrect" ? "bg-destructive" : "bg-unsure"}`} style={`width: ${Math.max(8, problem.seconds / 2.5)}%`}></div>
                    </div>
                    <span class="text-right font-mono text-xs tabular-nums">{formatElapsed(problem.seconds * 1000)}</span>
                </div>
            {/each}
        </div>
        <div class="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-correct"></span>Correct</span>
            <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-destructive"></span>Incorrect</span>
            <span class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-unsure"></span>Skipped</span>
        </div>
    </section>
</div>

