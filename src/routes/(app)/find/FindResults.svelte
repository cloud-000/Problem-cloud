<script lang="ts">
    import { Problem } from "$lib/components/problem";
    import {
        type Level,
        type ProblemRow,
        type SeriesRow,
        type TestRow,
    } from "$lib/library";

    let {
        level,
        results,
        loading,
        error,
        notFound,
    }: {
        level: Level;
        results: (SeriesRow | TestRow | ProblemRow)[];
        loading: boolean;
        error: string | null;
        notFound: number[];
    } = $props();
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
            <div
                class="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-container-low p-3"
            >
                <span class="flex items-center gap-2 font-medium">
                    {s.name}
                    {#if s.is_official}{@render badge("official")}{/if}
                </span>
                {@render badge(`id ${s.id}`)}
            </div>
        {/each}
    {:else if level === "tests"}
        {#each results as row (row.id)}
            {@const t = row as TestRow}
            <div
                class="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-container-low p-3"
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
                {@render badge(`id ${t.id}`)}
            </div>
        {/each}
    {:else}
        {#each results as row (row.id)}
            {@const p = row as ProblemRow}
            <Problem problem={p} solution="collapsed" isInstantFeedback={true} />
        {/each}
    {/if}

    {#if notFound.length > 0}
        <p class="text-sm text-muted-foreground">
            Not found: {notFound.join(", ")}
        </p>
    {/if}
</div>
