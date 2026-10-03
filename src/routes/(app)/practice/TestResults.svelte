<script lang="ts">
    import { onMount } from "svelte";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Modal } from "$lib/components/modal";
    import { ProblemReview } from "$lib/components/problem";
    import { ProblemGrid, type ProblemGridCell } from "$lib/components/problem-grid";
    import { SegmentBar } from "$lib/components/segment-bar";
    import { Graph } from "$lib/components/graph";
    import { formatElapsed, isMultipleChoice } from "$lib/utils";
    import type { PracticeHistoryEntry } from "./practice-state";
    import type { TestResultSummary } from "./test-state";
    import { submissionOutcome } from "$lib/problem-response";

    let {
        history,
        summary,
        elapsedMs,
    }: {
        history: PracticeHistoryEntry[];
        summary: TestResultSummary;
        elapsedMs: number;
    } = $props();

    let activeProblemIndex = $state<number | null>(null);
    let userExpandedPreference = $state<boolean | null>(null);
    let isSmallScreen = $state(false);

    onMount(() => {
        const mq = window.matchMedia("(max-width: 639px)");
        isSmallScreen = mq.matches;
        const handler = (e: MediaQueryListEvent) => {
            isSmallScreen = e.matches;
        };
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    });

    let isExpanded = $derived(
        userExpandedPreference !== null
            ? userExpandedPreference
            : !isSmallScreen,
    );

    let cells = $derived<ProblemGridCell[]>(
        history.map((entry, index) => {
            const mcq = isMultipleChoice(entry.problem.choices);
            const skipped =
                entry.skipped ??
                (mcq ? entry.selectedChoice == null : !entry.answer.trim());
            const state: ProblemGridCell["state"] = submissionOutcome({
                skipped,
                is_correct: entry.correct,
            });
            return {
                label: entry.problem.n + 1,
                state,
                flagged: entry.flagged,
                current: activeProblemIndex === index,
            };
        }),
    );

    let focusedIndex = $state(0);
    let reviewOpen = $state(false);
    let focusedEntry = $derived(history[focusedIndex]);
    // The focused problem's test and time spent. This is the modal's one
    // identity line, which is why the review inside it renders no header.
    let focusedDescription = $derived.by(() => {
        if (!focusedEntry) return "Test review";
        const parts: string[] = [];
        if (focusedEntry.problem.tests?.name) {
            parts.push(focusedEntry.problem.tests.name);
        }
        if (focusedEntry.elapsedMs != null) {
            parts.push(formatElapsed(focusedEntry.elapsedMs));
        }
        return parts.length ? parts.join(" · ") : "Test review";
    });

    // Graph states
    let graphHoverIndex = $state<number | null>(null);

    let processedHistory = $derived(
        history.map((entry) => {
            const mcq = isMultipleChoice(entry.problem.choices);
            const skipped =
                entry.skipped ??
                (mcq ? entry.selectedChoice == null : !entry.answer.trim());
            const state = submissionOutcome({
                skipped,
                is_correct: entry.correct,
            });
            const seconds = entry.elapsedMs / 1000;
            return {
                entry,
                skipped,
                correct: entry.correct,
                state,
                seconds,
            };
        }),
    );

    let yMax = $derived(
        Math.max(...processedHistory.map((h) => h.seconds), 30),
    );

    let activeEntry = $derived(
        graphHoverIndex !== null ? processedHistory[graphHoverIndex] : null,
    );

    let labelInterval = $derived.by(() => {
        const n = history.length;
        if (n <= 15) return 1;
        if (n <= 30) return 2;
        return 5;
    });

    function scrollToProblem(index: number) {
        activeProblemIndex = index;
        const target = document.getElementById(`test-review-${index}`);
        const scrollContainer = target?.closest<HTMLElement>(
            "[data-test-results-scroll]",
        );
        const summaryPanel = scrollContainer?.querySelector<HTMLElement>(
            "[data-test-results-summary]",
        );
        if (!target || !scrollContainer || !summaryPanel) return;
        const targetTop = target.getBoundingClientRect().top;
        const containerTop = scrollContainer.getBoundingClientRect().top;
        scrollContainer.scrollTo({
            top:
                scrollContainer.scrollTop +
                targetTop -
                containerTop -
                summaryPanel.offsetHeight -
                16,
            behavior: "smooth",
        });
    }

    let scrollRafId: number | null = null;
    function handleScroll(e: Event) {
        if (scrollRafId !== null) return;
        scrollRafId = requestAnimationFrame(() => {
            scrollRafId = null;
            const container = e.currentTarget as HTMLElement;
            if (!container) return;
            const summaryPanel = container.querySelector<HTMLElement>(
                "[data-test-results-summary]",
            );
            const threshold = (summaryPanel ? summaryPanel.offsetHeight : 0) + 32;
            const containerTop = container.getBoundingClientRect().top;

            for (let i = 0; i < history.length; i++) {
                const el = document.getElementById(`test-review-${i}`);
                if (!el) continue;
                const rect = el.getBoundingClientRect();
                const bottomRelativeToContainer = rect.bottom - containerTop;
                if (bottomRelativeToContainer > threshold) {
                    activeProblemIndex = i;
                    break;
                }
            }
        });
    }

    function openProblem(index: number) {
        focusedIndex = index;
        reviewOpen = true;
    }

    function showProblem(index: number) {
        if (index < 0 || index >= history.length) return;
        focusedIndex = index;
    }
</script>

{#snippet statChip(value: number, color: string, label: string)}
    <span
        class="inline-flex h-6 sm:h-7 min-w-6 sm:min-w-7 items-center justify-center rounded-md bg-surface-container-low px-1.5 sm:px-2 font-mono text-xs tabular-nums font-semibold"
        style:color
        title={`${value} ${label}`}
    >
        {value}
    </span>
{/snippet}

<div
    data-test-results-scroll
    onscroll={handleScroll}
    class="flex-1 overflow-y-auto px-3 sm:px-6 pb-10"
>
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-4 sm:gap-6 pt-2 sm:pt-4">
        <div
            data-test-results-summary
            class="sticky top-0 z-20 flex flex-col gap-2.5 sm:gap-3 rounded-xl border border-border/60 bg-surface-container-lowest/95 backdrop-blur-md p-3.5 sm:p-5 shadow-sm transition-all"
        >
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                    <Icon name="task_alt" class="text-primary shrink-0" fontsize={20} />
                    <h2 class="text-base sm:text-lg font-semibold truncate">Test complete</h2>
                </div>
                <div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
                    <div
                        class="flex items-center gap-1 rounded-md bg-surface-container-low px-2 py-0.5 text-xs font-mono text-muted-foreground"
                        title={`Total time: ${formatElapsed(elapsedMs)}`}
                    >
                        <Icon name="timer" fontsize={14} class="text-muted-foreground" />
                        <span>{formatElapsed(elapsedMs)}</span>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        onclick={() => (userExpandedPreference = !isExpanded)}
                        aria-label={isExpanded ? "Collapse to compact strip" : "Expand to full grid"}
                        title={isExpanded ? "Collapse to compact strip" : "Expand to full grid"}
                        class="h-7 w-7 text-muted-foreground hover:text-foreground"
                    >
                        <Icon name={isExpanded ? "expand_less" : "expand_more"} fontsize={18} />
                    </Button>
                </div>
            </div>

            <div class="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs font-mono text-muted-foreground">
                {@render statChip(summary.correct, "var(--color-correct)", "correct")}
                {@render statChip(summary.incorrect, "var(--color-destructive)", "incorrect")}
                {@render statChip(summary.ungraded, "var(--color-muted-foreground)", "ungraded")}
                {@render statChip(summary.skipped, "var(--color-unsure)", "skipped")}
                <span class="inline sm:hidden ml-1 text-muted-foreground/90 font-medium">
                    {summary.correct}/{history.length} score
                </span>
            </div>

            <SegmentBar
                class="h-1.5 sm:h-2 min-w-0"
                segments={[
                    { value: summary.correct, color: "var(--color-correct)", label: "Correct" },
                    { value: summary.incorrect, color: "var(--color-destructive)", label: "Incorrect" },
                    { value: summary.ungraded, color: "var(--color-muted-foreground)", label: "Ungraded" },
                    { value: summary.skipped, color: "var(--color-unsure)", label: "Skipped" },
                ]}
            />

            <ProblemGrid
                class="mt-0.5"
                variant={isExpanded ? "grid" : "strip"}
                {cells}
                onSelect={scrollToProblem}
            />
        </div>
        
        <!-- Time per Problem Graph Card -->
        {#if history.length > 0}
            <div class="rounded-xl border border-border/60 bg-surface-container-lowest p-3.5 sm:p-5 shadow-sm flex flex-col gap-2.5 sm:gap-3">
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-3">
                    <div class="flex items-center gap-2">
                        <Icon name="bar_chart" class="text-primary-foreground" fontsize={20} />
                        <h3 class="font-semibold text-foreground text-sm">Time per Problem</h3>
                    </div>
                    <div class="text-xs font-mono text-muted-foreground min-h-5 flex items-center">
                        {#if activeEntry}
                            <span class="font-semibold text-foreground mr-1.5">Problem {activeEntry.entry.problem.n + 1}</span>
                            <span class="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold mr-1.5 uppercase tracking-wide" 
                                  class:bg-correct-container={activeEntry.state === 'correct'}
                                  class:text-on-correct-container={activeEntry.state === 'correct'}
                                  class:bg-error-container={activeEntry.state === 'incorrect'}
                                  class:text-on-error-container={activeEntry.state === 'incorrect'}
                                  class:bg-unsure-container={activeEntry.state === 'skipped'}
                                  class:text-on-unsure-container={activeEntry.state === 'skipped'}
                                  class:bg-surface-container={activeEntry.state === 'ungraded'}
                                  class:text-muted-foreground={activeEntry.state === 'ungraded'}>
                                {activeEntry.state}
                            </span>
                            <span class="font-semibold text-foreground flex items-center gap-0.5">
                                <Icon name="timer" fontsize={14} class="text-muted-foreground" />
                                {formatElapsed(activeEntry.entry.elapsedMs)}
                            </span>
                        {:else}
                            <span class="text-muted-foreground/85 italic flex items-center gap-1">
                                <Icon name="info" fontsize={14} />
                                Hover to inspect · Click to scroll
                            </span>
                        {/if}
                    </div>
                </div>

                <div class="bg-surface-container-low/40 border border-border/40 rounded-lg p-3 sm:p-4">
                    <Graph
                        xCount={processedHistory.length}
                        yMin={0}
                        yMax={yMax}
                        height={160}
                        padding={{ t: 10, r: 16, b: 20, l: 44 }}
                        bind:hover={graphHoverIndex}
                        formatY={(v) => formatElapsed(v * 1000)}
                        class="cursor-pointer"
                        onclick={() => {
                            if (graphHoverIndex !== null) scrollToProblem(graphHoverIndex);
                        }}
                    >
                        {#snippet children(geo)}
                            {#each processedHistory as item, i (item.entry.problem.id)}
                                {@const colWidth = geo.n === 1 ? geo.plotW : geo.plotW / (geo.n - 1)}
                                {@const barWidth = Math.min(28, Math.max(6, colWidth * 0.55))}
                                {@const cx = geo.x(i)}
                                {@const x = cx - barWidth / 2}
                                {@const y = geo.y(item.seconds)}
                                {@const h = geo.y(0) - y}
                                {@const color = item.state === "correct"
                                    ? "var(--color-correct)"
                                    : item.state === "incorrect"
                                      ? "var(--color-destructive)"
                                      : item.state === "ungraded"
                                        ? "var(--color-muted-foreground)"
                                        : "var(--color-unsure)"}
                                
                                <!-- Highlight column background on hover -->
                                {#if graphHoverIndex === i}
                                    <rect
                                        x={cx - colWidth / 2}
                                        y={geo.y(yMax)}
                                        width={colWidth}
                                        height={geo.y(0) - geo.y(yMax)}
                                        fill="var(--color-primary-foreground)"
                                        opacity="0.05"
                                        class="pointer-events-none"
                                    />
                                {/if}
                                
                                <!-- Draw bar -->
                                <rect
                                    {x}
                                    {y}
                                    width={barWidth}
                                    height={Math.max(h, 2)}
                                    rx="3"
                                    fill={color}
                                    class="transition-opacity duration-150 cursor-pointer"
                                    opacity={graphHoverIndex === null || graphHoverIndex === i ? 1.0 : 0.45}
                                />
                                
                                <!-- X Axis label -->
                                {#if i % labelInterval === 0}
                                    <text
                                        x={cx}
                                        y={geo.height - 4}
                                        text-anchor="middle"
                                        fill="var(--color-muted-foreground)"
                                        class="font-mono text-[9px] sm:text-[10px]"
                                    >
                                        {item.entry.problem.n + 1}
                                    </text>
                                {/if}
                            {/each}
                        {/snippet}
                    </Graph>
                </div>
            </div>
        {/if}

        <div class="flex flex-col gap-3">
            {#each history as entry, index (entry.problem.id)}
                <div id={`test-review-${index}`} class="scroll-mt-4">
                    <ProblemReview
                        {entry}
                        elapsedMs={entry.elapsedMs}
                        showOrganization
                    >
                        {#snippet actions()}
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                onclick={() => openProblem(index)}
                                aria-label={`Open problem ${entry.problem.n + 1} in focused view`}
                                title="Open in focused view"
                                class="text-muted-foreground hover:text-foreground"
                            >
                                <Icon name="open_in_full" />
                            </Button>
                        {/snippet}
                    </ProblemReview>
                </div>
            {/each}
        </div>
        <div class="flex justify-center pt-2">
            <Button variant="outline" href="/practice">Back to sessions</Button>
        </div>
    </div>
</div>

<Modal
    bind:open={reviewOpen}
    size="xl"
    title={focusedEntry ? `Problem ${focusedEntry.problem.n + 1}` : "Problem review"}
    description={focusedDescription}
    onClose={() => (reviewOpen = false)}
>
    {#if focusedEntry}
        <!-- The modal's own title and description already name the problem, its
             test, and the time spent, so the review header would be the second
             telling. `elapsedMs` rides in the description for the same reason. -->
        <ProblemReview
            entry={focusedEntry}
            showHeader={false}
            showOrganization
            class="border-0 bg-transparent p-0"
        />
    {/if}

    {#snippet footer()}
        <div class="mr-auto text-xs font-mono tabular-nums text-muted-foreground">
            {focusedIndex + 1} of {history.length}
        </div>
        <Button
            variant="outline"
            size="sm"
            disabled={focusedIndex === 0}
            onclick={() => showProblem(focusedIndex - 1)}
            aria-label="Previous problem"
        >
            <Icon name="arrow_back" />
            Previous
        </Button>
        <Button
            size="sm"
            disabled={focusedIndex === history.length - 1}
            onclick={() => showProblem(focusedIndex + 1)}
            aria-label="Next problem"
        >
            Next
            <Icon name="arrow_forward" />
        </Button>
    {/snippet}
</Modal>
