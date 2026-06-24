<script lang="ts">
    import { Input } from "$lib/components/input";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Combobox, type Option } from "$lib/components/combobox";
    import { RangeSlider } from "$lib/components/range-slider";
    import { TriStateSwitch, type TriState } from "$lib/components/toggle";
    import {
        boolToTri,
        triToBool,
        TOPICS,
        YEAR_RANGE,
        DIFFICULTY_RANGE,
        QUALITY_RANGE,
        type Filters,
    } from "$lib/library";
    import type { LibraryStore } from "$lib/state/library.svelte";
    import { untrack } from "svelte";

    let {
        store,
        seriesOptions,
    }: { store: LibraryStore; seriesOptions: Option[] } = $props();

    // Captured once at mount. The parent wraps this component in `{#key store.cursor}`,
    // so it remounts (re-seeding all locals) whenever the active frame changes.
    const frame = untrack(() => store.current);
    const level = frame.level;
    const f = frame.filters;

    // Locals seeded from the frame's filters; an effect below pushes them back.
    let name = $state(f.name ?? "");
    let isOfficial = $state<TriState>(boolToTri(f.isOfficial));
    let seriesSel = $state<string[]>(
        f.seriesId != null ? [String(f.seriesId)] : [],
    );
    let year = $state<[number, number]>(f.year ?? [...YEAR_RANGE]);
    let type = $state<string[]>(f.type ?? []);
    let isComputational = $state<TriState>(boolToTri(f.isComputational));
    let topic = $state<string[]>(f.topic ?? []);
    let tags = $state<string[]>(f.tags ?? []);
    let difficulty = $state<[number, number]>(f.difficulty ?? [
        ...DIFFICULTY_RANGE,
    ]);
    let quality = $state<[number, number]>(f.quality ?? [...QUALITY_RANGE]);
    let verified = $state<TriState>(boolToTri(f.verified));

    // Parents locked in by drilling — shown as removable scope chips. Reactive so
    // clearing one re-runs the patch effect (dropping its id) and reveals the series
    // combobox when series scope is removed.
    let lockedSeries = $state(frame.context.series);
    let lockedTest = $state(frame.context.test);

    /** "×" on the test chip — broaden to the series scope. */
    function removeTestScope() {
        lockedTest = undefined;
        store.clearScope("test");
    }

    /** "×" on the series chip — fully unscope (cascades to the test). */
    function removeSeriesScope() {
        lockedSeries = undefined;
        lockedTest = undefined;
        // A drilled frame seeds seriesSel from f.seriesId; clear it so the patch
        // effect doesn't re-apply the series via its `?? seriesSel[0]` fallback.
        seriesSel = [];
        store.clearScope("series");
    }

    /** Treat an untouched (full-range) slider as "no filter" so null-valued rows show. */
    function rangeOrUndef(
        v: [number, number],
        full: [number, number],
    ): [number, number] | undefined {
        return v[0] === full[0] && v[1] === full[1] ? undefined : v;
    }

    /** Human-readable current state of a tri-state filter (neutral = "Any"). */
    function triText(v: TriState, on: string, off: string): string {
        return v === "on" ? on : v === "off" ? off : "Any";
    }

    // Push local edits into the current frame. Reads only locals + locked context,
    // never `frame.filters`, so it doesn't loop with patchFilters.
    $effect(() => {
        let patch: Filters;
        if (level === "series") {
            patch = {
                name: name || undefined,
                isOfficial: triToBool(isOfficial),
            };
        } else if (level === "tests") {
            patch = {
                seriesId:
                    lockedSeries?.id ??
                    (seriesSel[0] ? Number(seriesSel[0]) : undefined),
                name: name || undefined,
                year: rangeOrUndef(year, YEAR_RANGE),
                type: type.length ? type : undefined,
                isComputational: triToBool(isComputational),
            };
        } else {
            patch = {
                seriesId:
                    lockedSeries?.id ??
                    (seriesSel[0] ? Number(seriesSel[0]) : undefined),
                testId: lockedTest?.id,
                topic: topic.length ? topic : undefined,
                tags: tags.length ? tags : undefined,
                difficulty: rangeOrUndef(difficulty, DIFFICULTY_RANGE),
                quality: rangeOrUndef(quality, QUALITY_RANGE),
                isComputational: triToBool(isComputational),
                verified: triToBool(verified),
            };
        }
        store.patchFilters(patch);
    });
</script>

{#snippet field(label: string)}
    <span class="text-xs font-medium text-muted-foreground">{label}</span>
{/snippet}

<div class="flex flex-col gap-4">
    {#if lockedSeries || lockedTest}
        <div class="flex flex-col gap-1.5">
            {@render field("Scope")}
            <div class="flex flex-wrap gap-1.5">
                {#if lockedSeries}
                    <span
                        class="inline-flex items-center gap-1 rounded-full bg-surface-container py-0.5 pr-1 pl-2.5 text-xs"
                    >
                        {lockedSeries.name}
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Remove ${lockedSeries.name} scope`}
                            onclick={removeSeriesScope}
                        >
                            <Icon fontsize={14}>close</Icon>
                        </Button>
                    </span>
                {/if}
                {#if lockedTest}
                    <span
                        class="inline-flex items-center gap-1 rounded-full bg-surface-container py-0.5 pr-1 pl-2.5 text-xs"
                    >
                        {lockedTest.name}
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Remove ${lockedTest.name} scope`}
                            onclick={removeTestScope}
                        >
                            <Icon fontsize={14}>close</Icon>
                        </Button>
                    </span>
                {/if}
            </div>
        </div>
    {/if}

    {#if level === "series"}
        <label class="flex flex-col gap-1.5">
            {@render field("Name")}
            <Input bind:value={name} placeholder="Search series…" />
        </label>
        <div class="flex items-center justify-between gap-2">
            {@render field("Official")}
            <div class="flex items-center gap-2">
                <span class="text-xs text-muted-foreground"
                    >{triText(isOfficial, "Official", "Not official")}</span
                >
                <TriStateSwitch bind:value={isOfficial} size="sm" />
            </div>
        </div>
    {:else if level === "tests"}
        {#if !lockedSeries}
            <div class="flex flex-col gap-1.5">
                {@render field("Series")}
                <Combobox
                    options={seriesOptions}
                    strict
                    max={1}
                    bind:value={seriesSel}
                    placeholder="Any series…"
                />
            </div>
        {/if}
        <label class="flex flex-col gap-1.5">
            {@render field("Name")}
            <Input bind:value={name} placeholder="Search tests…" />
        </label>
        <div class="flex flex-col gap-1.5">
            {@render field(`Year (${year[0]}–${year[1]})`)}
            <RangeSlider
                bind:value={year}
                min={YEAR_RANGE[0]}
                max={YEAR_RANGE[1]}
                step={1}
                label="Year"
            />
        </div>
        <div class="flex flex-col gap-1.5">
            {@render field("Type")}
            <Combobox
                bind:value={type}
                placeholder="Any type…"
                inputPlaceholder="Add type…"
            />
        </div>
        <div class="flex items-center justify-between gap-2">
            {@render field("Computational")}
            <div class="flex items-center gap-2">
                <span class="text-xs text-muted-foreground"
                    >{triText(
                        isComputational,
                        "Computational",
                        "Not computational",
                    )}</span
                >
                <TriStateSwitch bind:value={isComputational} size="sm" />
            </div>
        </div>
    {:else}
        {#if !lockedSeries}
            <div class="flex flex-col gap-1.5">
                {@render field("Series")}
                <Combobox
                    options={seriesOptions}
                    strict
                    max={1}
                    bind:value={seriesSel}
                    placeholder="Any series…"
                />
            </div>
        {/if}
        <div class="flex flex-col gap-1.5">
            {@render field("Topic")}
            <Combobox
                options={TOPICS}
                strict
                bind:value={topic}
                placeholder="Any topic…"
                inputPlaceholder="Add topic…"
            />
        </div>
        <div class="flex flex-col gap-1.5">
            {@render field("Tags")}
            <Combobox
                bind:value={tags}
                placeholder="Any tags…"
                inputPlaceholder="Add tag…"
            />
        </div>
        <div class="flex flex-col gap-1.5">
            {@render field(`Difficulty (${difficulty[0]}–${difficulty[1]})`)}
            <RangeSlider
                bind:value={difficulty}
                min={DIFFICULTY_RANGE[0]}
                max={DIFFICULTY_RANGE[1]}
                step={1}
                label="Difficulty"
            />
        </div>
        <div class="flex flex-col gap-1.5">
            {@render field(`Quality (${quality[0]}–${quality[1]})`)}
            <RangeSlider
                bind:value={quality}
                min={QUALITY_RANGE[0]}
                max={QUALITY_RANGE[1]}
                step={1}
                label="Quality"
            />
        </div>
        <div class="flex items-center justify-between gap-2">
            {@render field("Computational")}
            <div class="flex items-center gap-2">
                <span class="text-xs text-muted-foreground"
                    >{triText(
                        isComputational,
                        "Computational",
                        "Not computational",
                    )}</span
                >
                <TriStateSwitch bind:value={isComputational} size="sm" />
            </div>
        </div>
        <div class="flex items-center justify-between gap-2">
            {@render field("Verified")}
            <div class="flex items-center gap-2">
                <span class="text-xs text-muted-foreground"
                    >{triText(verified, "Verified", "Not verified")}</span
                >
                <TriStateSwitch bind:value={verified} size="sm" />
            </div>
        </div>
    {/if}
</div>
