<script lang="ts">
    import type { SupabaseClient } from "@supabase/supabase-js";
    import type { Database } from "$lib/types/database.types";
    import { Combobox } from "$lib/components/combobox";
    import { Icon } from "$lib/components/icon";
    import { TOPICS } from "$lib/library";
    import {
        dimensionOptions,
        fetchSeriesDimensions,
        type SeriesDimensionRow,
    } from "$lib/series-review";
    import { cn } from "$lib/utils";
    import { fly } from "svelte/transition";
    import type { SeriesScopeConfig, TrackValue } from "./practice-settings";

    type Supabase = SupabaseClient<Database>;

    let {
        value = $bindable<TrackValue>(),
        seriesOptions = [],
        supabase,
    }: {
        value: TrackValue;
        seriesOptions: { value: string; label: string }[];
        supabase: Supabase;
    } = $props();

    // Per-series scope rows expand/collapse independently. A row defaults to open
    // when it's the only one or already carries a selection; `expandedScopes`
    // holds explicit user overrides thereafter.
    let expandedScopes = $state<Record<string, boolean>>({});

    // Division/format is a per-series narrowing (each series has its own
    // vocabulary), so for every selected series we fetch its dimensions and
    // build a scope row — but only for classified series (those with actual
    // division or format values). Fetched dimensions are cached across
    // selection changes.
    let seriesScopeConfigs = $state<SeriesScopeConfig[]>([]);
    let dimensionToken = 0;
    const dimensionCache = new Map<number, SeriesDimensionRow[]>();

    // Keep `value.seriesScopes` in step with the classified selection: drop
    // entries for deselected series (so stale tags never leak into the draw or
    // the persisted snapshot) and seed an empty entry for each classified one
    // so the comboboxes below have a bindable target.
    function reconcileScopes(classifiedIds: string[]) {
        const scopes = value.seriesScopes;
        const keep = new Set(classifiedIds);
        for (const key of Object.keys(scopes)) {
            if (!keep.has(key)) delete scopes[key];
        }
        for (const id of classifiedIds) {
            scopes[id] ??= { divisions: [], formats: [] };
        }
    }

    $effect(() => {
        const ids = [...value.seriesIds];
        const names = seriesOptions;
        const token = ++dimensionToken;

        void (async () => {
            const configs: SeriesScopeConfig[] = [];
            for (const idStr of ids) {
                const id = Number(idStr);
                if (!Number.isFinite(id)) continue;
                let rows = dimensionCache.get(id);
                if (!rows) {
                    try {
                        rows = await fetchSeriesDimensions(supabase, id);
                    } catch (e) {
                        console.error("Failed to fetch series dimensions:", e);
                        continue;
                    }
                    dimensionCache.set(id, rows);
                }
                const divisions = dimensionOptions(rows, "division");
                const formats = dimensionOptions(rows, "format");
                if (divisions.length === 0 && formats.length === 0) continue;
                configs.push({
                    id: idStr,
                    name:
                        names.find((o) => o.value === idStr)?.label ??
                        `Series ${idStr}`,
                    divisionOptions: divisions,
                    formatOptions: formats,
                });
            }
            if (token !== dimensionToken) return;
            reconcileScopes(configs.map((c) => c.id));
            seriesScopeConfigs = configs;
        })();
    });

    function scopeOpen(cfg: SeriesScopeConfig): boolean {
        const scope = value.seriesScopes[cfg.id];
        const hasSelection =
            (scope?.divisions.length ?? 0) > 0 ||
            (scope?.formats.length ?? 0) > 0;
        return (
            expandedScopes[cfg.id] ??
            (seriesScopeConfigs.length === 1 || hasSelection)
        );
    }

    function scopeSummary(cfg: SeriesScopeConfig): string {
        const scope = value.seriesScopes[cfg.id];
        const parts = [...(scope?.divisions ?? []), ...(scope?.formats ?? [])];
        return parts.length ? parts.join(" · ") : "All";
    }
</script>

<div class="flex flex-col gap-2 border-b border-border/30 pb-4">
    <span class="text-xs font-medium text-muted-foreground">Topic</span>
    <Combobox
        bind:value={value.topic}
        options={TOPICS}
        strict
        placeholder="Any topic"
        inputPlaceholder="Add topic"
    />
</div>

<div class="flex flex-col gap-2 border-b border-border/30 pb-4">
    <span class="text-xs font-medium text-muted-foreground">Series</span>
    <Combobox
        bind:value={value.seriesIds}
        options={seriesOptions}
        strict
        placeholder="All series"
        inputPlaceholder="Add series"
    />
</div>

<!-- Division / Format: one collapsible row per selected classified series,
     each narrowing that series by its own vocabulary. -->
{#if seriesScopeConfigs.length > 0}
    <div class="flex flex-col gap-2 border-b border-border/30 pb-4">
        <span class="text-xs font-medium text-muted-foreground">
            Division &amp; format
        </span>
        <div class="flex flex-col gap-1.5">
            {#each seriesScopeConfigs as cfg (cfg.id)}
                {@const open = scopeOpen(cfg)}
                <div
                    class="rounded-lg border border-border/50 bg-surface-container-low/40"
                >
                    <button
                        type="button"
                        class="flex w-full items-center gap-2 px-2.5 py-2 text-left"
                        aria-expanded={open}
                        onclick={() => (expandedScopes[cfg.id] = !open)}
                    >
                        <Icon
                            name="keyboard_arrow_down"
                            class={cn(
                                "size-[1em] shrink-0 text-muted-foreground transition-transform",
                                !open && "-rotate-90",
                            )}
                        />
                        <span class="min-w-0 flex-1 truncate text-xs font-medium">
                            {cfg.name}
                        </span>
                        <span
                            class="max-w-[45%] shrink-0 truncate text-xxs text-muted-foreground"
                        >
                            {scopeSummary(cfg)}
                        </span>
                    </button>
                    {#if open}
                        <div
                            class="flex flex-col gap-3 px-2.5 pt-0.5 pb-3"
                            transition:fly={{ y: -4, duration: 120 }}
                        >
                            {#if cfg.divisionOptions.length > 0}
                                <div class="flex flex-col gap-1.5">
                                    <span
                                        class="text-xxs font-medium uppercase tracking-wide text-muted-foreground"
                                    >
                                        Division
                                    </span>
                                    <Combobox
                                        bind:value={
                                            value.seriesScopes[cfg.id]
                                                .divisions
                                        }
                                        options={cfg.divisionOptions}
                                        strict
                                        placeholder="All divisions"
                                        inputPlaceholder="Add division"
                                    />
                                </div>
                            {/if}
                            {#if cfg.formatOptions.length > 0}
                                <div class="flex flex-col gap-1.5">
                                    <span
                                        class="text-xxs font-medium uppercase tracking-wide text-muted-foreground"
                                    >
                                        Format
                                    </span>
                                    <Combobox
                                        bind:value={
                                            value.seriesScopes[cfg.id].formats
                                        }
                                        options={cfg.formatOptions}
                                        strict
                                        placeholder="All formats"
                                        inputPlaceholder="Add format"
                                    />
                                </div>
                            {/if}
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    </div>
{/if}
