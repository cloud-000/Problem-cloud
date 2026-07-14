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

    const MODES: { value: PracticeMode; label: string; needsAuth: boolean }[] = [
        { value: "new", label: "New", needsAuth: false },
        { value: "review", label: "Due Review", needsAuth: true },
        { value: "skipped", label: "Skipped, unsolved", needsAuth: true },
        { value: "list", label: "My list", needsAuth: true },
        { value: "mixed", label: "Mixed", needsAuth: true },
    ];

    const MASTERY_OPTIONS: { value: Mastery | "unassessed"; label: string }[] = [
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
    import { onMount } from "svelte";
    import { Button } from "$lib/components/button";
    import { Combobox } from "$lib/components/combobox";
    import { Icon } from "$lib/components/icon";
    import { RangeSlider } from "$lib/components/range-slider";
    import { Select } from "$lib/components/select";
    import { Switch, TriStateSwitch, type TriState } from "$lib/components/toggle";
    import { TOPICS } from "$lib/library";
    import { ADAPTIVE_RANGE_BOUNDS } from "$lib/trainer";
    import {
        COUNTER_RANGE,
        RATING_RANGE,
        TRIES_RANGE,
        resetPracticeSettingsForm,
        type PracticeSettingsForm,
        type SeriesScopeConfig,
    } from "./practice-settings";
    import { cn } from "$lib/utils";
    import { fly } from "svelte/transition";

    let {
        form = $bindable<PracticeSettingsForm>(),
        seriesOptions = [],
        seriesScopeConfigs = [],
        canReview = true,
        isTest = false,
        testName = null,
        timeLimitSeconds = null,
        onFocusModeChange,
        onClose,
        maxWidth = 900,
        minWidth = 280
    }: {
        form: PracticeSettingsForm;
        seriesOptions: { value: string; label: string }[];
        /**
         * One collapsible division/format row per selected *classified* series
         * (unclassified series contribute none). The parent keeps
         * `form.seriesScopes` reconciled with this list, so each config id has a
         * bindable `form.seriesScopes[id]` entry.
         */
        seriesScopeConfigs?: SeriesScopeConfig[];
        canReview?: boolean;
        /** Test format: show a read-only summary instead of the editable filters. */
        isTest?: boolean;
        testName?: string | null;
        timeLimitSeconds?: number | null;
        onFocusModeChange?: (value: boolean) => void;
        onClose?: () => void;
        maxWidth?: number;
        minWidth?: number;
    } = $props();

    let advancedOpen = $state(false);
    // Per-series scope rows expand/collapse independently. A row defaults to open
    // when it's the only one or already carries a selection; `expandedScopes`
    // holds explicit user overrides thereafter.
    let expandedScopes = $state<Record<string, boolean>>({});

    let width = $state(320);
    let isLg = $state(false);
    let isDragging = $state(false);

    onMount(() => {
        try {
            const savedWidth = localStorage.getItem("settings_panel_width");
            if (savedWidth !== null) {
                const parsed = parseInt(savedWidth, 10);
                if (!isNaN(parsed)) {
                    width = Math.max(minWidth, Math.min(maxWidth, parsed));
                }
            }
        } catch (_) {}

        const mediaQuery = window.matchMedia("(min-width: 1024px)");
        isLg = mediaQuery.matches;
        const handler = (e: MediaQueryListEvent) => {
            isLg = e.matches;
        };
        mediaQuery.addEventListener("change", handler);
        return () => {
            mediaQuery.removeEventListener("change", handler);
        };
    });

    let startX = 0;
    let startWidth = 0;

    function onPointerDown(e: PointerEvent) {
        if (e.button !== 0) return; // only left click
        isDragging = true;
        startX = e.clientX;
        startWidth = width;
        const target = e.currentTarget as HTMLElement;
        try {
            target.setPointerCapture(e.pointerId);
        } catch (_) {}
    }

    function onPointerMove(e: PointerEvent) {
        if (!isDragging) return;
        const deltaX = e.clientX - startX;
        // Panel is on the right, dragging left increases width
        width = Math.max(280, Math.min(600, startWidth - deltaX));
    }

    function onPointerUp(e: PointerEvent) {
        if (!isDragging) return;
        isDragging = false;
        const target = e.currentTarget as HTMLElement;
        try {
            target.releasePointerCapture(e.pointerId);
        } catch (_) {}
        try {
            localStorage.setItem("settings_panel_width", String(width));
        } catch (_) {}
        window.dispatchEvent(new Event("resize"));
    }

    function scopeOpen(cfg: SeriesScopeConfig): boolean {
        const scope = form.seriesScopes[cfg.id];
        const hasSelection =
            (scope?.divisions.length ?? 0) > 0 || (scope?.formats.length ?? 0) > 0;
        return (
            expandedScopes[cfg.id] ??
            (seriesScopeConfigs.length === 1 || hasSelection)
        );
    }

    function scopeSummary(cfg: SeriesScopeConfig): string {
        const scope = form.seriesScopes[cfg.id];
        const parts = [...(scope?.divisions ?? []), ...(scope?.formats ?? [])];
        return parts.length ? parts.join(" · ") : "All";
    }

    function computationalLabel(value: TriState) {
        if (value === "on") return "Computational";
        if (value === "off") return "Not computational";
        return "Any";
    }

    function answerAvailabilityLabel(value: TriState) {
        if (value === "on") return "Without answer (help answer it)";
        if (value === "off") return "With answer";
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

    function resetSettings() {
        resetPracticeSettingsForm(form);
        onFocusModeChange?.(form.focusMode);
    }
</script>

<aside
    transition:fly={{ x: 30, duration: 200 }}
    class="fixed inset-y-0 right-0 z-50 w-full sm:w-80 shrink-0 flex flex-col bg-surface-container-lowest h-full shadow-2xl border-l border-border/50 overflow-hidden lg:relative lg:w-80 lg:h-full lg:bg-transparent lg:shadow-none lg:border-y-0 lg:border-r-0 lg:rounded-none"
    style:width={isLg ? `${width}px` : undefined}
>
    {#if isLg}
        <!-- Drag Handle for Resizing (large screens only) -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class={cn(
                "absolute top-0 bottom-0 left-0 w-2 -ml-1 cursor-col-resize z-50 group flex items-center justify-center select-none h-full",
                isDragging && "bg-primary-foreground/5"
            )}
            onpointerdown={onPointerDown}
            onpointermove={onPointerMove}
            onpointerup={onPointerUp}
            onpointercancel={onPointerUp}
        >
            <div
                class={cn(
                    "w-[2px] h-8 rounded-full bg-border transition-all duration-150",
                    "group-hover:bg-primary-foreground group-hover:h-12",
                    isDragging && "bg-primary-foreground h-16"
                )}
            ></div>
        </div>
    {/if}

    <div class="flex-1 overflow-y-auto overflow-x-hidden flex flex-col gap-5 p-5 lg:py-0 lg:px-6 w-full h-full">
        <div class="flex items-center justify-between gap-3 border-b border-border/50 pb-3">
        <div>
            <h2 class="text-sm font-semibold">
                {isTest ? "Test" : "Settings"}
            </h2>
            <p class="text-[10px] text-muted-foreground">
                {isTest
                    ? "Locked for the duration of the test."
                    : "Applies to the next problem."}
            </p>
        </div>
        <Button
            class="lg:hidden"
            variant="ghost"
            size="icon-xs"
            aria-label="Close settings"
            onclick={() => onClose?.()}
        >
            <Icon name="close" />
        </Button>
    </div>

    <div class="flex items-center justify-between gap-3 border-b border-border/30 pb-4">
        <div class="flex flex-col gap-0.5">
            <span class="text-xs font-medium text-muted-foreground">
                Focus mode
            </span>
            <span class="text-[10px] text-muted-foreground">
                {form.focusMode ? "Minimal trainer" : "Full trainer"}
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
            <p
                class="rounded-md bg-surface-container-low p-3 text-[11px] leading-relaxed text-muted-foreground"
            >
                Answer the problems in any order. Nothing is graded until you
                submit the test, then you'll see your results.
            </p>
        </div>
    {:else}
        <!-- Primary control: source of the next problem. -->
        <div class="flex flex-col gap-2 border-b border-border/30 pb-4">
        <span class="text-xs font-medium text-muted-foreground">Problems</span>
        <div
            class="grid grid-cols-2 gap-1 rounded-lg border border-border/60 bg-surface-container-low p-1"
            role="radiogroup"
            aria-label="Problem mode"
        >
            {#each MODES as m (m.value)}
                {@const disabled = m.needsAuth && !canReview}
                <button
                    type="button"
                    role="radio"
                    aria-checked={form.mode === m.value}
                    {disabled}
                    title={disabled ? "Sign in to review problems" : undefined}
                    onclick={() => (form.mode = m.value)}
                    class={cn(
                        "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                        form.mode === m.value
                            ? "bg-surface-container-lowest text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        disabled && "cursor-not-allowed opacity-40 hover:text-muted-foreground",
                    )}
                >
                    {m.label}
                </button>
            {/each}
        </div>
        {#if form.mode === "list"}
            <Select
                options={PLAN_OPTIONS}
                value={form.listEngagement}
                onchange={(value) => (form.listEngagement = value as Engagement)}
            />
        {/if}
    </div>

    <div class="flex flex-col gap-2 border-b border-border/30 pb-4">
        <span class="text-xs font-medium text-muted-foreground">Mastery</span>
        <Combobox
            bind:value={form.mastery}
            options={MASTERY_OPTIONS}
            strict
            placeholder="Any mastery"
            inputPlaceholder="Add mastery"
        />
    </div>

    <div class="flex flex-col gap-2 border-b border-border/30 pb-4">
        <span class="text-xs font-medium text-muted-foreground">Topic</span>
        <Combobox
            bind:value={form.topic}
            options={TOPICS}
            strict
            placeholder="Any topic"
            inputPlaceholder="Add topic"
        />
    </div>

    <div class="flex flex-col gap-2 border-b border-border/30 pb-4">
        <span class="text-xs font-medium text-muted-foreground">Series</span>
        <Combobox
            bind:value={form.seriesIds}
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
                    <div class="rounded-lg border border-border/50 bg-surface-container-low/40">
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
                            <span class="max-w-[45%] shrink-0 truncate text-[10px] text-muted-foreground">
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
                                        <span class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                            Division
                                        </span>
                                        <Combobox
                                            bind:value={form.seriesScopes[cfg.id].divisions}
                                            options={cfg.divisionOptions}
                                            strict
                                            placeholder="All divisions"
                                            inputPlaceholder="Add division"
                                        />
                                    </div>
                                {/if}
                                {#if cfg.formatOptions.length > 0}
                                    <div class="flex flex-col gap-1.5">
                                        <span class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                            Format
                                        </span>
                                        <Combobox
                                            bind:value={form.seriesScopes[cfg.id].formats}
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

    <!-- Adaptive difficulty draws near the player's rating; with it off, the
         manual Difficulty band (a rating range) takes over. -->
    <div class="flex flex-col gap-3 border-b border-border/30 pb-4">
        <div class="flex items-center justify-between gap-3">
            <div class="flex flex-col gap-0.5">
                <span class="text-xs font-medium text-muted-foreground">
                    Adaptive difficulty
                </span>
                <span class="text-[10px] text-muted-foreground">
                    {form.adaptive
                        ? `Near your rating (±${form.adaptiveRange})`
                        : "Off — pick a difficulty range below"}
                </span>
            </div>
            <Switch bind:checked={form.adaptive} size="sm" />
        </div>
        {#if form.adaptive}
            <div class="flex flex-col gap-2" transition:fly={{ y: -6, duration: 150 }}>
                <span class="text-[10px] text-muted-foreground">
                    Rating range (±{form.adaptiveRange})
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
            <div class="flex flex-col gap-2" transition:fly={{ y: -6, duration: 150 }}>
                <span class="text-[10px] text-muted-foreground">
                    Difficulty — problem rating ({form.difficulty[0]}–{form
                        .difficulty[1]})
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

    <div class="flex flex-col gap-2 border-b border-border/30 pb-4">
        <div class="flex items-center justify-between gap-3">
            <span class="text-xs font-medium text-muted-foreground">
                Tries per problem
            </span>
            <span class="text-[10px] text-muted-foreground">
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

    <div class="flex items-center justify-between gap-3">
        <div class="flex flex-col gap-0.5">
            <span class="text-xs font-medium text-muted-foreground">
                Verified only
            </span>
            <span class="text-[10px] text-muted-foreground">
                {form.verifiedOnly ? "Verified" : "Any"}
            </span>
        </div>
        <Switch bind:checked={form.verifiedOnly} size="sm" />
    </div>

    <div class="flex items-center justify-between gap-3">
        <div class="flex flex-col gap-0.5">
            <span class="text-xs font-medium text-muted-foreground">
                Computational
            </span>
            <span class="text-[10px] text-muted-foreground">
                {computationalLabel(form.computational)}
            </span>
        </div>
        <TriStateSwitch bind:value={form.computational} size="sm" />
    </div>

    <div class="flex items-center justify-between gap-3">
        <div class="flex flex-col gap-0.5">
            <span class="text-xs font-medium text-muted-foreground">
                Answer availability
            </span>
            <span class="text-[10px] text-muted-foreground">
                {answerAvailabilityLabel(form.answerAvailability)}
            </span>
        </div>
        <TriStateSwitch bind:value={form.answerAvailability} size="sm" />
    </div>

    <div class="flex items-center justify-between gap-3">
        <div class="flex flex-col gap-0.5">
            <span class="text-xs font-medium text-muted-foreground">
                Solution availability
            </span>
            <span class="text-[10px] text-muted-foreground">
                {solutionAvailabilityLabel(form.solutionAvailability)}
            </span>
        </div>
        <TriStateSwitch bind:value={form.solutionAvailability} size="sm" />
    </div>

    <!-- Advanced filters (collapsible) -->
    <div class="flex flex-col gap-3 border-t border-border/30 pt-4">
        <button
            type="button"
            class="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            aria-expanded={advancedOpen}
            onclick={() => (advancedOpen = !advancedOpen)}
        >
            <span>Advanced filters</span>
            <Icon
                name="keyboard_arrow_down"
                class={cn("size-[1em] transition-transform", advancedOpen && "rotate-180")}
            />
        </button>

        {#if advancedOpen}
            <div class="flex flex-col gap-4" transition:fly={{ y: -6, duration: 150 }}>
                <p class="text-[10px] text-muted-foreground">
                    Refine progress-based queues. Applies to Due Review,
                    Skipped, and the review half of Mixed.
                </p>

                {#each COUNTERS as c (c.key)}
                    <div class="flex flex-col gap-2">
                        <div class="flex items-center justify-between gap-3">
                            <span class="text-xs font-medium text-muted-foreground">
                                {c.label}
                            </span>
                            <div class="flex items-center gap-2">
                                <span class="text-[10px] text-muted-foreground">
                                    {form.counterEnabled[c.key]
                                        ? `${form.counterRanges[c.key][0]}–${form.counterRanges[c.key][1]}`
                                        : "Any"}
                                </span>
                                <Switch
                                    size="sm"
                                    checked={form.counterEnabled[c.key]}
                                    onclick={() =>
                                        (form.counterEnabled[c.key] = !form.counterEnabled[c.key])}
                                    aria-label={`Filter ${c.label}`}
                                />
                            </div>
                        </div>
                        {#if form.counterEnabled[c.key]}
                            <RangeSlider
                                bind:value={form.counterRanges[c.key]}
                                min={COUNTER_RANGE[0]}
                                max={COUNTER_RANGE[1]}
                                step={1}
                                label={c.label}
                            />
                        {/if}
                    </div>
                {/each}

                <div class="flex flex-col gap-2">
                    <span class="text-xs font-medium text-muted-foreground">
                        Last submission
                    </span>
                    <Select
                        options={DAYS_OPTIONS}
                        value={form.lastSubmissionDays == null
                            ? "any"
                            : String(form.lastSubmissionDays)}
                        onchange={(v) =>
                            (form.lastSubmissionDays = v === "any" ? null : Number(v))}
                    />
                </div>

                <div class="flex flex-col gap-2">
                    <span class="text-xs font-medium text-muted-foreground">
                        Last outcome
                    </span>
                    <Select
                        options={OUTCOME_OPTIONS}
                        value={form.lastOutcome}
                        onchange={(v) =>
                            (form.lastOutcome = v as "any" | "correct" | "incorrect")}
                    />
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
</aside>
