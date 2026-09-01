<script lang="ts">
    import { onDestroy } from "svelte";
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
    import { anchorFor } from "$lib/ai/session/anchor";
    import { CoachContextRegister } from "$lib/components/coach";
    import { coach } from "$lib/state/coach.svelte";
    import { utilityPanel } from "$lib/state/utility-panel.svelte";
    import { offlineMode } from "$lib/state/offline-mode.svelte";

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
        contained = false,
        onEndReached,
        resetKey,
        onRetry,
    }: {
        store: LibraryStore;
        results: ResultRow[];
        resultsLevel: Level | null;
        loading: boolean;
        error: string | null;
        isInstantFeedback?: boolean;
        /**
         * Stay on this surface: no practice launch, AoPS menus, or Coach Ask.
         * The tour's Library mock uses this so the real rows cannot leave the tour.
         */
        contained?: boolean;
        onEndReached?: () => void;
        resetKey?: unknown;
        onRetry?: () => void;
    } = $props();

    const level = $derived(store.current.level);
    /**
     * Problem rows name their test only when the page isn't already naming it.
     * Drilling into a test puts its name in the scope chip above the list, but
     * each row keeps its problem number so it remains identifiable while the
     * chip has scrolled out of view. An unscoped list (a filtered search across
     * tests) genuinely needs both the test and number on each row.
     */
    const problemHeader = $derived(store.current.context.test ? "number" : "full");
    const displayedResults = $derived(
        resultsLevel === level ? results : [],
    );
    // This is a persistence cache, not render state. It is populated lazily from
    // the result snippet, so it must remain non-reactive: mutating a SvelteMap
    // during template evaluation triggers `state_unsafe_mutation`.
    const problemDrafts = new Map<number, ProblemDraft>();
    let askedProblem = $state<ProblemRow | null>(null);

    /**
     * The library's sitting has no practice session (`docs/ai-coach-sessions.md` §4) —
     * the null slot the anchor index reserves for exactly this. Nothing here ever
     * concludes: a library chat is not an attempt, so it stays live and offerable until
     * it goes stale, which is what lets a return visit be offered it back.
     */
    const LIBRARY_WORK = { submitted: false, skipped: false } as const;

    function askAboutProblem(problem: ProblemRow, invoker: HTMLElement) {
        askedProblem = problem;
        // Anchored, not merely scoped. This is what makes the chat about a problem
        // findable again: pressing Ask on a problem you have discussed before offers
        // that thread back, and pressing it on a different one leaves this thread for
        // its own and starts that problem's. Both fall out of the anchor switch.
        void coach.openWorkThread(anchorFor(problem, null), LIBRARY_WORK);
        if (utilityPanel.activeView === "coach") {
            void coach.initialize();
            return;
        }
        if (utilityPanel.activeView) utilityPanel.close(false);
        coach.openQuickAsk(invoker);
    }

    let coachShowing = $derived(
        coach.quickAskVisible || utilityPanel.activeView === "coach",
    );

    /**
     * Closing the Coach ends the library's sitting.
     *
     * Unlike the trainer's, this anchor is raised by a *gesture* rather than by what is
     * on screen: the library has no "current problem", only the one whose Ask button was
     * pressed, so "still on it" can only mean "the Coach summoned for it is still up".
     * Releasing is a real side effect on a one-way transition, which is what an effect is
     * for — but nothing local is cleared here, because the store's own anchor is what
     * says which problem this page is talking about.
     */
    $effect(() => {
        if (contained) return;
        if (coachShowing) return;
        void coach.releaseWorkAnchor(LIBRARY_WORK);
    });

    // Leaving the library is the same departure as closing the Coach. Guarded on the
    // session-less anchor because that slot is this page's alone — the trainer's anchors
    // always carry a session, and releasing one of those from here would retire it.
    onDestroy(() => {
        if (contained) return;
        if (coach.workAnchor?.practiceSessionId === null) {
            void coach.releaseWorkAnchor(LIBRARY_WORK);
        }
    });

    /**
     * The row whose chat is open, read back through the anchor the store actually holds
     * rather than through the click that set it. `askedProblem` only carries the row so
     * its label can be rendered; the anchor decides whether it counts. That is what makes
     * a stale selection impossible to resurrect — releasing on close drops the anchor, so
     * reopening the Coach by any other route (the chord) finds nothing scoped, where a
     * remembered click would have handed the old problem straight back.
     */
    let scopedProblem = $derived(
        askedProblem &&
            coach.workAnchor?.practiceSessionId === null &&
            coach.workAnchor.problemId === (askedProblem.canonical_id ?? askedProblem.id)
            ? askedProblem
            : null,
    );

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
            {#if !contained && aopsLinks.length}
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
            {#if !contained}
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
            {/if}
        </div>
    {:else}
        {@const problem = row as ProblemRow}
        {@const draft = problemDraft(problem)}
        <Problem
            {problem}
            header={problemHeader}
            appearance="row"
            solution="collapsed"
            {isInstantFeedback}
            externalLinks={!contained}
            bind:answer={draft.answer}
            bind:selectedChoice={draft.selectedChoice}
            bind:eliminated={draft.eliminated}
            mastery={draft.mastery}
            engagement={draft.engagement}
            onOrganizationChange={(state) => updateOrganization(draft, state)}
            onAsk={!contained && coach.enabled
                ? (invoker) => askAboutProblem(problem, invoker)
                : undefined}
        />
    {/if}
{/snippet}

{#if !contained && scopedProblem}
    <CoachContextRegister
        {...problemContextLayer({
            ownerId: "library:problem",
            source: "selection",
            problem: scopedProblem,
            policy: "coaching",
        })}
    />
{/if}

{#if error}
    <div class="flex flex-col items-start gap-3 py-8">
        <p class="type-secondary text-destructive">{error}</p>
        {#if onRetry}<Button size="sm" variant="outline" onclick={onRetry}>Retry</Button>{/if}
    </div>
{:else if !loading && displayedResults.length === 0}
    <p class="py-12 text-center type-secondary text-muted-foreground">
        {offlineMode.lastLocalRead || offlineMode.effective === "local"
            ? "None of your downloaded problems match this search and filter combination."
            : "No results match this search and filter combination."}
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
