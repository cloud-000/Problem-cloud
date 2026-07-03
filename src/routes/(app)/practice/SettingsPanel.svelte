<script lang="ts" module>
    import type { Range } from "$lib/trainer";

    /** Slider bounds for the advanced progress-counter filters. */
    export const COUNTER_RANGE: Range = [0, 25];

    /** Slider bounds for the tries-per-problem control. */
    export const TRIES_RANGE: Range = [1, 5];

    export type CounterKey = "seen" | "reviewed" | "correct" | "skipped";
    export type CounterRanges = Record<CounterKey, Range>;
    export type CounterEnabled = Record<CounterKey, boolean>;

    const COUNTERS: { key: CounterKey; label: string }[] = [
        { key: "seen", label: "Times seen" },
        { key: "reviewed", label: "Times reviewed" },
        { key: "correct", label: "Times correct" },
        { key: "skipped", label: "Times skipped" },
    ];

    const MODES: { value: PracticeMode; label: string; needsAuth: boolean }[] = [
        { value: "new", label: "New", needsAuth: false },
        { value: "review", label: "Due Review", needsAuth: true },
        { value: "mixed", label: "Mixed", needsAuth: true },
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
    import { Button } from "$lib/components/button";
    import { Combobox } from "$lib/components/combobox";
    import { Icon } from "$lib/components/icon";
    import { RangeSlider } from "$lib/components/range-slider";
    import { Select, type SelectOption } from "$lib/components/select";
    import {
        Switch,
        TriStateSwitch,
        type TriState,
    } from "$lib/components/toggle";
    import { DIFFICULTY_RANGE, TOPICS } from "$lib/library";
    import type { PracticeMode } from "$lib/trainer";
    import { cn } from "$lib/utils";
    import { fly } from "svelte/transition";

    let {
        mode = $bindable<PracticeMode>("new"),
        topic = $bindable<string[]>([]),
        difficulty = $bindable<[number, number]>([...DIFFICULTY_RANGE]),
        verifiedOnly = $bindable(false),
        computational = $bindable<TriState>("neutral"),
        answerAvailability = $bindable<TriState>("off"),
        triesPerProblem = $bindable(2),
        seriesIds = $bindable<string[]>([]),
        seriesOptions = [],
        counterRanges,
        counterEnabled,
        lastSubmissionDays = $bindable<number | null>(null),
        lastOutcome = $bindable<"any" | "correct" | "incorrect">("any"),
        includeUnscheduled = $bindable(false),
        canReview = true,
        isTest = false,
        testName = null,
        timeLimitSeconds = null,
        onClose,
    }: {
        mode: PracticeMode;
        topic: string[];
        difficulty: [number, number];
        verifiedOnly: boolean;
        computational: TriState;
        /** off = With answer (default), neutral = Any, on = Without answer. */
        answerAvailability: TriState;
        /** Attempts allowed per problem before it's finalized as incorrect. */
        triesPerProblem: number;
        seriesIds: string[];
        seriesOptions: { value: string; label: string }[];
        counterRanges: CounterRanges;
        counterEnabled: CounterEnabled;
        lastSubmissionDays: number | null;
        lastOutcome: "any" | "correct" | "incorrect";
        includeUnscheduled: boolean;
        canReview?: boolean;
        /** Test format: show a read-only summary instead of the editable filters. */
        isTest?: boolean;
        testName?: string | null;
        timeLimitSeconds?: number | null;
        onClose?: () => void;
    } = $props();

    let advancedOpen = $state(false);

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

    function resetSettings() {
        mode = "new";
        topic = [];
        difficulty = [...DIFFICULTY_RANGE];
        verifiedOnly = false;
        computational = "neutral";
        answerAvailability = "off";
        triesPerProblem = 2;
        seriesIds = [];
        for (const { key } of COUNTERS) {
            counterEnabled[key] = false;
            counterRanges[key] = [...COUNTER_RANGE];
        }
        lastSubmissionDays = null;
        lastOutcome = "any";
        includeUnscheduled = false;
    }
</script>

<aside
    transition:fly={{ x: 30, duration: 200 }}
    class="fixed inset-y-0 right-0 z-50 w-full sm:w-80 shrink-0 flex flex-col gap-5 bg-surface-container-lowest p-5 h-full shadow-2xl border-l border-border/50 overflow-y-auto overflow-x-hidden lg:static lg:w-80 lg:h-full lg:bg-transparent lg:shadow-none lg:py-0 lg:px-6 lg:border-y-0 lg:border-r-0 lg:rounded-none"
>
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
        <!-- Primary control: New / Due Review / Mixed -->
        <div class="flex flex-col gap-2 border-b border-border/30 pb-4">
        <span class="text-xs font-medium text-muted-foreground">Problems</span>
        <div
            class="flex items-center gap-1 rounded-lg border border-border/60 bg-surface-container-low p-1"
            role="radiogroup"
            aria-label="Problem mode"
        >
            {#each MODES as m}
                {@const disabled = m.needsAuth && !canReview}
                <button
                    type="button"
                    role="radio"
                    aria-checked={mode === m.value}
                    {disabled}
                    title={disabled ? "Sign in to review problems" : undefined}
                    onclick={() => (mode = m.value)}
                    class={cn(
                        "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                        mode === m.value
                            ? "bg-surface-container-lowest text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        disabled && "cursor-not-allowed opacity-40 hover:text-muted-foreground",
                    )}
                >
                    {m.label}
                </button>
            {/each}
        </div>
    </div>

    <div class="flex flex-col gap-2 border-b border-border/30 pb-4">
        <span class="text-xs font-medium text-muted-foreground">Topic</span>
        <Combobox
            bind:value={topic}
            options={TOPICS}
            strict
            placeholder="Any topic"
            inputPlaceholder="Add topic"
        />
    </div>

    <div class="flex flex-col gap-2 border-b border-border/30 pb-4">
        <span class="text-xs font-medium text-muted-foreground">Series</span>
        <Combobox
            bind:value={seriesIds}
            options={seriesOptions}
            strict
            placeholder="All series"
            inputPlaceholder="Add series"
        />
    </div>

    <div class="flex flex-col gap-2 border-b border-border/30 pb-4">
        <span class="text-xs font-medium text-muted-foreground">
            Difficulty ({difficulty[0]}-{difficulty[1]})
        </span>
        <RangeSlider
            bind:value={difficulty}
            min={DIFFICULTY_RANGE[0]}
            max={DIFFICULTY_RANGE[1]}
            step={1}
            label="Difficulty"
        />
    </div>

    <div class="flex flex-col gap-2 border-b border-border/30 pb-4">
        <div class="flex items-center justify-between gap-3">
            <span class="text-xs font-medium text-muted-foreground">
                Tries per problem
            </span>
            <span class="text-[10px] text-muted-foreground">
                {triesPerProblem === 1
                    ? "1 try"
                    : `${triesPerProblem} tries`}
            </span>
        </div>
        <RangeSlider
            single
            bind:singleValue={triesPerProblem}
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
                {verifiedOnly ? "Verified" : "Any"}
            </span>
        </div>
        <Switch bind:checked={verifiedOnly} size="sm" />
    </div>

    <div class="flex items-center justify-between gap-3">
        <div class="flex flex-col gap-0.5">
            <span class="text-xs font-medium text-muted-foreground">
                Computational
            </span>
            <span class="text-[10px] text-muted-foreground">
                {computationalLabel(computational)}
            </span>
        </div>
        <TriStateSwitch bind:value={computational} size="sm" />
    </div>

    <div class="flex items-center justify-between gap-3">
        <div class="flex flex-col gap-0.5">
            <span class="text-xs font-medium text-muted-foreground">
                Answer availability
            </span>
            <span class="text-[10px] text-muted-foreground">
                {answerAvailabilityLabel(answerAvailability)}
            </span>
        </div>
        <TriStateSwitch bind:value={answerAvailability} size="sm" />
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
                    Refine the review queue. Only applies to Due Review and the
                    review half of Mixed.
                </p>

                <div class="flex items-center justify-between gap-3">
                    <div class="flex flex-col gap-0.5">
                        <span class="text-xs font-medium text-muted-foreground">
                            Include unscheduled
                        </span>
                        <span class="text-[10px] text-muted-foreground">
                            {includeUnscheduled
                                ? "Seen, not yet scheduled"
                                : "Scheduled only"}
                        </span>
                    </div>
                    <Switch bind:checked={includeUnscheduled} size="sm" />
                </div>

                {#each COUNTERS as c}
                    <div class="flex flex-col gap-2">
                        <div class="flex items-center justify-between gap-3">
                            <span class="text-xs font-medium text-muted-foreground">
                                {c.label}
                            </span>
                            <div class="flex items-center gap-2">
                                <span class="text-[10px] text-muted-foreground">
                                    {counterEnabled[c.key]
                                        ? `${counterRanges[c.key][0]}–${counterRanges[c.key][1]}`
                                        : "Any"}
                                </span>
                                <Switch
                                    size="sm"
                                    checked={counterEnabled[c.key]}
                                    onclick={() =>
                                        (counterEnabled[c.key] = !counterEnabled[c.key])}
                                    aria-label={`Filter ${c.label}`}
                                />
                            </div>
                        </div>
                        {#if counterEnabled[c.key]}
                            <RangeSlider
                                bind:value={counterRanges[c.key]}
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
                        value={lastSubmissionDays == null
                            ? "any"
                            : String(lastSubmissionDays)}
                        onchange={(v) =>
                            (lastSubmissionDays = v === "any" ? null : Number(v))}
                    />
                </div>

                <div class="flex flex-col gap-2">
                    <span class="text-xs font-medium text-muted-foreground">
                        Last outcome
                    </span>
                    <Select
                        options={OUTCOME_OPTIONS}
                        value={lastOutcome}
                        onchange={(v) =>
                            (lastOutcome = v as "any" | "correct" | "incorrect")}
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
</aside>
