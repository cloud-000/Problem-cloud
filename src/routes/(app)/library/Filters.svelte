<script lang="ts">
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
    import type { Engagement, Mastery } from "$lib/progress";
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
    let mastery = $state<(Mastery | "unassessed")[]>([...(f.mastery ?? [])]);
    let engagement = $state<(Engagement | "none")[]>([...(f.engagement ?? [])]);

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

    const lockedSeries = frame.context.series;
    const lockedTest = frame.context.test;

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
                isOfficial: triToBool(isOfficial),
            };
        } else if (level === "tests") {
            patch = {
                seriesId:
                    lockedSeries?.id ??
                    (seriesSel[0] ? Number(seriesSel[0]) : undefined),
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
                mastery: mastery.length ? mastery : undefined,
                engagement: engagement.length ? engagement : undefined,
            };
        }
        store.patchFilters(patch);
    });
</script>

{#snippet field(label: string)}
    <span class="type-caption text-muted-foreground">{label}</span>
{/snippet}

<div class="flex flex-col gap-6">
    {#if level === "series"}
        <div class="flex items-center justify-between gap-4">
            {@render field("Official")}
            <div class="flex items-center gap-2">
                <span class="type-caption text-muted-foreground"
                    >{triText(isOfficial, "Official", "Not official")}</span
                >
                <TriStateSwitch bind:value={isOfficial} size="sm" />
            </div>
        </div>
    {:else if level === "tests"}
        <section class="flex flex-col gap-4" aria-labelledby="test-browse-filters">
            <h3 id="test-browse-filters" class="type-secondary font-semibold text-foreground">
                Browse
            </h3>
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
                {@render field("Type")}
                <Combobox
                    bind:value={type}
                    placeholder="Any type…"
                    inputPlaceholder="Add type…"
                />
            </div>
        </section>

        <section class="flex flex-col gap-4 border-t border-border pt-5" aria-labelledby="test-date-filters">
            <h3 id="test-date-filters" class="type-secondary font-semibold text-foreground">
                Date
            </h3>
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
        </section>

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
                    <TriStateSwitch bind:value={isComputational} size="sm" />
                </div>
            </div>
        </section>
    {:else}
        <section class="flex flex-col gap-4" aria-labelledby="problem-browse-filters">
            <h3 id="problem-browse-filters" class="type-secondary font-semibold text-foreground">
                Browse
            </h3>
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
        </section>

        <section class="flex flex-col gap-4 border-t border-border pt-5" aria-labelledby="problem-progress-filters">
            <h3 id="problem-progress-filters" class="type-secondary font-semibold text-foreground">
                Progress
            </h3>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div class="flex flex-col gap-1.5">
                    {@render field("Mastery")}
                    <Combobox
                        bind:value={mastery}
                        options={masteryOptions}
                        strict
                        placeholder="Any mastery…"
                    />
                </div>
                <div class="flex flex-col gap-1.5">
                    {@render field("Plan")}
                    <Combobox
                        bind:value={engagement}
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
                    bind:value={difficulty}
                    min={DIFFICULTY_RANGE[0]}
                    max={DIFFICULTY_RANGE[1]}
                    step={50}
                    label="Difficulty (problem rating)"
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
                    <TriStateSwitch bind:value={isComputational} size="sm" />
                </div>
            </div>
            <div class="flex items-center justify-between gap-4">
                {@render field("Verified")}
                <div class="flex items-center gap-2">
                    <span class="type-caption text-muted-foreground"
                        >{triText(verified, "Verified", "Not verified")}</span
                    >
                    <TriStateSwitch bind:value={verified} size="sm" />
                </div>
            </div>
        </section>
    {/if}
</div>
