<script lang="ts">
    import type { SupabaseClient } from "@supabase/supabase-js";
    import type { Database } from "$lib/types/database.types";
    import { Combobox } from "$lib/components/combobox";
    import { RangeSlider } from "$lib/components/range-slider";
    import {
        clampProblemNumbers,
        dimensionOptions,
        fetchSeriesDimensions,
        fetchSeriesNumberLine,
        problemNumberRange,
        type DimensionOption,
        type SeriesDimensionRow,
    } from "$lib/series-review";
    import { untrack } from "svelte";

    type Supabase = SupabaseClient<Database>;

    let {
        seriesId,
        testId,
        supabase,
        divisions = $bindable<string[]>([]),
        formats = $bindable<string[]>([]),
        problemNumbers = $bindable<[number, number] | undefined>(undefined),
        showDivisionFormat = true,
        showProblemNumbers = true,
        loadSeriesDimensions,
        loadSeriesNumberLine,
    }: {
        seriesId: number;
        testId?: number;
        supabase?: Supabase;
        divisions: string[];
        formats: string[];
        problemNumbers: [number, number] | undefined;
        showDivisionFormat?: boolean;
        showProblemNumbers?: boolean;
        loadSeriesDimensions?: (
            seriesId: number,
        ) => Promise<SeriesDimensionRow[]>;
        loadSeriesNumberLine?: (
            seriesId: number,
            scope?: {
                divisions: string[];
                formats: string[];
                testId?: number;
            },
        ) => Promise<number>;
    } = $props();

    let divisionOptions = $state<DimensionOption[]>([]);
    let formatOptions = $state<DimensionOption[]>([]);
    let numberLineLength = $state(0);
    let dimensionToken = 0;
    let numberLineToken = 0;

    $effect(() => {
        const id = seriesId;
        const token = ++dimensionToken;
        if (!showDivisionFormat) {
            divisionOptions = [];
            formatOptions = [];
            return;
        }
        void (async () => {
            let rows: SeriesDimensionRow[] = [];
            try {
                if (loadSeriesDimensions) {
                    rows = await loadSeriesDimensions(id);
                } else if (supabase) {
                    rows = await fetchSeriesDimensions(supabase, id);
                }
            } catch (e) {
                console.error("Failed to fetch series dimensions:", e);
            }
            if (token !== dimensionToken) return;
            divisionOptions = dimensionOptions(rows, "division");
            formatOptions = dimensionOptions(rows, "format");
        })();
    });

    $effect(() => {
        if (!showProblemNumbers) {
            numberLineLength = 0;
            return;
        }
        const id = seriesId;
        const lockedTest = testId;
        const selectedDivisions = [...divisions];
        const selectedFormats = [...formats];
        const token = ++numberLineToken;
        void (async () => {
            let length = 0;
            try {
                const scope = {
                    divisions: selectedDivisions,
                    formats: selectedFormats,
                    ...(lockedTest != null ? { testId: lockedTest } : {}),
                };
                if (loadSeriesNumberLine) {
                    length = await loadSeriesNumberLine(id, scope);
                } else if (supabase) {
                    length = await fetchSeriesNumberLine(supabase, id, scope);
                }
            } catch (e) {
                console.error("Failed to fetch series number line:", e);
                return;
            }
            if (token !== numberLineToken) return;
            const current = untrack(() => problemNumbers);
            const next = clampProblemNumbers(current, length);
            const same =
                (next === undefined && current === undefined) ||
                (next != null &&
                    current != null &&
                    next[0] === current[0] &&
                    next[1] === current[1]);
            if (!same) problemNumbers = next;
            numberLineLength = length;
        })();
    });

    function seriesRange(length: number): [number, number] {
        return problemNumberRange({ problemNumbers }, length) ?? [1, length];
    }

    function rangeCaption(length: number): string {
        const [lo, hi] = seriesRange(length);
        return lo === hi ? `Problem ${lo}` : `Problems ${lo}–${hi}`;
    }
</script>

{#snippet field(label: string)}
    <span class="type-caption text-muted-foreground">{label}</span>
{/snippet}

{#if (showDivisionFormat && (divisionOptions.length > 0 || formatOptions.length > 0)) || (showProblemNumbers && numberLineLength >= 1)}
    <div class="flex flex-col gap-4">
        {#if showDivisionFormat && divisionOptions.length > 0}
            <div class="flex flex-col gap-1.5">
                {@render field("Division")}
                <Combobox
                    bind:value={divisions}
                    options={divisionOptions}
                    strict
                    placeholder="Any division…"
                    inputPlaceholder="Add division…"
                />
            </div>
        {/if}
        {#if showDivisionFormat && formatOptions.length > 0}
            <div class="flex flex-col gap-1.5">
                {@render field("Format")}
                <Combobox
                    bind:value={formats}
                    options={formatOptions}
                    strict
                    placeholder="Any format…"
                    inputPlaceholder="Add format…"
                />
            </div>
        {/if}
        {#if showProblemNumbers && numberLineLength >= 1}
            <div class="flex flex-col gap-1.5">
                {@render field(rangeCaption(numberLineLength))}
                <RangeSlider
                    bind:value={
                        () => seriesRange(numberLineLength),
                        (next) =>
                            (problemNumbers = clampProblemNumbers(
                                next,
                                numberLineLength,
                            ))
                    }
                    min={1}
                    max={numberLineLength}
                    step={1}
                    minGap={0}
                    label="Problem numbers"
                />
            </div>
        {/if}
    </div>
{/if}
