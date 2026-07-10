<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
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

    let {
        tests,
        openingProblemId = null,
        onOpenProblem,
    }: {
        tests: SeriesReviewTest[];
        openingProblemId?: number | null;
        onOpenProblem: (problemId: number) => void;
    } = $props();

    type Selection = {
        test: SeriesReviewTest;
        problem: SeriesReviewProblem;
    };

    const STATUS_META: Record<
        SeriesReviewStatus,
        { label: string; icon: string; class: string }
    > = {
        unseen: {
            label: "Unseen",
            icon: "",
            class: "border-border bg-surface-container-lowest text-muted-foreground",
        },
        skipped: {
            label: "Skipped only",
            icon: "remove",
            class: "border-border bg-surface-container text-muted-foreground",
        },
        "needs-work": {
            label: "Needs work",
            icon: "close",
            class: "border-destructive/25 bg-destructive/15 text-destructive",
        },
        learning: {
            label: "Learning",
            icon: "circle",
            class: "border-unsure/25 bg-unsure/15 text-unsure",
        },
        confident: {
            label: "Confident",
            icon: "check",
            class: "border-correct/25 bg-correct/15 text-correct",
        },
    };

    let selected = $state<Selection | null>(null);
    let hovered = $state<Selection | null>(null);
    let hoverX = $state(0);
    let hoverY = $state(0);
    let summary = $derived(summarizeSeriesReview(tests));
    let maxProblemNumber = $derived(
        Math.max(0, ...tests.flatMap((test) => test.problems.map((p) => p.n + 1))),
    );
    let columns = $derived(
        Array.from({ length: maxProblemNumber }, (_, index) => index),
    );
    let yearGroups = $derived.by(() => {
        const groups = new Map<number | null, SeriesReviewTest[]>();
        for (const test of tests) {
            const year = test.year ?? null;
            groups.set(year, [...(groups.get(year) ?? []), test]);
        }
        return [...groups.entries()];
    });
    let showTestColumn = $derived(
        yearGroups.some(([, yearTests]) => yearTests.length > 1),
    );

    const pct = (part: number, total: number) =>
        total > 0 ? Math.round((part / total) * 100) : 0;

    function detailDate(value: string | null | undefined) {
        if (!value) return "—";
        return new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
        }).format(new Date(value));
    }

    function cellLabel(test: SeriesReviewTest, problem: SeriesReviewProblem) {
        const status = STATUS_META[statusForReview(problem.progress)].label;
        const attempts = problem.progress?.times_reviewed ?? 0;
        const correct = problem.progress?.times_correct ?? 0;
        const due = reviewIsDue(problem.progress) ? ", review due" : "";
        return `${test.name}, problem ${problem.n + 1}: ${status}, ${correct} correct of ${attempts} attempts${due}`;
    }

    function toggleSelection(
        test: SeriesReviewTest,
        problem: SeriesReviewProblem,
    ) {
        selected =
            selected?.problem.id === problem.id ? null : { test, problem };
    }

    function positionHover(event: PointerEvent) {
        const cardWidth = 264;
        const cardHeight = 168;
        hoverX = Math.max(
            8,
            Math.min(event.clientX + 12, window.innerWidth - cardWidth - 8),
        );
        hoverY = Math.max(
            8,
            Math.min(event.clientY + 12, window.innerHeight - cardHeight - 8),
        );
    }

    function showHover(
        event: PointerEvent,
        test: SeriesReviewTest,
        problem: SeriesReviewProblem,
    ) {
        if (event.pointerType !== "mouse") return;
        hovered = { test, problem };
        positionHover(event);
    }
</script>

<div class="space-y-4">
    <div class="grid gap-3 sm:grid-cols-2">
        <div
            class="rounded-xl border border-border/60 bg-surface-container-low p-4"
        >
            <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Attempted
            </div>
            <div class="mt-1 flex items-baseline gap-2">
                <span class="font-mono text-2xl font-bold">
                    {summary.attempted}/{summary.total}
                </span>
                <span class="text-sm text-muted-foreground">
                    {pct(summary.attempted, summary.total)}%
                </span>
            </div>
        </div>
        <div
            class="rounded-xl border border-border/60 bg-surface-container-low p-4"
        >
            <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Confident
            </div>
            <div class="mt-1 flex items-baseline gap-2">
                <span class="font-mono text-2xl font-bold">
                    {summary.confident}/{summary.total}
                </span>
                <span class="text-sm text-muted-foreground">
                    {pct(summary.confident, summary.total)}%
                </span>
            </div>
        </div>
    </div>

    <div
        class={cn(
            "flex min-h-36 flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border p-3 text-sm sm:min-h-28",
            selected
                ? "border-border/60 bg-surface-container-lowest"
                : "border-dashed border-border/50 bg-surface-container-low/30",
        )}
        aria-live="polite"
    >
        {#if selected}
            {@const progress = selected.problem.progress}
            {@const state = statusForReview(progress)}
            <div class="min-w-0 flex-1">
                <div class="truncate font-medium">{selected.test.name}</div>
                <div class="text-xs text-muted-foreground">
                    Problem {selected.problem.n + 1} · {STATUS_META[state].label}
                    {#if reviewIsDue(progress)} · Review due{/if}
                </div>
            </div>
            <dl class="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                <div>
                    <dt class="text-muted-foreground">Correct</dt>
                    <dd class="font-mono font-medium">
                        {progress?.times_correct ?? 0}/{progress?.times_reviewed ?? 0}
                    </dd>
                </div>
                <div>
                    <dt class="text-muted-foreground">Last result</dt>
                    <dd class="font-medium">
                        {progress?.last_correct == null
                            ? "—"
                            : progress.last_correct
                              ? "Correct"
                              : "Incorrect"}
                    </dd>
                </div>
                <div>
                    <dt class="text-muted-foreground">Last review</dt>
                    <dd class="font-medium">
                        {detailDate(progress?.last_reviewed_at)}
                    </dd>
                </div>
                <div>
                    <dt class="text-muted-foreground">Next review</dt>
                    <dd class="font-medium">
                        {detailDate(progress?.next_review_at)}
                    </dd>
                </div>
            </dl>
            <Button
                size="sm"
                class="gap-1.5"
                disabled={openingProblemId === selected.problem.id}
                onclick={() => onOpenProblem(selected!.problem.id)}
            >
                <Icon
                    name={openingProblemId === selected.problem.id
                        ? "progress_activity"
                        : "open_in_new"}
                    class={openingProblemId === selected.problem.id
                        ? "animate-spin"
                        : undefined}
                />
                Open problem
            </Button>
        {:else}
            <div
                class="flex w-full items-center justify-center gap-2 text-center text-sm text-muted-foreground"
            >
                <Icon name="touch_app" class="opacity-70" />
                <span>Select a problem to pin its review details here.</span>
            </div>
        {/if}
    </div>

    <div class="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {#each Object.entries(STATUS_META) as [status, meta]}
            <span class="inline-flex items-center gap-1.5">
                <span
                    class={cn(
                        "inline-flex size-5 items-center justify-center rounded border",
                        meta.class,
                    )}
                >
                    {#if meta.icon}
                        <Icon name={meta.icon} fontsize="0.8rem" />
                    {/if}
                </span>
                {meta.label}
            </span>
        {/each}
        <span class="inline-flex items-center gap-1.5">
            <span
                class="size-5 rounded border border-border bg-surface-container-lowest ring-2 ring-primary/60 ring-offset-1 ring-offset-background"
            ></span>
            Review due
        </span>
    </div>

    <div class="overflow-x-auto pb-2">
        <table
            class="w-max min-w-full border-separate border-spacing-x-1 border-spacing-y-1"
        >
            <thead>
                <tr>
                    <th
                        scope="col"
                        class="sticky left-0 z-30 w-16 min-w-16 bg-transparent px-2 py-1 text-left text-xs font-medium text-muted-foreground"
                    >
                        Year
                    </th>
                    {#if showTestColumn}
                        <th
                            scope="col"
                            class="sticky left-16 z-30 w-fit max-w-48 bg-transparent px-2 py-1 text-left text-xs font-medium text-muted-foreground"
                        >
                            Test
                        </th>
                    {/if}
                    {#each columns as column}
                        <th
                            scope="col"
                            class="size-8 min-w-8 text-center font-mono text-[0.7rem] font-normal text-muted-foreground"
                        >
                            {column + 1}
                        </th>
                    {/each}
                </tr>
            </thead>
            {#each yearGroups as [year, yearTests], groupIndex (year)}
                <tbody>
                    {#each yearTests as test, rowIndex (test.id)}
                        {@const byNumber = new Map(
                            test.problems.map((problem) => [problem.n, problem]),
                        )}
                        <tr>
                            {#if rowIndex === 0}
                                <th
                                    scope="rowgroup"
                                    rowspan={yearTests.length}
                                    class={cn(
                                        "sticky left-0 z-20 w-16 min-w-16 bg-transparent px-2 text-left align-top text-xs font-semibold text-foreground",
                                        groupIndex > 0 && "border-t border-border/40 pt-2",
                                    )}
                                >
                                    {year ?? "Other"}
                                </th>
                            {/if}
                            {#if showTestColumn}
                                <th
                                    scope="row"
                                    class={cn(
                                        "sticky left-16 z-10 w-fit max-w-48 bg-transparent px-2 text-left text-xs font-medium",
                                        groupIndex > 0 &&
                                            rowIndex === 0 &&
                                            "border-t border-border/40 pt-2",
                                    )}
                                    title={test.name}
                                >
                                    <span class="block max-w-44 truncate">
                                        {reviewRowLabel(test)}
                                    </span>
                                </th>
                            {/if}
                            {#each columns as column}
                                {@const problem = byNumber.get(column)}
                                <td
                                    class={cn(
                                        "size-8 min-w-8 p-0",
                                        groupIndex > 0 &&
                                            rowIndex === 0 &&
                                            "border-t border-border/40 pt-1",
                                    )}
                                >
                                    {#if problem}
                                        {@const status = statusForReview(problem.progress)}
                                        {@const meta = STATUS_META[status]}
                                        <button
                                            type="button"
                                            class={cn(
                                                "relative flex size-8 items-center justify-center rounded border transition duration-150 hover:-translate-y-px hover:brightness-95 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                                                meta.class,
                                                reviewIsDue(problem.progress) &&
                                                    "ring-2 ring-primary/60 ring-offset-1 ring-offset-background",
                                                selected?.problem.id === problem.id &&
                                                    "z-10 scale-110 border-foreground/40 brightness-95 shadow-md",
                                            )}
                                            aria-label={cellLabel(test, problem)}
                                            aria-pressed={selected?.problem.id === problem.id}
                                            onpointerenter={(event) =>
                                                showHover(event, test, problem)}
                                            onpointermove={positionHover}
                                            onpointerleave={() => (hovered = null)}
                                            onclick={() => toggleSelection(test, problem)}
                                        >
                                            {#if meta.icon}
                                                <Icon name={meta.icon} fontsize="0.9rem" />
                                            {:else}
                                                <span
                                                    class="size-1 rounded-full bg-current opacity-30"
                                                ></span>
                                            {/if}
                                            {#if selected?.problem.id === problem.id}
                                                <span
                                                    class="absolute -right-1 -top-1 size-2 rounded-full bg-foreground ring-2 ring-background"
                                                    aria-hidden="true"
                                                ></span>
                                            {/if}
                                        </button>
                                    {:else}
                                        <span class="block size-8" aria-hidden="true"></span>
                                    {/if}
                                </td>
                            {/each}
                        </tr>
                    {/each}
                </tbody>
            {/each}
        </table>
    </div>

    {#if hovered}
        {@const progress = hovered.problem.progress}
        {@const state = statusForReview(progress)}
        <div
            class="pointer-events-none fixed z-50 w-64 rounded-lg border border-border/70 bg-popover p-3 text-popover-foreground shadow-lg"
            style:left={`${hoverX}px`}
            style:top={`${hoverY}px`}
            role="tooltip"
        >
            <div class="truncate text-sm font-medium">{hovered.test.name}</div>
            <div class="mt-0.5 text-xs text-muted-foreground">
                Problem {hovered.problem.n + 1} · {STATUS_META[state].label}
                {#if reviewIsDue(progress)} · Review due{/if}
            </div>
            <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div>
                    <dt class="text-muted-foreground">Correct</dt>
                    <dd class="font-mono font-medium">
                        {progress?.times_correct ?? 0}/{progress?.times_reviewed ?? 0}
                    </dd>
                </div>
                <div>
                    <dt class="text-muted-foreground">Last result</dt>
                    <dd class="font-medium">
                        {progress?.last_correct == null
                            ? "—"
                            : progress.last_correct
                              ? "Correct"
                              : "Incorrect"}
                    </dd>
                </div>
                <div class="col-span-2">
                    <dt class="text-muted-foreground">Next review</dt>
                    <dd class="font-medium">
                        {detailDate(progress?.next_review_at)}
                    </dd>
                </div>
            </dl>
        </div>
    {/if}
</div>
