<script lang="ts">
    import type { SupabaseClient } from "@supabase/supabase-js";
    import type { Database } from "$lib/types/database.types";
    import { Combobox } from "$lib/components/combobox";
    import { Icon } from "$lib/components/icon";
    import { RangeSlider } from "$lib/components/range-slider";
    import { TOPICS } from "$lib/library";
    import {
        dimensionOptions,
        fetchSeriesDimensions,
        fetchSeriesNumberLine,
        type SeriesDimensionRow,
    } from "$lib/series-review";
    import { cn } from "$lib/utils";
    import { fly } from "svelte/transition";
    import { SvelteMap } from "svelte/reactivity";
    import {
        clampProblemNumbers,
        configsForSelectedSeries,
        problemNumberRange,
        type SeriesScopeConfig,
        type TrackValue,
    } from "./practice-settings";

    type Supabase = SupabaseClient<Database>;
    type NumberLineScope = { divisions: string[]; formats: string[] };

    let {
        value = $bindable<TrackValue>(),
        seriesOptions = [],
        supabase,
        loadSeriesDimensions,
        loadSeriesNumberLine,
    }: {
        value: TrackValue;
        seriesOptions: { value: string; label: string }[];
        supabase?: Supabase;
        loadSeriesDimensions?: (seriesId: number) => Promise<SeriesDimensionRow[]>;
        loadSeriesNumberLine?: (
            seriesId: number,
            scope?: NumberLineScope,
        ) => Promise<number>;
    } = $props();

    // Per-series scope rows expand/collapse independently. A row defaults to open
    // when it's the only one or already carries a selection; `expandedScopes`
    // holds explicit user overrides thereafter.
    let expandedScopes = $state<Record<string, boolean>>({});

    // One metadata row per selected series — division/format when that series
    // has a vocabulary, plus a problem-number slider once its number line is
    // known. Fetched dimensions are cached across selection changes. The
    // loaded list lags the combobox (async), so the template reads a derived
    // slice keyed on the live selection — otherwise a just-removed series
    // still binds into `seriesScopes[id]` after that entry is deleted.
    let loadedScopeConfigs = $state<SeriesScopeConfig[]>([]);
    const seriesScopeConfigs = $derived(
        configsForSelectedSeries(loadedScopeConfigs, value.seriesIds),
    );
    let dimensionToken = 0;
    const dimensionCache = new SvelteMap<number, SeriesDimensionRow[]>();

    // Keep `value.seriesScopes` in step with the *full* selection: drop entries
    // for deselected series and seed an empty entry for every selected one so
    // unclassified series (AMC 10) can still store a problem-number range.
    $effect(() => {
        const ids = value.seriesIds;
        const scopes = value.seriesScopes;
        const keep = new Set(ids);
        for (const key of Object.keys(scopes)) {
            if (!keep.has(key)) delete scopes[key];
        }
        for (const id of ids) {
            scopes[id] ??= { divisions: [], formats: [] };
        }
    });

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
                        if (loadSeriesDimensions) {
                            rows = await loadSeriesDimensions(id);
                        } else if (supabase) {
                            rows = await fetchSeriesDimensions(supabase, id);
                        } else {
                            rows = [];
                        }
                    } catch (e) {
                        console.error("Failed to fetch series dimensions:", e);
                        rows = [];
                    }
                    dimensionCache.set(id, rows);
                }
                configs.push({
                    id: idStr,
                    name:
                        names.find((o) => o.value === idStr)?.label ??
                        `Series ${idStr}`,
                    divisionOptions: dimensionOptions(rows, "division"),
                    formatOptions: dimensionOptions(rows, "format"),
                });
            }
            if (token !== dimensionToken) return;
            loadedScopeConfigs = configs;
        })();
    });

    function scopeOpen(cfg: SeriesScopeConfig): boolean {
        const scope = value.seriesScopes[cfg.id];
        const hasSelection =
            (scope?.divisions.length ?? 0) > 0 ||
            (scope?.formats.length ?? 0) > 0 ||
            scope?.problemNumbers != null;
        return (
            expandedScopes[cfg.id] ??
            (seriesScopeConfigs.length === 1 || hasSelection)
        );
    }

    function scopeSummary(cfg: SeriesScopeConfig): string {
        const scope = value.seriesScopes[cfg.id];
        const parts = [...(scope?.divisions ?? []), ...(scope?.formats ?? [])];
        const numbers = problemNumberRange(scope);
        if (numbers) {
            parts.push(
                numbers[0] === numbers[1]
                    ? `#${numbers[0]}`
                    : `#${numbers[0]}–${numbers[1]}`,
            );
        }
        return parts.length ? parts.join(" · ") : "All";
    }

    let numberLineLengths = $state<Record<string, number>>({});
    let numberLineToken = 0;
    const numberLineCache = new SvelteMap<string, number>();

    function numberLineCacheKey(
        id: string,
        divisions: string[],
        formats: string[],
    ): string {
        return `${id}|${[...divisions].sort().join(",")}|${[...formats].sort().join(",")}`;
    }

    $effect(() => {
        const ids = [...value.seriesIds];
        const scopes = ids.map((id) => {
            const scope = value.seriesScopes[id];
            return {
                id,
                divisions: [...(scope?.divisions ?? [])],
                formats: [...(scope?.formats ?? [])],
            };
        });
        const token = ++numberLineToken;

        void (async () => {
            const lengths: Record<string, number> = {};
            for (const scope of scopes) {
                const id = Number(scope.id);
                if (!Number.isFinite(id)) continue;
                const key = numberLineCacheKey(
                    scope.id,
                    scope.divisions,
                    scope.formats,
                );
                let length = numberLineCache.get(key);
                if (length == null) {
                    try {
                        if (loadSeriesNumberLine) {
                            length = await loadSeriesNumberLine(id, {
                                divisions: scope.divisions,
                                formats: scope.formats,
                            });
                        } else if (supabase) {
                            length = await fetchSeriesNumberLine(supabase, id, {
                                divisions: scope.divisions,
                                formats: scope.formats,
                            });
                        } else {
                            length = 0;
                        }
                    } catch (e) {
                        console.error("Failed to fetch series number line:", e);
                        continue;
                    }
                    numberLineCache.set(key, length);
                }
                lengths[scope.id] = length;
            }
            if (token !== numberLineToken) return;
            for (const [id, length] of Object.entries(lengths)) {
                if (length < 1) continue;
                const scope = value.seriesScopes[id];
                if (!scope) continue;
                const next = clampProblemNumbers(
                    scope.problemNumbers,
                    length,
                );
                const current = scope.problemNumbers;
                const same =
                    (next === undefined && current === undefined) ||
                    (next != null &&
                        current != null &&
                        next[0] === current[0] &&
                        next[1] === current[1]);
                if (same) continue;
                if (next) scope.problemNumbers = next;
                else delete scope.problemNumbers;
            }
            numberLineLengths = lengths;
        })();
    });

    function seriesLength(id: string): number {
        return numberLineLengths[id] ?? 0;
    }

    function seriesHasMeta(cfg: SeriesScopeConfig): boolean {
        return (
            cfg.divisionOptions.length > 0 ||
            cfg.formatOptions.length > 0 ||
            seriesLength(cfg.id) >= 1
        );
    }

    function seriesRange(id: string, length: number): [number, number] {
        const stored = problemNumberRange(value.seriesScopes[id], length);
        return stored ?? [1, length];
    }

    function setSeriesRange(id: string, length: number, next: [number, number]) {
        const stored = clampProblemNumbers(next, length);
        const scope = value.seriesScopes[id];
        if (!scope) return;
        if (stored) scope.problemNumbers = stored;
        else delete scope.problemNumbers;
    }

    const EMPTY_SCOPE_LIST: string[] = [];

    function scopeField(
        id: string,
        key: "divisions" | "formats",
    ): string[] {
        return value.seriesScopes[id]?.[key] ?? EMPTY_SCOPE_LIST;
    }

    function setScopeField(
        id: string,
        key: "divisions" | "formats",
        next: string[],
    ) {
        const scope = value.seriesScopes[id];
        if (!scope) return;
        scope[key] = next;
    }

    function rangeCaption(id: string, length: number): string {
        const [lo, hi] = seriesRange(id, length);
        return lo === hi ? `Problem ${lo}` : `Problems ${lo}–${hi}`;
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
    {#if seriesScopeConfigs.some(seriesHasMeta)}
        <div class="flex flex-col gap-1.5">
            {#each seriesScopeConfigs as cfg (cfg.id)}
                {#if seriesHasMeta(cfg) && value.seriesScopes[cfg.id]}
                    {@const open = scopeOpen(cfg)}
                    {@const length = seriesLength(cfg.id)}
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
                            <span
                                class="min-w-0 flex-1 truncate text-xs font-medium"
                            >
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
                                                () =>
                                                    scopeField(
                                                        cfg.id,
                                                        "divisions",
                                                    ),
                                                (next) =>
                                                    setScopeField(
                                                        cfg.id,
                                                        "divisions",
                                                        next,
                                                    )
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
                                                () =>
                                                    scopeField(
                                                        cfg.id,
                                                        "formats",
                                                    ),
                                                (next) =>
                                                    setScopeField(
                                                        cfg.id,
                                                        "formats",
                                                        next,
                                                    )
                                            }
                                            options={cfg.formatOptions}
                                            strict
                                            placeholder="All formats"
                                            inputPlaceholder="Add format"
                                        />
                                    </div>
                                {/if}
                                {#if length >= 1}
                                    <div class="flex flex-col gap-1.5">
                                        <span
                                            class="text-xxs font-medium uppercase tracking-wide text-muted-foreground"
                                        >
                                            Problem numbers
                                        </span>
                                        <RangeSlider
                                            bind:value={
                                                () => seriesRange(cfg.id, length),
                                                (next) =>
                                                    setSeriesRange(
                                                        cfg.id,
                                                        length,
                                                        next,
                                                    )
                                            }
                                            min={1}
                                            max={length}
                                            step={1}
                                            minGap={0}
                                            label="Problem numbers"
                                        />
                                        <span
                                            class="text-xs text-muted-foreground"
                                        >
                                            {rangeCaption(cfg.id, length)}
                                        </span>
                                    </div>
                                {/if}
                            </div>
                        {/if}
                    </div>
                {/if}
            {/each}
        </div>
    {/if}
</div>
