<script lang="ts">
    import { Icon } from "$lib/components/icon";
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
        if (level === "series") return 50;
        if (level === "tests") return 70;
        return 260;
    }

    function overscanForLevel() {
        return level === "problems" ? 2 : 4;
    }
</script>

{#snippet badge(text: string)}
    <span
        class="rounded-full bg-surface-container px-2 py-0.5 text-xs text-muted-foreground"
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
        <div
            class="flex items-center gap-1 rounded-lg border border-border bg-surface-container-low pr-2 transition-colors hover:bg-surface-container"
        >
            <button
                type="button"
                class="flex flex-1 items-center gap-2 p-3 text-left font-medium"
                onclick={() => store.drillToTests(series)}
            >
                {series.name}
                {#if series.is_official}{@render badge("official")}{/if}
            </button>
            <LinkMenu
                links={aopsLinks}
                label="Open in Art of Problem Solving"
            />
            <Icon name="chevron_right" class="text-muted-foreground" />
        </div>
    {:else if level === "tests"}
        {@const test = row as TestRow}
        {@const testHref = aopsCommunityUrl(test.aops_category_id)}
        {@const aopsLinks =
            testHref != null
                ? [{ label: "Art of Problem Solving", href: testHref }]
                : []}
        <div
            class="flex items-center gap-1 rounded-lg border border-border bg-surface-container-low pr-2 transition-colors hover:bg-surface-container"
        >
            <button
                type="button"
                class="flex flex-1 flex-col gap-1 p-3 text-left"
                onclick={() =>
                    store.drillToProblems(store.current.context.series, test)}
            >
                <span class="font-medium">{test.name}</span>
                <span class="flex flex-wrap items-center gap-1.5">
                    {#if test.series?.name}{@render badge(test.series.name)}{/if}
                    {#if test.year}{@render badge(String(test.year))}{/if}
                    {#if test.type}{@render badge(test.type)}{/if}
                    {#if test.is_computational}{@render badge(
                            "computational",
                        )}{/if}
                    {#if test.missing_answers_count > 0}
                        <span
                            class="inline-flex items-center gap-1 rounded-full bg-unsure-container px-2 py-0.5 text-xs font-medium text-on-unsure-container"
                        >
                            <Icon name="warning" fontsize={14} fill={true} />
                            lost {test.missing_answers_count} answers
                        </span>
                    {/if}
                </span>
            </button>
            <LinkMenu
                links={aopsLinks}
                label="Open in Art of Problem Solving"
            />
            <Icon name="chevron_right" class="text-muted-foreground" />
        </div>
    {:else}
        {@const problem = row as ProblemRow}
        {@const draft = problemDraft(problem)}
        <Problem
            {problem}
            mode="preview"
            {isInstantFeedback}
            bind:answer={draft.answer}
            bind:selectedChoice={draft.selectedChoice}
            bind:eliminated={draft.eliminated}
            mastery={draft.mastery}
            engagement={draft.engagement}
            onOrganizationChange={(state) => updateOrganization(draft, state)}
        />
    {/if}
{/snippet}

{#if error}
    <p class="mb-2 text-sm text-destructive">{error}</p>
{:else if !loading && displayedResults.length === 0}
    <p class="text-sm text-muted-foreground">No results.</p>
{/if}

{#if displayedResults.length > 0}
    <VirtualList
        items={displayedResults}
        getKey={(row) => `${level}:${row.id}`}
        estimateSize={estimateRowSize}
        overscan={overscanForLevel()}
        gap={8}
        {onEndReached}
        {resetKey}
        ariaLabel={`${level} results`}
        item={resultRow}
    />
{/if}
