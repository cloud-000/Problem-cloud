<script lang="ts">
    import type { SupabaseClient } from "@supabase/supabase-js";
    import type { Database } from "#lib/types/database.types.js";
    import { Combobox, type Option } from "#lib/components/combobox/index.js";
    import { RangeSlider } from "#lib/components/range-slider/index.js";
    import { TriStateSwitch, type TriState } from "#lib/components/toggle/index.js";
    import {
        boolToTri,
        triToBool,
        TOPICS,
        YEAR_RANGE,
        DIFFICULTY_RANGE,
        QUALITY_RANGE,
        type Filters,
    } from "#lib/library.js";
    import type { LibraryView, LibraryAction } from "#lib/library/view.js";
    import type { Engagement, Mastery } from "#lib/progress.js";
    import SeriesScopeFields from "./SeriesScopeFields.svelte";

    type Supabase = SupabaseClient<Database>;

    let { view, onaction, seriesOptions, supabase, testSeriesId }: {
        view: LibraryView;
        onaction: (action: LibraryAction) => void;
        seriesOptions: Option[];
        supabase: Supabase;
        testSeriesId?: number;
    } = $props();

    const level = $derived(view.tab);
    const f: Filters = $derived(view.filters);
    const selectedSeriesId = $derived(f.seriesId ?? testSeriesId);
    const lockedTest = $derived(f.testId);
    const isOfficial = $derived(boolToTri(f.isOfficial));
    const isComputational = $derived(boolToTri(f.isComputational));
    const verified = $derived(boolToTri(f.verified));
    const year = $derived(f.year ?? YEAR_RANGE);
    const difficulty = $derived(f.difficulty ?? DIFFICULTY_RANGE);
    const quality = $derived(f.quality ?? QUALITY_RANGE);

    function patch(filters: Filters) {
        onaction({ type: "patch", filters });
    }

    const masteryOptions = [
        { value: "unassessed", label: "Unassessed" },
        { value: "needs_work", label: "Needs work" },
        { value: "learning", label: "Learning" },
        { value: "confident", label: "Confident" },
    ];
    const engagementOptions = [
        { value: "none", label: "No plan" },
        { value: "working", label: "Working on" },
        { value: "revisit", label: "Revisit" },
        { value: "later", label: "Later" },
        { value: "ignored", label: "Ignored" },
    ];

    /** Human-readable current state of a tri-state filter (neutral = "Any"). */
    function triText(v: TriState, on: string, off: string): string {
        return v === "on" ? on : v === "off" ? off : "Any";
    }

</script>

{#snippet field(label: string)}
    <span class="type-caption text-muted-foreground">{label}</span>
{/snippet}

{#snippet seriesScope()}
    {#if selectedSeriesId != null}
        {#key selectedSeriesId}
            <SeriesScopeFields
                seriesId={selectedSeriesId}
                testId={lockedTest}
                {supabase}
                bind:divisions={() => f.divisions ?? [], (value) => patch({ divisions: value })}
                bind:formats={() => f.formats ?? [], (value) => patch({ formats: value })}
                bind:problemNumbers={() => f.problemNumbers, (value) => patch({ problemNumbers: value })}
                bind:yearRange={() => f.year, (value) => patch({ year: value })}
                clampOnLoad={false}
                showDivisionFormat={!lockedTest}
                showProblemNumbers={level === "problems"}
                showYear={!lockedTest}
            />
        {/key}
    {/if}
{/snippet}

<div class="flex flex-col gap-6">
    {#if level === "series"}
        <div class="flex items-center justify-between gap-4">
            {@render field("Official")}
            <div class="flex items-center gap-2">
                <span class="type-caption text-muted-foreground"
                    >{triText(isOfficial, "Official", "Not official")}</span
                >
                <TriStateSwitch bind:value={() => isOfficial, (value) => patch({ isOfficial: triToBool(value) })} size="sm" />
            </div>
        </div>
    {:else if level === "tests"}
        <section class="flex flex-col gap-4" aria-labelledby="test-browse-filters">
            <h3 id="test-browse-filters" class="type-secondary font-semibold text-foreground">
                Browse
            </h3>
            {#if !lockedTest}
                <div class="flex flex-col gap-1.5">
                    {@render field("Series")}
                    <Combobox
                        options={seriesOptions}
                        strict
                        max={1}
                        bind:value={() => selectedSeriesId != null ? [String(selectedSeriesId)] : [], (value) => patch({ seriesId: value[0] ? Number(value[0]) : undefined })}
                        placeholder="Any series…"
                    />
                </div>
            {/if}
            {@render seriesScope()}
            <div class="flex flex-col gap-1.5">
                {@render field("Type")}
                <Combobox
                    bind:value={() => f.type ?? [], (value) => patch({ type: value })}
                    placeholder="Any type…"
                    inputPlaceholder="Add type…"
                />
            </div>
        </section>

        {#if selectedSeriesId == null}
            <section class="flex flex-col gap-4 border-t border-border pt-5" aria-labelledby="test-date-filters">
                <h3 id="test-date-filters" class="type-secondary font-semibold text-foreground">
                    Date
                </h3>
                <div class="flex flex-col gap-1.5">
                    {@render field(`Year (${year[0]}–${year[1]})`)}
                    <RangeSlider
                        bind:value={() => year, (value) => patch({ year: value })}
                        min={Math.min(YEAR_RANGE[0], year[0])}
                        max={Math.max(YEAR_RANGE[1], year[1])}
                        step={1}
                        label="Year"
                    />
                </div>
            </section>
        {/if}

        <section class="flex flex-col gap-4 border-t border-border pt-5" aria-labelledby="test-attribute-filters">
            <h3 id="test-attribute-filters" class="type-secondary font-semibold text-foreground">
                Attributes
            </h3>
            <div class="flex items-center justify-between gap-4">
                {@render field("Computational")}
                <div class="flex items-center gap-2">
                    <span class="type-caption text-muted-foreground"
                        >{triText(
                            isComputational,
                            "Computational",
                            "Not computational",
                        )}</span
                    >
                    <TriStateSwitch bind:value={() => isComputational, (value) => patch({ isComputational: triToBool(value) })} size="sm" />
                </div>
            </div>
        </section>
    {:else}
        <section class="flex flex-col gap-4" aria-labelledby="problem-browse-filters">
            <h3 id="problem-browse-filters" class="type-secondary font-semibold text-foreground">
                Browse
            </h3>
            {#if !lockedTest}
                <div class="flex flex-col gap-1.5">
                    {@render field("Series")}
                    <Combobox
                        options={seriesOptions}
                        strict
                        max={1}
                        bind:value={() => selectedSeriesId != null ? [String(selectedSeriesId)] : [], (value) => patch({ seriesId: value[0] ? Number(value[0]) : undefined })}
                        placeholder="Any series…"
                    />
                </div>
            {/if}
            {@render seriesScope()}
            <div class="flex flex-col gap-1.5">
                {@render field("Topic")}
                <Combobox
                    options={TOPICS}
                    strict
                    bind:value={() => f.topic ?? [], (value) => patch({ topic: value })}
                    placeholder="Any topic…"
                    inputPlaceholder="Add topic…"
                />
            </div>
            <div class="flex flex-col gap-1.5">
                {@render field("Tags")}
                <Combobox
                    bind:value={() => f.tags ?? [], (value) => patch({ tags: value })}
                    placeholder="Any tags…"
                    inputPlaceholder="Add tag…"
                />
            </div>
        </section>

        <section class="flex flex-col gap-4 border-t border-border pt-5" aria-labelledby="problem-progress-filters">
            <h3 id="problem-progress-filters" class="type-secondary font-semibold text-foreground">
                Progress
            </h3>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div class="flex flex-col gap-1.5">
                    {@render field("Mastery")}
                    <Combobox
                        bind:value={() => f.mastery ?? [], (value) => patch({ mastery: value as (Mastery | "unassessed")[] })}
                        options={masteryOptions}
                        strict
                        placeholder="Any mastery…"
                    />
                </div>
                <div class="flex flex-col gap-1.5">
                    {@render field("Plan")}
                    <Combobox
                        bind:value={() => f.engagement ?? [], (value) => patch({ engagement: value as (Engagement | "none")[] })}
                        options={engagementOptions}
                        strict
                        placeholder="Any plan…"
                    />
                </div>
            </div>
        </section>

        <section class="flex flex-col gap-5 border-t border-border pt-5" aria-labelledby="problem-difficulty-filters">
            <h3 id="problem-difficulty-filters" class="type-secondary font-semibold text-foreground">
                Difficulty
            </h3>
            <div class="flex flex-col gap-1.5">
                {@render field(`Problem rating (${difficulty[0]}–${difficulty[1]})`)}
                <RangeSlider
                    bind:value={() => difficulty, (value) => patch({ difficulty: value })}
                    min={DIFFICULTY_RANGE[0]}
                    max={DIFFICULTY_RANGE[1]}
                    step={50}
                    label="Difficulty (problem rating)"
                />
            </div>
            <div class="flex flex-col gap-1.5">
                {@render field(`Quality (${quality[0]}–${quality[1]})`)}
                <RangeSlider
                    bind:value={() => quality, (value) => patch({ quality: value })}
                    min={QUALITY_RANGE[0]}
                    max={QUALITY_RANGE[1]}
                    step={1}
                    label="Quality"
                />
            </div>
        </section>

        <section class="flex flex-col gap-4 border-t border-border pt-5" aria-labelledby="problem-attribute-filters">
            <h3 id="problem-attribute-filters" class="type-secondary font-semibold text-foreground">
                Attributes
            </h3>
            <div class="flex items-center justify-between gap-4">
                {@render field("Computational")}
                <div class="flex items-center gap-2">
                    <span class="type-caption text-muted-foreground"
                        >{triText(
                            isComputational,
                            "Computational",
                            "Not computational",
                        )}</span
                    >
                    <TriStateSwitch bind:value={() => isComputational, (value) => patch({ isComputational: triToBool(value) })} size="sm" />
                </div>
            </div>
            <div class="flex items-center justify-between gap-4">
                {@render field("Verified")}
                <div class="flex items-center gap-2">
                    <span class="type-caption text-muted-foreground"
                        >{triText(verified, "Verified", "Not verified")}</span
                    >
                    <TriStateSwitch bind:value={() => verified, (value) => patch({ verified: triToBool(value) })} size="sm" />
                </div>
            </div>
        </section>
    {/if}
</div>
