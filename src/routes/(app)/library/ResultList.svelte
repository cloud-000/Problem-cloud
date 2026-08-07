<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { Button } from "$lib/components/button";
    import { resolve } from "$app/paths";
    import { LinkMenu } from "$lib/components/link-menu";
    import { Problem } from "$lib/components/problem";
    import { VirtualList } from "$lib/components/virtual-list";
    import {
        aopsCommunityUrl,
        type Level,
        type ProblemRow,
        type SeriesRow,
        type TestRow,
    } from "$lib/library";
    import type { Engagement, Mastery, PersonalProblemState } from "$lib/progress";
    import type { LibraryStore } from "$lib/state/library.svelte";
    import { practiceLaunchHref } from "$lib/practice-launch";
    import { problemContextLayer } from "$lib/ai/context/surfaces";
    import { CoachContextRegister } from "$lib/components/coach";
    import { coach } from "$lib/state/coach.svelte";
    import { utilityPanel } from "$lib/state/utility-panel.svelte";

    type ResultRow = SeriesRow | TestRow | ProblemRow;
    class ProblemDraft {
        answer = $state("");
        selectedChoice = $state<number | null>(null);
        eliminated = $state<number[]>([]);
        mastery: Mastery | null;
        engagement: Engagement | null;

        constructor(problem: ProblemRow) {
            this.mastery = $state(problem.progress?.mastery ?? null);
            this.engagement = $state(problem.progress?.engagement ?? null);
        }
    }

    let {
        store,
        results,
        resultsLevel,
        loading,
        error,
        isInstantFeedback = false,
        onEndReached,
        resetKey,
    }: {
        store: LibraryStore;
        results: ResultRow[];
        resultsLevel: Level | null;
        loading: boolean;
        error: string | null;
        isInstantFeedback?: boolean;
        onEndReached?: () => void;
        resetKey?: unknown;
    } = $props();

    const level = $derived(store.current.level);
    const displayedResults = $derived(
        resultsLevel === level ? results : [],
    );
    // This is a persistence cache, not render state. It is populated lazily from
    // the result snippet, so it must remain non-reactive: mutating a SvelteMap
    // during template evaluation triggers `state_unsafe_mutation`.
    const problemDrafts = new Map<number, ProblemDraft>();
    let askedProblem = $state<ProblemRow | null>(null);

    function askAboutProblem(problem: ProblemRow, invoker: HTMLElement) {
        askedProblem = problem;
        if (utilityPanel.activeView === "coach") {
            void coach.initialize();
            return;
        }
        if (utilityPanel.activeView) utilityPanel.close(false);
        coach.openQuickAsk(invoker);
    }

    function problemDraft(problem: ProblemRow): ProblemDraft {
        const existing = problemDrafts.get(problem.id);
        if (existing) return existing;
        const draft = new ProblemDraft(problem);
        problemDrafts.set(problem.id, draft);
        return draft;
    }

    function updateOrganization(
        draft: ProblemDraft,
        state: PersonalProblemState,
    ) {
        draft.mastery = state.mastery;
        draft.engagement = state.engagement;
    }

    function estimateRowSize() {
        if (level === "series") return 72;
        if (level === "tests") return 104;
        return 360;
    }

    function overscanForLevel() {
        return level === "problems" ? 2 : 4;
    }
</script>

{#snippet badge(text: string)}
    <span
        class="rounded-full bg-surface-container px-2 py-0.5 type-caption text-muted-foreground"
    >
        {text}
    </span>
{/snippet}

{#snippet resultRow(row: ResultRow)}
    {#if level === "series"}
        {@const series = row as SeriesRow}
        {@const seriesHref = aopsCommunityUrl(series.aops_id)}
        {@const aopsLinks =
            seriesHref != null
                ? [{ label: "Art of Problem Solving", href: seriesHref }]
                : []}
        <div class="flex flex-col gap-3 border-b border-border py-4 sm:flex-row sm:items-center">
            <button
                type="button"
                class="group flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onclick={() => store.drillToTests(series)}
            >
                <span class="min-w-0 flex-1">
                    <span class="block type-body font-semibold text-foreground group-hover:underline">
                        {series.name}
                    </span>
                    <span class="mt-1 flex flex-wrap items-center gap-1.5">
                        {#if series.is_official}{@render badge("Official")}{/if}
                        {@render badge(`Series ${series.id}`)}
                    </span>
                </span>
                <Icon name="chevron_right" class="shrink-0 text-muted-foreground" />
            </button>
            {#if aopsLinks.length}
                <div class="flex justify-end">
                    <LinkMenu
                        links={aopsLinks}
                        label="Open in Art of Problem Solving"
                    />
                </div>
            {/if}
        </div>
    {:else if level === "tests"}
        {@const test = row as TestRow}
        {@const testHref = aopsCommunityUrl(test.aops_category_id)}
        {@const aopsLinks =
            testHref != null
                ? [{ label: "Art of Problem Solving", href: testHref }]
                : []}
        <div class="flex flex-col gap-3 border-b border-border py-4 sm:flex-row sm:items-center">
            <button
                type="button"
                class="group flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onclick={() =>
                    store.drillToProblems(store.current.context.series, test)}
            >
                <span class="min-w-0 flex-1">
                    <span class="block type-body font-semibold text-foreground group-hover:underline">
                        {test.name}
                    </span>
                    <span class="mt-1 flex flex-wrap items-center gap-1.5">
                        {#if test.series?.name}{@render badge(test.series.name)}{/if}
                        {#if test.year}{@render badge(String(test.year))}{/if}
                        {#if test.type}{@render badge(test.type)}{/if}
                        {@render badge(`Test ${test.id}`)}
                        {#if test.is_computational}{@render badge("Computational")}{/if}
                        {#if test.missing_answers_count > 0}
                            <span
                                class="inline-flex items-center gap-1 rounded-full bg-unsure-container px-2 py-0.5 type-caption text-on-unsure-container"
                            >
                                <Icon name="warning" fontsize={14} fill={true} />
                                Missing {test.missing_answers_count} answers
                            </span>
                        {/if}
                    </span>
                </span>
                <Icon name="chevron_right" class="shrink-0 text-muted-foreground" />
            </button>
            <div class="flex w-full items-center justify-end gap-1 sm:w-auto">
                {#if test.series_id != null}
                    <Button
                        href={practiceLaunchHref(
                            {
                                kind: "mock-test",
                                testId: test.id,
                                seriesId: test.series_id,
                            },
                            resolve("/practice"),
                        )}
                        variant="outline"
                        size="sm"
                        class="flex-1 gap-1.5 sm:flex-none"
                        aria-label={`Take ${test.name} as a mock test`}
                    >
                        <Icon name="play_arrow" />
                        Mock test
                    </Button>
                {/if}
                {#if aopsLinks.length}
                    <LinkMenu
                        links={aopsLinks}
                        label="Open in Art of Problem Solving"
                    />
                {/if}
            </div>
        </div>
    {:else}
        {@const problem = row as ProblemRow}
        {@const draft = problemDraft(problem)}
        <Problem
            {problem}
            mode="preview"
            appearance="row"
            {isInstantFeedback}
            bind:answer={draft.answer}
            bind:selectedChoice={draft.selectedChoice}
            bind:eliminated={draft.eliminated}
            mastery={draft.mastery}
            engagement={draft.engagement}
            onOrganizationChange={(state) => updateOrganization(draft, state)}
            onAsk={coach.enabled
                ? (invoker) => askAboutProblem(problem, invoker)
                : undefined}
        />
    {/if}
{/snippet}

{#if askedProblem}
    <CoachContextRegister
        {...problemContextLayer({
            ownerId: "library:problem",
            source: "selection",
            problem: askedProblem,
            policy: "coaching",
        })}
    />
{/if}

{#if error}
    <p class="py-8 type-secondary text-destructive">{error}</p>
{:else if !loading && displayedResults.length === 0}
    <p class="py-12 text-center type-secondary text-muted-foreground">
        No results match this search and filter combination.
    </p>
{/if}

{#if displayedResults.length > 0}
    <VirtualList
        items={displayedResults}
        getKey={(row) => `${level}:${row.id}`}
        estimateSize={estimateRowSize}
        overscan={overscanForLevel()}
        gap={0}
        {onEndReached}
        {resetKey}
        ariaLabel={`${level} results`}
        item={resultRow}
    />
{/if}
