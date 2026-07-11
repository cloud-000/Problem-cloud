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
    let activityFilter = $state("any");
    let masteryFilter = $state("any");
    let planFilter = $state("any");
    let dueFilter = $state("any");

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
</script>

<div class="space-y-4">
    <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Select options={activityOptions} bind:value={activityFilter} />
        <Select options={masteryOptions} bind:value={masteryFilter} />
        <Select options={planOptions} bind:value={planFilter} />
        <Select options={dueOptions} bind:value={dueFilter} />
    </div>

    <div class="grid gap-3 lg:grid-cols-[12rem_12rem_1fr]">
        <div class="rounded-xl border border-border/60 bg-surface-container-low p-4">
            <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Attempted</div>
            <div class="mt-1 font-mono text-2xl font-bold">{summary.attempted}/{summary.total}</div>
        </div>
        <div class="rounded-xl border border-border/60 bg-surface-container-low p-4">
            <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Review due</div>
            <div class="mt-1 font-mono text-2xl font-bold">{summary.due}</div>
        </div>
        <div class="rounded-xl border border-border/60 bg-surface-container-low p-4">
            <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Mastery</div>
            <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {#each Object.entries(masteryMeta) as [key, meta] (key)}
                    <span class="text-muted-foreground">{meta.label} <strong class="font-mono text-foreground">{summary.mastery[key as Mastery | "unassessed"]}</strong></span>
                {/each}
            </div>
        </div>
    </div>

    <div class={cn("flex min-h-28 flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border p-3 text-sm", selected ? "border-border/60 bg-surface-container-lowest" : "border-dashed border-border/50 bg-surface-container-low/30")} aria-live="polite">
        {#if selected}
            {@const progress = selected.problem.progress}
            <div class="min-w-0 flex-1">
                <div class="truncate font-medium">{selected.test.name}</div>
                <div class="text-xs text-muted-foreground">Problem {selected.problem.n + 1} · {activityMeta[statusForReview(progress)].label}{#if reviewIsDue(progress)} · Review due{/if}</div>
            </div>
            <dl class="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                <div><dt class="text-muted-foreground">Correct</dt><dd class="font-mono font-medium">{progress?.times_correct ?? 0}/{progress?.times_reviewed ?? 0}</dd></div>
                <div><dt class="text-muted-foreground">Last result</dt><dd class="font-medium">{progress?.last_correct == null ? "—" : progress.last_correct ? "Correct" : "Incorrect"}</dd></div>
                <div><dt class="text-muted-foreground">Next review</dt><dd class="font-medium">{detailDate(progress?.next_review_at)}</dd></div>
            </dl>
            <ProblemOrganization
                problemId={selected.problem.id}
                mastery={progress?.mastery ?? null}
                engagement={progress?.engagement ?? null}
                onchange={(state) => {
                    if (selected?.problem.progress) {
                        selected.problem.progress.mastery = state.mastery;
                        selected.problem.progress.engagement = state.engagement;
                    }
                }}
            />
            <Button size="sm" class="gap-1.5" disabled={openingProblemId === selected.problem.id} onclick={() => onOpenProblem(selected!.problem.id)}>
                <Icon name={openingProblemId === selected.problem.id ? "progress_activity" : "open_in_new"} class={openingProblemId === selected.problem.id ? "animate-spin" : undefined} />
                Open problem
            </Button>
        {:else}
            <div class="flex w-full items-center justify-center gap-2 text-muted-foreground"><Icon name="touch_app" /><span>Select a problem to inspect all four dimensions.</span></div>
        {/if}
    </div>

    <div class="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {#each Object.entries(masteryMeta) as [key, meta] (key)}
            <span class="inline-flex items-center gap-1.5"><span class={cn("size-5 rounded border", meta.class)}></span>{meta.label}</span>
        {/each}
        <span class="inline-flex items-center gap-1.5"><span class="size-5 rounded border border-border bg-surface-container-lowest ring-2 ring-primary/60 ring-offset-1 ring-offset-background"></span>Review due</span>
    </div>

    {#if visibleTests.length === 0}
        <div class="py-10 text-center text-sm text-muted-foreground">No problems match these state filters.</div>
    {:else}
        <div class="overflow-x-auto pb-2">
            <table class="w-max min-w-full border-separate border-spacing-1">
                <thead><tr>
                    <th scope="col" class="sticky left-0 z-30 w-16 bg-background px-2 py-1 text-left text-xs font-medium text-muted-foreground">Year</th>
                    {#if showTestColumn}<th scope="col" class="sticky left-16 z-30 max-w-48 bg-background px-2 py-1 text-left text-xs font-medium text-muted-foreground">Test</th>{/if}
                    {#each columns as column (column)}<th scope="col" class="size-8 min-w-8 text-center font-mono text-[0.7rem] font-normal text-muted-foreground">{column + 1}</th>{/each}
                </tr></thead>
                {#each yearGroups as [year, yearTests] (year)}
                    <tbody>
                        {#each yearTests as test, rowIndex (test.id)}
                            {@const byNumber = new Map(test.problems.map((problem) => [problem.n, problem]))}
                            <tr>
                                {#if rowIndex === 0}<th scope="rowgroup" rowspan={yearTests.length} class="sticky left-0 z-20 w-16 bg-background px-2 text-left align-top text-xs font-semibold">{year ?? "Other"}</th>{/if}
                                {#if showTestColumn}<th scope="row" class="sticky left-16 z-10 max-w-48 bg-background px-2 text-left text-xs font-medium" title={test.name}><span class="block max-w-44 truncate">{reviewRowLabel(test)}</span></th>{/if}
                                {#each columns as column (column)}
                                    {@const problem = byNumber.get(column)}
                                    <td class="size-8 min-w-8 p-0">
                                        {#if problem}
                                            {@const progress = problem.progress}
                                            {@const activity = activityMeta[statusForReview(progress)]}
                                            {@const mastery = masteryMeta[masteryKey(problem)]}
                                            <button
                                                type="button"
                                                class={cn("relative flex size-8 items-center justify-center rounded border transition hover:-translate-y-px hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60", mastery.class, reviewIsDue(progress) && "ring-2 ring-primary/60 ring-offset-1 ring-offset-background", selected?.problem.id === problem.id && "z-10 scale-110 border-foreground/40 shadow-md")}
                                                aria-label={cellLabel(test, problem)}
                                                aria-pressed={selected?.problem.id === problem.id}
                                                onclick={() => (selected = selected?.problem.id === problem.id ? null : { test, problem })}
                                            >
                                                {#if activity.icon}<Icon name={activity.icon} fontsize="0.9rem" />{:else}<span class="size-1 rounded-full bg-current opacity-25"></span>{/if}
                                                {#if progress?.engagement}<Icon name={planIcon(progress.engagement)} fontsize="0.6rem" class="absolute -right-0.5 -top-0.5 rounded-full bg-background" />{/if}
                                            </button>
                                        {/if}
                                    </td>
                                {/each}
                            </tr>
                        {/each}
                    </tbody>
                {/each}
            </table>
        </div>
    {/if}
</div>
