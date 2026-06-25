<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { Problem } from "$lib/components/problem";
    import {
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
            <button
                type="button"
                class="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-container-low p-3 text-left transition-colors hover:bg-surface-container"
                onclick={() => store.drillToTests(s)}
            >
                <span class="flex items-center gap-2 font-medium">
                    {s.name}
                    {#if s.is_official}{@render badge("official")}{/if}
                </span>
                <Icon name="chevron_right" class="text-muted-foreground" />
            </button>
        {/each}
    {:else if level === "tests"}
        {#each results as row (row.id)}
            {@const t = row as TestRow}
            <button
                type="button"
                class="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-container-low p-3 text-left transition-colors hover:bg-surface-container"
                onclick={() =>
                    store.drillToProblems(store.current.context.series, t)}
            >
                <span class="flex flex-col gap-1">
                    <span class="font-medium">{t.name}</span>
                    <span class="flex flex-wrap items-center gap-1.5">
                        {#if t.series?.name}{@render badge(t.series.name)}{/if}
                        {#if t.year}{@render badge(String(t.year))}{/if}
                        {#if t.type}{@render badge(t.type)}{/if}
                        {#if t.is_computational}{@render badge(
                                "computational",
                            )}{/if}
                    </span>
                </span>
                <Icon name="chevron_right" class="text-muted-foreground" />
            </button>
        {/each}
    {:else}
        {#each results as row (row.id)}
            {@const p = row as ProblemRow}
            <Problem problem={p} mode="preview" {isInstantFeedback} />
        {/each}
    {/if}
</div>
