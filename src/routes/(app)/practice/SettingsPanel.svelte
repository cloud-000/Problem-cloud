<script lang="ts" module>
    import type { SelectOption } from "$lib/components/select";
    import type { PracticeMode } from "$lib/trainer";
    import type { Engagement, Mastery } from "$lib/progress";
    import type { CounterKey } from "./practice-settings";

    const COUNTERS: { key: CounterKey; label: string }[] = [
        { key: "seen", label: "Times seen" },
        { key: "reviewed", label: "Times reviewed" },
        { key: "correct", label: "Times correct" },
        { key: "skipped", label: "Times skipped" },
    ];

    const MODES: {
        value: PracticeMode;
        label: string;
        hint: string;
        needsAuth: boolean;
    }[] = [
        {
            value: "new",
            label: "New",
            hint: "Problems you've never attempted.",
            needsAuth: false,
        },
        {
            value: "review",
            label: "Due Review",
            hint: "Problems due for spaced-repetition review, most overdue first.",
            needsAuth: true,
        },
        {
            value: "skipped",
            label: "Skipped, unsolved",
            hint: "Problems you've skipped at least once and haven't solved yet.",
            needsAuth: true,
        },
        {
            value: "list",
            label: "My list",
            hint: "Problems from one of your lists (Working on / Revisit / Later / Ignored), chosen below.",
            needsAuth: true,
        },
        {
            value: "mixed",
            label: "Mixed",
            hint: "Alternates due reviews with new problems, about 1 review per 2 new.",
            needsAuth: true,
        },
    ];

    const MASTERY_OPTIONS: { value: Mastery | "unassessed"; label: string }[] =
        [
            { value: "unassessed", label: "Unassessed" },
            { value: "needs_work", label: "Needs work" },
            { value: "learning", label: "Learning" },
            { value: "confident", label: "Confident" },
        ];

    const PLAN_OPTIONS: { value: Engagement; label: string }[] = [
        { value: "working", label: "Working on" },
        { value: "revisit", label: "Revisit" },
        { value: "later", label: "Later" },
        { value: "ignored", label: "Ignored" },
    ];

    const DAYS_OPTIONS: SelectOption[] = [
        { value: "any", label: "Any" },
        { value: "7", label: "Last 7 days" },
        { value: "14", label: "Last 14 days" },
        { value: "30", label: "Last 30 days" },
        { value: "90", label: "Last 90 days" },
    ];

    const OUTCOME_OPTIONS: SelectOption[] = [
        { value: "any", label: "Any" },
        { value: "correct", label: "Correct" },
        { value: "incorrect", label: "Incorrect" },
    ];
</script>

<script lang="ts">
    import type { SupabaseClient } from "@supabase/supabase-js";
    import type { Database } from "$lib/types/database.types";
    import type { SeriesDimensionRow, SeriesYearSpan } from "$lib/series-review";
    import { Button } from "$lib/components/button";
    import { Combobox } from "$lib/components/combobox";
    import { Icon } from "$lib/components/icon";
    import { RangeSlider } from "$lib/components/range-slider";
    import { Select } from "$lib/components/select";
    import {
        Switch,
        TriStateSwitch,
        type TriState,
    } from "$lib/components/toggle";
    import { ADAPTIVE_RANGE_BOUNDS } from "$lib/trainer";
    import { formatDuration, type Pacing } from "$lib/test-timing";
    import {
        COUNTER_RANGE,
        RATING_RANGE,
        TRIES_RANGE,
        resetPracticeSettingsForm,
        type PracticeSettingsForm,
    } from "./practice-settings";
    import { cn } from "$lib/utils";
    import { fly } from "svelte/transition";
    import Track from "./Track.svelte";

    type Supabase = SupabaseClient<Database>;

    let {
        form = $bindable<PracticeSettingsForm>(),
        seriesOptions = [],
        supabase,
        loadSeriesDimensions,
        loadSeriesNumberLine,
        loadSeriesYearSpan,
        canReview = true,
        enabledModes,
        disabledModeReason = "This mode is unavailable for this practice source.",
        isTest = false,
        testName = null,
        timeLimitSeconds = null,
        pacing = null,
        strictTiming = true,
        onFocusModeChange,
        onClose,
    }: {
        form: PracticeSettingsForm;
        seriesOptions: { value: string; label: string }[];
        supabase?: Supabase;
        loadSeriesDimensions?: (seriesId: number) => Promise<SeriesDimensionRow[]>;
        loadSeriesNumberLine?: (
            seriesId: number,
            scope?: { divisions: string[]; formats: string[] },
        ) => Promise<number>;
        loadSeriesYearSpan?: (
            seriesId: number,
            scope?: { divisions: string[]; formats: string[] },
        ) => Promise<SeriesYearSpan | null>;
        canReview?: boolean;
        enabledModes?: Readonly<Record<PracticeMode, boolean>>;
        disabledModeReason?: string;
        /** Test format: show a read-only summary instead of the editable filters. */
        isTest?: boolean;
        testName?: string | null;
        timeLimitSeconds?: number | null;
        /** Test format: how time is spent (pooled vs. segmented pairs/singles). */
        pacing?: Pacing | null;
        strictTiming?: boolean;
        onFocusModeChange?: (value: boolean) => void;
        onClose?: () => void;
    } = $props();

    let advancedOpen = $state(false);
    // "Session mechanics" (everything besides the Track step) is collapsed by
    // default, mirroring the same disclosure pattern as "Advanced filters"
    // (which stays nested inside it) — two intentional levels, not flattened.
    let mechanicsOpen = $state(false);

    function computationalLabel(value: TriState) {
        if (value === "on") return "Computational";
        if (value === "off") return "Not computational";
        return "Any";
    }

    function answerAvailabilityLabel(value: TriState) {
        if (value === "on") return "Known";
        if (value === "off") return "Missing (help add it)";
        return "Any";
    }

    function solutionAvailabilityLabel(value: TriState) {
        if (value === "on") return "With solution";
        if (value === "off") return "Without solution";
        return "Any";
    }

    function toggleFocusMode() {
        form.focusMode = !form.focusMode;
        onFocusModeChange?.(form.focusMode);
    }

    // Per-problem timer (practice only). Off = null (untimed); on seeds a default.
    const PER_PROBLEM_SECONDS_BOUNDS = [15, 180] as const;
    const PER_PROBLEM_SECONDS_DEFAULT = 45;
    function toggleTimedPractice() {
        form.perProblemSeconds =
            form.perProblemSeconds == null ? PER_PROBLEM_SECONDS_DEFAULT : null;
    }

    function resetSettings() {
        resetPracticeSettingsForm(form);
        onFocusModeChange?.(form.focusMode);
    }
</script>

<div class="flex h-full min-h-0 flex-col bg-surface-container-lowest">
    <div
        class="flex-1 overflow-y-auto overflow-x-hidden flex flex-col gap-5 p-5 lg:pb-6 lg:px-6 w-full"
    >
        <div
            class="flex items-center justify-between gap-3 border-b border-border/50 pb-3"
        >
            <div>
                <h2 class="text-sm font-semibold">
                    {isTest ? "Test" : "Settings"}
                </h2>
                {#if isTest}
                    <p class="text-xxs text-muted-foreground">
                        Locked for the duration of the test.
                    </p>
                {/if}
            </div>
            <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Close settings"
                onclick={() => onClose?.()}
            >
                <Icon name="close" />
            </Button>
        </div>

        <div
            class="flex items-center justify-between gap-3 border-b border-border/30 pb-4"
        >
            <div class="flex flex-col gap-0.5">
                <span class="text-xs font-medium text-muted-foreground">
                    Focus mode
                </span>
            </div>
            <Switch
                checked={form.focusMode}
                onclick={toggleFocusMode}
                size="sm"
                aria-label="Toggle focus mode"
            />
        </div>

        {#if isTest}
            <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-1">
                    <span class="text-xs font-medium text-muted-foreground"
                        >Test</span
                    >
                    <span class="text-sm font-semibold text-foreground">
                        {testName ?? "Selected test"}
                    </span>
                </div>
                <div class="flex flex-col gap-1">
                    <span class="text-xs font-medium text-muted-foreground"
                        >Time limit</span
                    >
                    <span class="text-sm text-foreground">
                        {timeLimitSeconds == null
                            ? "Unlimited"
                            : `${Math.round(timeLimitSeconds / 60)} min`}
                    </span>
                </div>
                {#if pacing?.kind === "segmented"}
                    <div class="flex flex-col gap-1">
                        <span class="text-xs font-medium text-muted-foreground"
                            >Pacing</span
                        >
                        <span class="text-sm text-foreground">
                            {pacing.segmentSize === 1
                                ? `${formatDuration(pacing.secondsPerSegment)} per problem`
                                : `${formatDuration(pacing.secondsPerSegment)} per ${pacing.segmentSize}-problem segment`}
                        </span>
                        <span class="text-xxs text-muted-foreground">
                            {strictTiming
                                ? "Strict — each segment locks at 0:00"
                                : "Lenient — timer turns red, overrun allowed"}
                        </span>
                    </div>
                {/if}
            </div>
        {:else}
            <!-- Track: what this session is about (topic, series, per-series metadata).
         Front-loaded and always visible, shared with the session-creation dialog. -->
            <Track bind:value={form} {seriesOptions} {supabase} {loadSeriesDimensions} {loadSeriesNumberLine} {loadSeriesYearSpan} />

            <!-- Session mechanics (collapsible): everything else — mode, mastery,
         difficulty, pacing, and the nested Advanced filters sub-group. -->
            <div class="flex flex-col gap-3 border-t border-border/30 pt-4">
                <button
                    type="button"
                    class="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                    aria-expanded={mechanicsOpen}
                    onclick={() => (mechanicsOpen = !mechanicsOpen)}
                >
                    <span>Session mechanics</span>
                    <Icon
                        name="keyboard_arrow_down"
                        class={cn(
                            "size-[1em] transition-transform",
                            mechanicsOpen && "rotate-180",
                        )}
                    />
                </button>

                {#if mechanicsOpen}
                    <div
                        class="flex flex-col gap-5"
                        transition:fly={{ y: -6, duration: 150 }}
                    >
                        <!-- Primary control: source of the next problem. -->
                        <div
                            class="flex flex-col gap-2 border-b border-border/30 pb-4"
                        >
                            <span class="text-xs font-medium text-muted-foreground"
                                >Problems</span
                            >
                            <div
                                class="grid grid-cols-2 gap-1 rounded-lg border border-border/60 bg-surface-container-low p-1"
                                role="radiogroup"
                                aria-label="Problem mode"
                            >
                                {#each MODES as m (m.value)}
                                    {@const disabled =
                                        (m.needsAuth && !canReview) ||
                                        enabledModes?.[m.value] === false}
                                    <button
                                        type="button"
                                        role="radio"
                                        aria-checked={form.mode === m.value}
                                        {disabled}
                                        title={disabled
                                            ? enabledModes?.[m.value] === false
                                                ? disabledModeReason
                                                : "Sign in to review problems"
                                            : m.hint}
                                        onclick={() => (form.mode = m.value)}
                                        class={cn(
                                            "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                                            form.mode === m.value
                                                ? "bg-surface-container-lowest text-foreground shadow-sm"
                                                : "text-muted-foreground hover:text-foreground",
                                            disabled &&
                                                "cursor-not-allowed opacity-40 hover:text-muted-foreground",
                                        )}
                                    >
                                        {m.label}
                                    </button>
                                {/each}
                            </div>
                            <span class="text-xs text-muted-foreground">
                                {MODES.find((m) => m.value === form.mode)
                                    ?.hint}
                            </span>
                            {#if form.mode === "list"}
                                <Select
                                    options={PLAN_OPTIONS}
                                    value={form.listEngagement}
                                    onchange={(value) =>
                                        (form.listEngagement = value as Engagement)}
                                />
                            {/if}
                        </div>

                        <div
                            class="flex flex-col gap-2 border-b border-border/30 pb-4"
                        >
                            <span class="text-xs font-medium text-muted-foreground"
                                >Mastery</span
                            >
                            <Combobox
                                bind:value={form.mastery}
                                options={MASTERY_OPTIONS}
                                strict
                                placeholder="Any mastery"
                                inputPlaceholder="Add mastery"
                            />
                        </div>

                        <!-- Adaptive difficulty draws near the player's rating; with it off, the
             manual Difficulty band (a rating range) takes over. -->
                        <div
                            class="flex flex-col gap-3 border-b border-border/30 pb-4"
                        >
                            <div class="flex items-center justify-between gap-3">
                                <div class="flex flex-col gap-0.5">
                                    <span
                                        class="text-xs font-medium text-muted-foreground"
                                    >
                                        Adaptive difficulty
                                    </span>
                                    {#if form.adaptive}
                                        <span class="text-xs text-muted-foreground">
                                            Near your rating (±{form.adaptiveRange})
                                        </span>
                                    {/if}
                                </div>
                                <Switch bind:checked={form.adaptive} size="sm" />
                            </div>
                            {#if form.adaptive}
                                <div
                                    class="flex flex-col gap-2"
                                    transition:fly={{ y: -6, duration: 150 }}
                                >
                                    <span class="text-xs text-muted-foreground">
                                        Rating range
                                    </span>
                                    <RangeSlider
                                        single
                                        bind:singleValue={form.adaptiveRange}
                                        min={ADAPTIVE_RANGE_BOUNDS[0]}
                                        max={ADAPTIVE_RANGE_BOUNDS[1]}
                                        step={25}
                                        label="Adaptive rating range"
                                    />
                                </div>
                            {:else}
                                <div
                                    class="flex flex-col gap-2"
                                    transition:fly={{ y: -6, duration: 150 }}
                                >
                                    <span class="text-xs text-muted-foreground">
                                        Difficulty — problem rating ({form
                                            .difficulty[0]}–{form.difficulty[1]})
                                    </span>
                                    <RangeSlider
                                        bind:value={form.difficulty}
                                        min={RATING_RANGE[0]}
                                        max={RATING_RANGE[1]}
                                        step={50}
                                        label="Difficulty (problem rating)"
                                    />
                                </div>
                            {/if}
                        </div>

                        <div
                            class="flex flex-col gap-2 border-b border-border/30 pb-4"
                        >
                            <div class="flex items-center justify-between gap-3">
                                <span
                                    class="text-xs font-medium text-muted-foreground"
                                >
                                    Tries per problem
                                </span>
                                <span class="text-xs text-muted-foreground">
                                    {form.triesPerProblem === 1
                                        ? "1 try"
                                        : `${form.triesPerProblem} tries`}
                                </span>
                            </div>
                            <RangeSlider
                                single
                                bind:singleValue={form.triesPerProblem}
                                min={TRIES_RANGE[0]}
                                max={TRIES_RANGE[1]}
                                step={1}
                                label="Tries per problem"
                            />
                        </div>

                        <!-- Timed practice: a per-problem countdown that auto-advances at zero. -->
                        <div
                            class="flex flex-col gap-3 border-b border-border/30 pb-4"
                        >
                            <div class="flex items-center justify-between gap-3">
                                <div class="flex flex-col gap-0.5">
                                    <span
                                        class="text-xs font-medium text-muted-foreground"
                                    >
                                        Timed practice
                                    </span>
                                    <span class="text-xs text-muted-foreground">
                                        {form.perProblemSeconds == null
                                            ? "Off"
                                            : `${form.perProblemSeconds}s per problem`}
                                    </span>
                                </div>
                                <Switch
                                    checked={form.perProblemSeconds != null}
                                    onclick={toggleTimedPractice}
                                    size="sm"
                                    aria-label="Toggle timed practice"
                                />
                            </div>
                            {#if form.perProblemSeconds != null}
                                <div
                                    class="flex flex-col gap-2"
                                    transition:fly={{ y: -6, duration: 150 }}
                                >
                                    <RangeSlider
                                        single
                                        bind:singleValue={
                                            () =>
                                                form.perProblemSeconds ??
                                                PER_PROBLEM_SECONDS_DEFAULT,
                                            (v) => (form.perProblemSeconds = v)
                                        }
                                        min={PER_PROBLEM_SECONDS_BOUNDS[0]}
                                        max={PER_PROBLEM_SECONDS_BOUNDS[1]}
                                        step={5}
                                        label="Time per problem"
                                        formatValue={(v) => `${v}s`}
                                    />
                                </div>
                            {/if}
                        </div>

                        <div class="flex items-center justify-between gap-3">
                            <div class="flex flex-col gap-0.5">
                                <span
                                    class="text-xs font-medium text-muted-foreground"
                                >
                                    Verified only
                                </span>
                                <span class="text-xs text-muted-foreground">
                                    {form.verifiedOnly ? "Verified" : "Any"}
                                </span>
                            </div>
                            <Switch bind:checked={form.verifiedOnly} size="sm" />
                        </div>

                        <div class="flex items-center justify-between gap-3">
                            <div class="flex flex-col gap-0.5">
                                <span
                                    class="text-xs font-medium text-muted-foreground"
                                >
                                    Computational
                                </span>
                                <span class="text-xs text-muted-foreground">
                                    {computationalLabel(form.computational)}
                                </span>
                            </div>
                            <TriStateSwitch
                                bind:value={form.computational}
                                size="sm"
                            />
                        </div>

                        <div class="flex items-center justify-between gap-3">
                            <div class="flex flex-col gap-0.5">
                                <span
                                    class="text-xs font-medium text-muted-foreground"
                                >
                                    Reference answer
                                </span>
                                <span class="text-xs text-muted-foreground">
                                    {answerAvailabilityLabel(
                                        form.answerAvailability,
                                    )}
                                </span>
                            </div>
                            <TriStateSwitch
                                bind:value={form.answerAvailability}
                                size="sm"
                            />
                        </div>

                        <div class="flex items-center justify-between gap-3">
                            <div class="flex flex-col gap-0.5">
                                <span
                                    class="text-xs font-medium text-muted-foreground"
                                >
                                    Solution availability
                                </span>
                                <span class="text-xs text-muted-foreground">
                                    {solutionAvailabilityLabel(
                                        form.solutionAvailability,
                                    )}
                                </span>
                            </div>
                            <TriStateSwitch
                                bind:value={form.solutionAvailability}
                                size="sm"
                            />
                        </div>

                        <!-- Advanced filters (nested collapsible, one level deeper) -->
                        <div
                            class="flex flex-col gap-3 border-t border-border/30 pt-4"
                        >
                            <button
                                type="button"
                                class="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                                aria-expanded={advancedOpen}
                                onclick={() => (advancedOpen = !advancedOpen)}
                            >
                                <span>Advanced filters</span>
                                <Icon
                                    name="keyboard_arrow_down"
                                    class={cn(
                                        "size-[1em] transition-transform",
                                        advancedOpen && "rotate-180",
                                    )}
                                />
                            </button>

                            {#if advancedOpen}
                                <div
                                    class="flex flex-col gap-4"
                                    transition:fly={{ y: -6, duration: 150 }}
                                >
                                    {#each COUNTERS as c (c.key)}
                                        <div class="flex flex-col gap-2">
                                            <div
                                                class="flex items-center justify-between gap-3"
                                            >
                                                <span
                                                    class="text-xs font-medium text-muted-foreground"
                                                >
                                                    {c.label}
                                                </span>
                                                <div
                                                    class="flex items-center gap-2"
                                                >
                                                    <span
                                                        class="text-xs text-muted-foreground"
                                                    >
                                                        {form.counterEnabled[
                                                            c.key
                                                        ]
                                                            ? `${form.counterRanges[c.key][0]}–${form.counterRanges[c.key][1]}`
                                                            : "Any"}
                                                    </span>
                                                    <Switch
                                                        size="sm"
                                                        checked={form
                                                            .counterEnabled[
                                                            c.key
                                                        ]}
                                                        onclick={() =>
                                                            (form.counterEnabled[
                                                                c.key
                                                            ] =
                                                                !form
                                                                    .counterEnabled[
                                                                    c.key
                                                                ])}
                                                        aria-label={`Filter ${c.label}`}
                                                    />
                                                </div>
                                            </div>
                                            {#if form.counterEnabled[c.key]}
                                                <RangeSlider
                                                    bind:value={
                                                        form.counterRanges[
                                                            c.key
                                                        ]
                                                    }
                                                    min={COUNTER_RANGE[0]}
                                                    max={COUNTER_RANGE[1]}
                                                    step={1}
                                                    label={c.label}
                                                />
                                            {/if}
                                        </div>
                                    {/each}

                                    <div class="flex flex-col gap-2">
                                        <span
                                            class="text-xs font-medium text-muted-foreground"
                                        >
                                            Last submission
                                        </span>
                                        <Select
                                            options={DAYS_OPTIONS}
                                            value={form.lastSubmissionDays ==
                                            null
                                                ? "any"
                                                : String(
                                                      form.lastSubmissionDays,
                                                  )}
                                            onchange={(v) =>
                                                (form.lastSubmissionDays =
                                                    v === "any"
                                                        ? null
                                                        : Number(v))}
                                        />
                                    </div>

                                    <div class="flex flex-col gap-2">
                                        <span
                                            class="text-xs font-medium text-muted-foreground"
                                        >
                                            Last outcome
                                        </span>
                                        <Select
                                            options={OUTCOME_OPTIONS}
                                            value={form.lastOutcome}
                                            onchange={(v) =>
                                                (form.lastOutcome = v as
                                                    | "any"
                                                    | "correct"
                                                    | "incorrect")}
                                        />
                                    </div>
                                </div>
                            {/if}
                        </div>
                    </div>
                {/if}
            </div>

            <Button
                variant="outline"
                size="sm"
                class="w-full text-xs"
                onclick={resetSettings}
            >
                Reset settings
            </Button>
        {/if}
    </div>
</div>
