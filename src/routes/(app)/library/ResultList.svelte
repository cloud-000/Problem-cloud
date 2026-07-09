<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { LinkMenu } from "$lib/components/link-menu";
    import { Problem } from "$lib/components/problem";
    import {
        aopsCommunityUrl,
        type ProblemRow,
        type SeriesRow,
        type TestRow,
    } from "$lib/library";
    import type { LibraryStore } from "$lib/state/library.svelte";

    let {
        store,
        results,
        loading,
        error,
        isInstantFeedback = false,
    }: {
        store: LibraryStore;
        results: (SeriesRow | TestRow | ProblemRow)[];
        loading: boolean;
        error: string | null;
        isInstantFeedback?: boolean;
    } = $props();

    const level = $derived(store.current.level);
</script>

{#snippet badge(text: string)}
    <span
        class="rounded-full bg-surface-container px-2 py-0.5 text-xs text-muted-foreground"
    >
        {text}
    </span>
{/snippet}

<div class="flex flex-col gap-2">
    {#if error}
        <p class="text-sm text-destructive">{error}</p>
    {:else if !loading && results.length === 0}
        <p class="text-sm text-muted-foreground">No results.</p>
    {/if}

    {#if level === "series"}
        {#each results as row (row.id)}
            {@const s = row as SeriesRow}
            {@const seriesHref = aopsCommunityUrl(s.aops_id)}
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
                    onclick={() => store.drillToTests(s)}
                >
                    {s.name}
                    {#if s.is_official}{@render badge("official")}{/if}
                </button>
                <LinkMenu
                    links={aopsLinks}
                    label="Open in Art of Problem Solving"
                />
                <Icon name="chevron_right" class="text-muted-foreground" />
            </div>
        {/each}
    {:else if level === "tests"}
        {#each results as row (row.id)}
            {@const t = row as TestRow}
            {@const testHref = aopsCommunityUrl(t.aops_category_id)}
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
                        store.drillToProblems(store.current.context.series, t)}
                >
                    <span class="font-medium">{t.name}</span>
                    <span class="flex flex-wrap items-center gap-1.5">
                        {#if t.series?.name}{@render badge(t.series.name)}{/if}
                        {#if t.year}{@render badge(String(t.year))}{/if}
                        {#if t.type}{@render badge(t.type)}{/if}
                        {#if t.is_computational}{@render badge(
                                "computational",
                            )}{/if}
                        {#if t.missing_answers_count > 0}
                            <span
                                class="inline-flex items-center gap-1 rounded-full bg-unsure-container px-2 py-0.5 text-xs font-medium text-on-unsure-container"
                            >
                                <Icon
                                    name="warning"
                                    fontsize={14}
                                    fill={true}
                                />
                                lost {t.missing_answers_count} answers
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
        {/each}
    {:else}
        {#each results as row (row.id)}
            {@const p = row as ProblemRow}
            <Problem problem={p} mode="preview" {isInstantFeedback} />
        {/each}
    {/if}
</div>
