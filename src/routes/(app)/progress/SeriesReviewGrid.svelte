<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { ProblemOrganization } from "$lib/components/problem-organization";
    import { Select } from "$lib/components/select";
    import {
        ENGAGEMENT_LABELS,
        MASTERY_LABELS,
        reviewScheduleFor,
        type Engagement,
        type Mastery,
    } from "$lib/progress";
    import {
        reviewIsDue,
        reviewRowLabel,
        statusForReview,
        summarizeSeriesReview,
        type SeriesReviewProblem,
        type SeriesReviewStatus,
        type SeriesReviewTest,
    } from "$lib/series-review";
    import { cn } from "$lib/utils";
    import { SvelteMap } from "svelte/reactivity";
    import { createVirtualizer } from "@tanstack/svelte-virtual";
    import { get } from "svelte/store";
    import {
        getAppScrollViewport,
        observeScrollOffset,
    } from "$lib/components/virtual-list/context";
    import SeriesReviewDetailCard from "./SeriesReviewDetailCard.svelte";

    let {
        tests,
        openingProblemId = null,
        onOpenProblem,
    }: {
        tests: SeriesReviewTest[];
        openingProblemId?: number | null;
        onOpenProblem: (problemId: number) => void;
    } = $props();

    type Selection = { test: SeriesReviewTest; problem: SeriesReviewProblem };
    const activityMeta: Record<SeriesReviewStatus, { label: string; icon: string }> = {
        unseen: { label: "Unseen", icon: "" },
        skipped_only: { label: "Skipped only", icon: "remove" },
        attempted: { label: "Attempted", icon: "close" },
        solved: { label: "Solved", icon: "check" },
    };
    const masteryMeta: Record<Mastery | "unassessed", { label: string; class: string }> = {
        unassessed: { label: "Unassessed", class: "border-border bg-surface-container-lowest text-muted-foreground" },
        needs_work: { label: "Needs work", class: "border-destructive/25 bg-destructive/15 text-destructive" },
        learning: { label: "Learning", class: "border-unsure/25 bg-unsure/15 text-unsure" },
        confident: { label: "Confident", class: "border-correct/25 bg-correct/15 text-correct" },
    };
    const activityOptions = [
        { value: "any", label: "Any activity" },
        ...Object.entries(activityMeta).map(([value, meta]) => ({ value, label: meta.label })),
    ];
    const masteryOptions = [
        { value: "any", label: "Any mastery" },
        ...Object.entries(masteryMeta).map(([value, meta]) => ({ value, label: meta.label })),
    ];
    const planOptions = [
        { value: "any", label: "Any plan" },
        { value: "none", label: "No plan" },
        { value: "working", label: "Working on" },
        { value: "revisit", label: "Revisit" },
        { value: "later", label: "Later" },
        { value: "ignored", label: "Ignored" },
    ];
    const dueOptions = [
        { value: "any", label: "Any schedule" },
        { value: "due", label: "Review due" },
        { value: "not_due", label: "Not due" },
    ];

    let selected = $state<Selection | null>(null);
    let cardPosition = $state({ x: 0, y: 0 });
    let activityFilter = $state("any");
    let masteryFilter = $state("any");
    let planFilter = $state("any");
    let dueFilter = $state("any");
    let hasStateFilters = $derived(
        activityFilter !== "any" ||
            masteryFilter !== "any" ||
            planFilter !== "any" ||
            dueFilter !== "any",
    );

    let visibleTests = $derived.by(() =>
        tests
            .map((test) => ({
                ...test,
                problems: test.problems.filter((problem) => {
                    const progress = problem.progress;
                    const activity = statusForReview(progress);
                    const mastery = progress?.mastery ?? "unassessed";
                    const plan = progress?.engagement ?? "none";
                    const due = reviewIsDue(progress);
                    return (
                        (activityFilter === "any" || activity === activityFilter) &&
                        (masteryFilter === "any" || mastery === masteryFilter) &&
                        (planFilter === "any" || plan === planFilter) &&
                        (dueFilter === "any" || (dueFilter === "due" ? due : !due))
                    );
                }),
            }))
            .filter((test) => test.problems.length > 0),
    );
    let summary = $derived(summarizeSeriesReview(visibleTests));
    let allSummary = $derived(summarizeSeriesReview(tests));
    let maxProblemNumber = $derived(
        Math.max(0, ...tests.flatMap((test) => test.problems.map((problem) => problem.n + 1))),
    );
    let columns = $derived(Array.from({ length: maxProblemNumber }, (_, index) => index));
    let yearGroups = $derived.by(() => {
        const groups = new SvelteMap<number | null, SeriesReviewTest[]>();
        for (const test of visibleTests) {
            const year = test.year ?? null;
            groups.set(year, [...(groups.get(year) ?? []), test]);
        }
        return [...groups.entries()];
    });
    let showTestColumn = $derived(yearGroups.some(([, rows]) => rows.length > 1));
    let yearGroupRowStarts = $derived.by(() => {
        let next = 2;
        return yearGroups.map(([, rows]) => {
            const start = next;
            next += rows.length;
            return start;
        });
    });

    const scrollViewport = getAppScrollViewport();
    let tableHead = $state<HTMLTableSectionElement | null>(null);
    let tableScrollMargin = $state(0);

    const yearGroupVirtualizer = createVirtualizer<HTMLElement, HTMLElement>({
        count: 0,
        getScrollElement: scrollViewport.getElement,
        estimateSize: () => 36,
        overscan: 2,
        useAnimationFrameWithResizeObserver: true,
    });

    $effect(() => {
        const groups = yearGroups;
        const instance = get(yearGroupVirtualizer);
        instance.setOptions({
            count: groups.length,
            estimateSize: (index) => (groups[index]?.[1].length ?? 1) * 36,
            getItemKey: (index) => groups[index]?.[0] ?? "other",
            overscan: 2,
            scrollMargin: tableScrollMargin,
            useAnimationFrameWithResizeObserver: true,
        });
        instance.measure();
    });

    $effect(() => {
        const head = tableHead;
        const viewport = scrollViewport.getElement();
        if (!head || !viewport) return;
        return observeScrollOffset(
            head,
            viewport,
            (offset) => {
                tableScrollMargin = offset;
            },
            "bottom",
        );
    });

    $effect(() => {
        if (
            selected &&
            !visibleTests.some((test) =>
                test.problems.some((problem) => problem.id === selected?.problem.id),
            )
        ) {
            selected = null;
        }
    });

    let virtualYearGroups = $derived($yearGroupVirtualizer.getVirtualItems());
    let topSpacerHeight = $derived(
        Math.max(
            0,
            (virtualYearGroups[0]?.start ?? tableScrollMargin) - tableScrollMargin,
        ),
    );
    let bottomSpacerHeight = $derived.by(() => {
        const last = virtualYearGroups.at(-1);
        if (!last) return 0;
        const renderedEnd = last.end - tableScrollMargin;
        return Math.max(0, $yearGroupVirtualizer.getTotalSize() - renderedEnd);
    });
    let matrixColumnCount = $derived(
        columns.length + (showTestColumn ? 4 : 3),
    );

    function measureYearGroup(node: HTMLElement) {
        get(yearGroupVirtualizer).measureElement(node);
        return {
            destroy() {
                get(yearGroupVirtualizer).measureElement(null);
            },
        };
    }

    function masteryKey(problem: SeriesReviewProblem): Mastery | "unassessed" {
        return problem.progress?.mastery ?? "unassessed";
    }
    function planIcon(value: Engagement | null | undefined) {
        return value === "working"
            ? "construction"
            : value === "revisit"
              ? "replay"
              : value === "later"
                ? "schedule"
                : value === "ignored"
                  ? "visibility_off"
                  : "";
    }
    function detailDate(value: string | null | undefined) {
        if (!value) return "—";
        return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
    }
    function cellLabel(test: SeriesReviewTest, problem: SeriesReviewProblem) {
        const progress = problem.progress;
        const activity = activityMeta[statusForReview(progress)].label;
        const mastery = masteryMeta[masteryKey(problem)].label;
        const plan = progress?.engagement ? ENGAGEMENT_LABELS[progress.engagement] : "No plan";
        const schedule = reviewScheduleFor(progress) === "due" ? "Review due" : reviewScheduleFor(progress);
        return `${test.name}, problem ${problem.n + 1}: ${activity}; ${mastery}; ${plan}; ${schedule}`;
    }
    function clearStateFilters() {
        activityFilter = "any";
        masteryFilter = "any";
        planFilter = "any";
        dueFilter = "any";
    }
</script>

<div class={cn("space-y-6 transition-all duration-200", selected && "pb-36 sm:pb-28")}>
    <section class="mx-auto w-full max-w-5xl space-y-4" aria-labelledby="problem-filter-heading">
        <div class="rounded-2xl border border-border/60 bg-surface-container-low/40 p-4 shadow-xs sm:p-5">
            <div class="mb-4 flex flex-wrap items-start gap-3">
                <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-container text-muted-foreground">
                    <Icon name="tune" fontsize="1.1rem" />
                </div>
                <div class="min-w-0 flex-1">
                    <h3 id="problem-filter-heading" class="text-sm font-semibold">Filters</h3>
                </div>
                {#if hasStateFilters}
                    <Button variant="ghost" size="sm" class="h-8" onclick={clearStateFilters}>
                        Clear filters
                    </Button>
                {/if}
            </div>

            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label class="flex min-w-0 flex-col gap-1.5">
                    <span class="text-xs font-medium text-muted-foreground">Activity</span>
                    <Select options={activityOptions} bind:value={activityFilter} />
                </label>
                <label class="flex min-w-0 flex-col gap-1.5">
                    <span class="text-xs font-medium text-muted-foreground">Mastery</span>
                    <Select options={masteryOptions} bind:value={masteryFilter} />
                </label>
                <label class="flex min-w-0 flex-col gap-1.5">
                    <span class="text-xs font-medium text-muted-foreground">Plan</span>
                    <Select options={planOptions} bind:value={planFilter} />
                </label>
                <label class="flex min-w-0 flex-col gap-1.5">
                    <span class="text-xs font-medium text-muted-foreground">Schedule</span>
                    <Select options={dueOptions} bind:value={dueFilter} />
                </label>
            </div>

            <div class="mt-4 grid grid-cols-3 divide-x divide-border/60 rounded-xl border border-border/50 bg-surface-container-lowest">
                <div class="px-3 py-3 text-center sm:px-4">
                    <div class="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">Shown</div>
                    <div class="mt-1 font-mono text-lg font-semibold">{summary.total}<span class="text-xs font-normal text-muted-foreground"> / {allSummary.total}</span></div>
                </div>
                <div class="px-3 py-3 text-center sm:px-4">
                    <div class="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">Attempted</div>
                    <div class="mt-1 font-mono text-lg font-semibold">{summary.attempted}</div>
                </div>
                <div class="px-3 py-3 text-center sm:px-4">
                    <div class="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">Review due</div>
                    <div class="mt-1 font-mono text-lg font-semibold">{summary.due}</div>
                </div>
            </div>
        </div>


    </section>

    <section class="w-full overflow-hidden rounded-2xl border border-border/60 bg-surface-container-low/30 shadow-xs" aria-labelledby="matrix-heading">
        <div class="border-b border-border/60 bg-surface-container-lowest px-4 py-4 sm:px-5">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div class="flex items-center gap-2">
                        <Icon name="grid_view" class="text-primary-foreground" />
                        <h3 id="matrix-heading" class="font-semibold">Problem matrix</h3>
                    </div>
                    <p class="mt-1 text-xs text-muted-foreground">
                        {visibleTests.length} test{visibleTests.length === 1 ? "" : "s"} · {summary.total} problem{summary.total === 1 ? "" : "s"}. Select a cell for details and review controls.
                    </p>
                </div>
                <div class="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-label="Matrix legend">
                    {#each Object.entries(masteryMeta) as [key, meta] (key)}
                        <span class="inline-flex items-center gap-1.5"><span class={cn("size-4 rounded border", meta.class)}></span>{meta.label}</span>
                    {/each}
                    <span class="inline-flex items-center gap-1.5"><span class="size-4 rounded border border-border bg-surface-container-lowest ring-2 ring-primary/60 ring-offset-1 ring-offset-background"></span>Due</span>
                </div>
            </div>
        </div>

        {#if visibleTests.length === 0}
            <div class="flex flex-col items-center gap-3 px-4 py-14 text-center">
                <Icon name="filter_alt_off" fontsize="1.5rem" class="text-muted-foreground" />
                <div>
                    <p class="text-sm font-medium">No problems match these filters</p>
                    <p class="mt-1 text-xs text-muted-foreground">Clear the problem filters to restore the full matrix.</p>
                </div>
                <Button variant="outline" size="sm" onclick={clearStateFilters}>Clear filters</Button>
            </div>
        {:else}
            <div class="overflow-x-auto px-3 py-4 sm:px-5">
            <table
                class="w-max min-w-full border-separate border-spacing-1"
                aria-label="Series problem review matrix"
                aria-rowcount={visibleTests.length + 1}
                aria-colcount={matrixColumnCount}
            >
                <thead bind:this={tableHead}><tr>
                    <th scope="col" class="sticky left-0 z-30 w-16 bg-surface-container-low px-2 py-1 text-left text-xs font-medium text-muted-foreground">Year</th>
                    {#if showTestColumn}<th scope="col" class="sticky left-16 z-30 w-32 bg-surface-container-low px-2 py-1 text-left text-xs font-medium text-muted-foreground">Test</th>{/if}
                    <th scope="col" class="w-auto p-0 border-none"></th>
                    {#each columns as column (column)}<th scope="col" class="size-8 min-w-8 text-center font-mono text-[0.7rem] font-normal text-muted-foreground">{column + 1}</th>{/each}
                    <th scope="col" class="w-auto p-0 border-none"></th>
                </tr></thead>
                {#if topSpacerHeight > 0}
                    <tbody aria-hidden="true">
                        <tr>
                            <td
                                colspan={matrixColumnCount}
                                class="border-none p-0"
                                style:height={`${topSpacerHeight}px`}
                            ></td>
                        </tr>
                    </tbody>
                {/if}
                {#each virtualYearGroups as virtualGroup (virtualGroup.key)}
                    {@const [year, yearTests] = yearGroups[virtualGroup.index]}
                    <tbody
                        data-index={virtualGroup.index}
                        use:measureYearGroup
                    >
                        {#each yearTests as test, rowIndex (test.id)}
                            {@const byNumber = new Map(test.problems.map((problem) => [problem.n, problem]))}
                            <tr aria-rowindex={yearGroupRowStarts[virtualGroup.index] + rowIndex}>
                                {#if rowIndex === 0}<th scope="rowgroup" rowspan={yearTests.length} class="sticky left-0 z-20 w-16 bg-surface-container-low px-2 text-left align-top text-xs font-semibold">{year ?? "Other"}</th>{/if}
                                {#if showTestColumn}<th scope="row" class="sticky left-16 z-10 max-w-32 bg-surface-container-low px-2 text-left text-xs font-medium" title={test.name}><span class="block max-w-28 truncate">{reviewRowLabel(test)}</span></th>{/if}
                                <td class="p-0 border-none"></td>
                                {#each columns as column (column)}
                                    {@const problem = byNumber.get(column)}
                                    <td class="size-8 min-w-8 p-0 text-center align-middle">
                                        {#if problem}
                                            {@const progress = problem.progress}
                                            {@const activity = activityMeta[statusForReview(progress)]}
                                            {@const mastery = masteryMeta[masteryKey(problem)]}
                                            <button
                                                type="button"
                                                class={cn("relative mx-auto flex size-8 items-center justify-center rounded border transition hover:-translate-y-px hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60", mastery.class, reviewIsDue(progress) && "ring-2 ring-primary/60 ring-offset-1 ring-offset-background", selected?.problem.id === problem.id && "z-10 scale-110 border-foreground/40 shadow-md")}
                                                aria-label={cellLabel(test, problem)}
                                                aria-pressed={selected?.problem.id === problem.id}
                                                onclick={() => (selected = selected?.problem.id === problem.id ? null : { test, problem })}
                                            >
                                                {#if activity.icon}<Icon name={activity.icon} fontsize="0.9rem" />{:else}<span class="size-1 rounded-full bg-current opacity-25"></span>{/if}
                                                {#if progress?.engagement}<Icon name={planIcon(progress.engagement)} fontsize="0.6rem" class="absolute -right-0.5 -top-0.5 rounded-full bg-surface-container-lowest" />{/if}
                                            </button>
                                        {/if}
                                    </td>
                                {/each}
                                <td class="p-0 border-none"></td>
                            </tr>
                        {/each}
                    </tbody>
                {/each}
                {#if bottomSpacerHeight > 0}
                    <tbody aria-hidden="true">
                        <tr>
                            <td
                                colspan={matrixColumnCount}
                                class="border-none p-0"
                                style:height={`${bottomSpacerHeight}px`}
                            ></td>
                        </tr>
                    </tbody>
                {/if}
            </table>
            </div>
        {/if}
    </section>

    {#if selected}
        <SeriesReviewDetailCard
            {selected}
            {openingProblemId}
            onOpenProblem={onOpenProblem}
            onClose={() => (selected = null)}
            bind:position={cardPosition}
        />
    {/if}
</div>
