<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Modal } from "$lib/components/modal";
    import { ProblemReview } from "$lib/components/problem";
    import { ProblemGrid, type ProblemGridCell } from "$lib/components/problem-grid";
    import { SegmentBar } from "$lib/components/segment-bar";
    import { formatElapsed } from "$lib/utils";
    import type { PracticeHistoryEntry } from "./practice-state";
    import type { TestResultSummary } from "./test-state";

    let {
        history,
        summary,
        elapsedMs,
    }: {
        history: PracticeHistoryEntry[];
        summary: TestResultSummary;
        elapsedMs: number;
    } = $props();

    let cells = $derived<ProblemGridCell[]>(
        history.map((entry) => {
            const mcq = (entry.problem.choices?.length ?? 0) > 1;
            const skipped =
                entry.skipped ??
                (mcq ? entry.selectedChoice == null : !entry.answer.trim());
            const state: ProblemGridCell["state"] = skipped
                ? "skipped"
                : entry.correct
                  ? "correct"
                  : "incorrect";
            return { label: entry.problem.n + 1, state, flagged: entry.flagged };
        }),
    );

    let focusedIndex = $state(0);
    let reviewOpen = $state(false);
    let focusedEntry = $derived(history[focusedIndex]);

    function scrollToProblem(index: number) {
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

    function openProblem(index: number) {
        focusedIndex = index;
        reviewOpen = true;
    }

    function showProblem(index: number) {
        if (index < 0 || index >= history.length) return;
        focusedIndex = index;
    }
</script>

{#snippet statChip(value: number, color: string)}
    <span class="inline-flex h-8 min-w-8 items-center justify-center rounded-md bg-surface-container-low px-2.5 font-mono tabular-nums" style:color>
        {value}
    </span>
{/snippet}

<div data-test-results-scroll class="flex-1 overflow-y-auto px-4 sm:px-6 pb-10">
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 pt-4">
        <div data-test-results-summary class="sticky top-0 z-20 flex flex-col gap-3 rounded-xl border border-border/60 bg-surface-container-lowest p-5 shadow-sm">
            <div class="flex items-center gap-2">
                <Icon name="task_alt" class="text-primary" fontsize={22} />
                <h2 class="text-lg font-semibold">Test complete</h2>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs font-mono text-muted-foreground">
                {@render statChip(summary.correct, "var(--color-correct)")}
                {@render statChip(summary.incorrect, "var(--color-destructive)")}
                {@render statChip(summary.skipped, "var(--color-unsure)")}
                <span class="ml-1">
                    {summary.correct}/{history.length} correct · {formatElapsed(elapsedMs)}
                </span>
            </div>
            <SegmentBar
                class="h-2 min-w-0"
                segments={[
                    { value: summary.correct, color: "var(--color-correct)", label: "Correct" },
                    { value: summary.incorrect, color: "var(--color-destructive)", label: "Incorrect" },
                    { value: summary.skipped, color: "var(--color-unsure)", label: "Skipped" },
                ]}
            />
            <ProblemGrid class="mt-1" {cells} onSelect={scrollToProblem} />
        </div>
        <div class="flex flex-col gap-3">
            {#each history as entry, index (entry.problem.id)}
                <div id={`test-review-${index}`} class="scroll-mt-4">
                    <div class="mb-1.5 flex justify-end">
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            onclick={() => openProblem(index)}
                            aria-label={`Open problem ${entry.problem.n + 1} in focused view`}
                            title="Open in focused view"
                            class="text-muted-foreground hover:text-primary-foreground"
                        >
                            <Icon name="open_in_full" />
                        </Button>
                    </div>
                    <ProblemReview {entry} elapsedMs={entry.elapsedMs} />
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
    description={focusedEntry?.problem.tests?.name ?? "Test review"}
    onClose={() => (reviewOpen = false)}
>
    {#if focusedEntry}
        <ProblemReview
            entry={focusedEntry}
            elapsedMs={focusedEntry.elapsedMs}
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
