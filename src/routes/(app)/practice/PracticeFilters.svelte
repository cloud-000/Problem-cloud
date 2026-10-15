<script lang="ts">
    import type { SupabaseClient } from "@supabase/supabase-js";
    import type { Database } from "#lib/types/database.types.js";
    import type { Engagement } from "#lib/progress.js";
    import type { SeriesDimensionRow, SeriesYearSpan } from "#lib/series-review.js";
    import { Button } from "#lib/components/button/index.js";
    import { Combobox } from "#lib/components/combobox/index.js";
    import { Icon } from "#lib/components/icon/index.js";
    import { Input } from "#lib/components/input/index.js";
    import { Select } from "#lib/components/select/index.js";
    import { RangeSlider } from "#lib/components/range-slider/index.js";
    import { Switch, TriStateSwitch } from "#lib/components/toggle/index.js";
    import {
        MAX_HISTORY_COUNT, ADAPTIVE_RANGE_BOUNDS, RATING_RANGE,
    } from "#lib/trainer.js";
    import Track from "./Track.svelte";
    import {
        COUNTER_RANGE, TRIES_RANGE, attemptPreset, setAttemptPreset,
        commitAttemptBound, resetPracticeSettingsForm,
        type PracticeSettingsForm, type CounterKey,
    } from "./practice-settings";

    let {
        form = $bindable(), seriesOptions, supabase,
        loadSeriesDimensions, loadSeriesNumberLine, loadSeriesYearSpan,
        historyAvailable = true, adaptiveAvailable = true,
        historyUnavailableReason = "Sign in to use your saved problem history.",
        onFocusModeChange,
    }: {
        form: PracticeSettingsForm;
        seriesOptions: { value: string; label: string }[];
        supabase?: SupabaseClient<Database>;
        loadSeriesDimensions?: (seriesId: number) => Promise<SeriesDimensionRow[]>;
        loadSeriesNumberLine?: (seriesId: number, scope?: { divisions: string[]; formats: string[] }) => Promise<number>;
        loadSeriesYearSpan?: (seriesId: number, scope?: { divisions: string[]; formats: string[] }) => Promise<SeriesYearSpan | null>;
        historyAvailable?: boolean;
        adaptiveAvailable?: boolean;
        historyUnavailableReason?: string;
        onFocusModeChange?: (value: boolean) => void;
    } = $props();

    const masteryOptions = [
        { value: "unassessed", label: "Unassessed" },
        { value: "needs_work", label: "Needs work" },
        { value: "learning", label: "Learning" },
        { value: "confident", label: "Confident" },
    ];
    const attemptOptions = [
        { value: "any", label: "Any" }, { value: "never", label: "Never attempted" },
        { value: "attempted", label: "At least once" }, { value: "custom", label: "Custom range" },
    ];
    const windowOptions = [
        { value: "any", label: "Any time" },
        { value: "within", label: "Within the last" },
        { value: "outside", label: "No submission in the last" },
    ];
    const daysOptions = [1, 3, 7, 14, 30, 90].map((days) => ({ value: String(days), label: `${days} ${days === 1 ? "day" : "days"}` }));
    const statusOptions = [
        { value: "any", label: "Any (except Ignored)" },
        { value: "working", label: "Working on" }, { value: "revisit", label: "Revisit" },
        { value: "later", label: "Later" }, { value: "ignored", label: "Ignored" },
    ];
    const counters: { key: CounterKey; label: string }[] = [
        { key: "correct", label: "Times correct" },
        { key: "skipped", label: "Times skipped" },
        { key: "seen", label: "Logged submissions (including skips)" },
    ];
    const preset = $derived(attemptPreset(form));
    let attemptDrafts = $state<[string | null, string | null]>([null, null]);
    let attemptErrors = $state<[string | null, string | null]>([null, null]);
    const moreHistoryActive = $derived(form.historyEngagement != null || form.lastOutcome !== "any" || counters.some(({ key }) => form.counterEnabled[key]) || form.historyOrder !== "random");
    const sectionClass = "flex flex-col gap-4 border-t border-border/30 pt-4";
    const labelClass = "text-xs font-medium text-muted-foreground";

    function attemptText(index: 0 | 1): string {
        if (attemptDrafts[index] != null) return attemptDrafts[index];
        const value = form.counterRanges.reviewed[index];
        return index === 1 && value === MAX_HISTORY_COUNT ? "" : String(value);
    }
    function editAttemptBound(index: 0 | 1, text: string) {
        attemptDrafts[index] = text;
        attemptErrors[index] = null;
    }
    function finishAttemptBound(index: 0 | 1) {
        attemptErrors[index] = commitAttemptBound(form, index, attemptText(index));
        attemptDrafts[index] = null;
    }
    function changeAttemptPreset(value: string) {
        attemptDrafts = [null, null];
        attemptErrors = [null, null];
        setAttemptPreset(form, value);
    }
    function changeWindow(value: string) {
        if (value === "any") form.lastSubmissionDays = null;
        else {
            form.lastSubmissionWindow = value as "within" | "outside";
            form.lastSubmissionDays ??= 7;
        }
    }
    function toggleTimedPractice() {
        form.perProblemSeconds = form.perProblemSeconds == null ? 45 : null;
    }
    function toggleFocusMode() {
        form.focusMode = !form.focusMode;
        onFocusModeChange?.(form.focusMode);
    }
    function resetSettings() {
        attemptDrafts = [null, null];
        attemptErrors = [null, null];
        resetPracticeSettingsForm(form);
        onFocusModeChange?.(form.focusMode);
    }
</script>

<section class="flex flex-col gap-3" aria-label="Scope">
    <h3 class="text-sm font-semibold">Scope</h3>
    <Track bind:value={form} {seriesOptions} {supabase} {loadSeriesDimensions} {loadSeriesNumberLine} {loadSeriesYearSpan} />
</section>

<section class={sectionClass} aria-label="Your history">
    <h3 class="text-sm font-semibold">Your history</h3>
    {#if !historyAvailable}
        <p class="text-xs text-muted-foreground">{historyUnavailableReason}</p>
    {/if}
    <fieldset disabled={!historyAvailable} class="flex min-w-0 flex-col gap-4 disabled:opacity-50">
        <div class="flex flex-col gap-2">
            <span class={labelClass}>Previous attempts</span>
            <Select options={attemptOptions} value={preset} onchange={changeAttemptPreset} aria-label="Previous attempts" disabled={!historyAvailable} />
            {#if preset === "custom"}
                <div class="grid grid-cols-2 gap-3">
                    <label class="flex min-w-0 flex-col gap-1.5">
                        <span class={labelClass}>Minimum</span>
                        <Input type="text" inputmode="numeric" bind:value={() => attemptText(0), (value) => editAttemptBound(0, value)} onblur={() => finishAttemptBound(0)} aria-invalid={attemptErrors[0] != null} disabled={!historyAvailable} />
                        {#if attemptErrors[0]}<span class="text-xs text-destructive" role="alert">{attemptErrors[0]}</span>{/if}
                    </label>
                    <label class="flex min-w-0 flex-col gap-1.5">
                        <span class={labelClass}>Maximum</span>
                        <Input type="text" inputmode="numeric" placeholder="Any" bind:value={() => attemptText(1), (value) => editAttemptBound(1, value)} onblur={() => finishAttemptBound(1)} aria-invalid={attemptErrors[1] != null} disabled={!historyAvailable} />
                        {#if attemptErrors[1]}<span class="text-xs text-destructive" role="alert">{attemptErrors[1]}</span>{/if}
                    </label>
                </div>
            {/if}
        </div>
        <div class="flex flex-col gap-2">
            <span class={labelClass}>Mastery</span>
            <Combobox bind:value={form.mastery} options={masteryOptions} strict placeholder="Any mastery" inputPlaceholder="Add mastery" disabled={!historyAvailable} aria-label="Mastery" />
        </div>
        <div class="flex flex-col gap-2">
            <span class={labelClass}>Last submission</span>
            <Select options={windowOptions} value={form.lastSubmissionDays == null ? "any" : form.lastSubmissionWindow} onchange={changeWindow} aria-label="Last submission window" disabled={!historyAvailable} />
            {#if form.lastSubmissionDays != null}
                <Select options={daysOptions} value={String(form.lastSubmissionDays)} onchange={(value) => form.lastSubmissionDays = Number(value)} aria-label="Submission window days" disabled={!historyAvailable} />
            {/if}
        </div>
        <details class="group flex flex-col gap-3">
            <summary class="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                <span>More history filters{moreHistoryActive ? " · Active" : ""}</span>
                <Icon name="keyboard_arrow_down" class="size-[1em] transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div class="mt-4 flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                    <span class={labelClass}>Personal status</span>
                    <Select options={statusOptions} value={form.historyEngagement ?? "any"} onchange={(value) => form.historyEngagement = value === "any" ? null : value as Engagement} aria-label="Personal status" disabled={!historyAvailable} />
                </div>
                <div class="flex flex-col gap-2">
                    <span class={labelClass}>Last graded result</span>
                    <Select options={[{ value: "any", label: "Any" }, { value: "correct", label: "Correct" }, { value: "incorrect", label: "Incorrect" }]} value={form.lastOutcome} onchange={(value) => form.lastOutcome = value as PracticeSettingsForm["lastOutcome"]} aria-label="Last graded result" disabled={!historyAvailable} />
                </div>
                {#each counters as counter (counter.key)}
                    <div class="flex flex-col gap-2">
                        <div class="flex items-center justify-between gap-3">
                            <span class={labelClass}>{counter.label}</span>
                            <Switch size="sm" checked={form.counterEnabled[counter.key]} onclick={() => form.counterEnabled[counter.key] = !form.counterEnabled[counter.key]} disabled={!historyAvailable} aria-label={`Filter ${counter.label}`} />
                        </div>
                        {#if form.counterEnabled[counter.key]}
                            <span class="text-xs text-muted-foreground">{form.counterRanges[counter.key].join("–")}</span>
                            <RangeSlider bind:value={form.counterRanges[counter.key]} min={0} max={Math.max(COUNTER_RANGE[1], form.counterRanges[counter.key][1])} step={1} label={counter.label} disabled={!historyAvailable} />
                        {/if}
                    </div>
                {/each}
                <div class="flex flex-col gap-2">
                    <span class={labelClass}>Order</span>
                    <Select options={[{ value: "random", label: "Random" }, { value: "oldest", label: "Least recent submission first" }]} value={form.historyOrder} onchange={(value) => form.historyOrder = value as PracticeSettingsForm["historyOrder"]} aria-label="Problem order" disabled={!historyAvailable} />
                </div>
            </div>
        </details>
    </fieldset>
</section>

<details class={`group ${sectionClass}`}>
    <summary class="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span>Session options</span>
        <Icon name="keyboard_arrow_down" class="size-[1em] transition-transform group-open:rotate-180" aria-hidden="true" />
    </summary>
    <div class="mt-4 flex flex-col gap-5">
        <section class="flex flex-col gap-3" aria-label="Difficulty">
            <h4 class="text-xs font-semibold">Difficulty</h4>
            <div class="flex items-center justify-between gap-3">
                <span class={labelClass}>Adaptive difficulty</span>
                <Switch checked={adaptiveAvailable && form.adaptive} onclick={() => form.adaptive = !form.adaptive} size="sm" disabled={!adaptiveAvailable} aria-label="Adaptive difficulty" />
            </div>
            {#if form.adaptive && adaptiveAvailable}
                <span class={labelClass}>Rating range</span>
                <RangeSlider single bind:singleValue={form.adaptiveRange} min={ADAPTIVE_RANGE_BOUNDS[0]} max={ADAPTIVE_RANGE_BOUNDS[1]} step={25} label="Adaptive rating range" />
            {:else}
                <span class={labelClass}>Difficulty — {form.difficulty[0]}–{form.difficulty[1]}</span>
                <RangeSlider bind:value={form.difficulty} min={RATING_RANGE[0]} max={RATING_RANGE[1]} step={50} label="Difficulty" disabled={!adaptiveAvailable} />
            {/if}
        </section>
        <section class="flex flex-col gap-3 border-t border-border/30 pt-4" aria-label="Problem requirements">
            <h4 class="text-xs font-semibold">Problem requirements</h4>
            <div class="flex items-center justify-between gap-3"><span class={labelClass}>Verified only</span><Switch bind:checked={form.verifiedOnly} size="sm" aria-label="Verified only" /></div>
            <div class="flex items-center justify-between gap-3"><span class={labelClass}>Computational</span><TriStateSwitch bind:value={form.computational} size="sm" aria-label="Computational" /></div>
            <div class="flex items-center justify-between gap-3"><span class={labelClass}>Reference answer</span><TriStateSwitch bind:value={form.answerAvailability} size="sm" aria-label="Reference answer" /></div>
            <div class="flex items-center justify-between gap-3"><span class={labelClass}>Solution availability</span><TriStateSwitch bind:value={form.solutionAvailability} size="sm" aria-label="Solution availability" /></div>
        </section>
        <section class="flex flex-col gap-3 border-t border-border/30 pt-4" aria-label="Timing and behavior">
            <h4 class="text-xs font-semibold">Timing and behavior</h4>
            <span class={labelClass}>Tries per problem — {form.triesPerProblem}</span>
            <RangeSlider single bind:singleValue={form.triesPerProblem} min={TRIES_RANGE[0]} max={TRIES_RANGE[1]} step={1} label="Tries per problem" />
            <div class="flex items-center justify-between gap-3"><span class={labelClass}>Timed practice</span><Switch checked={form.perProblemSeconds != null} onclick={toggleTimedPractice} size="sm" aria-label="Timed practice" /></div>
            {#if form.perProblemSeconds != null}
                <RangeSlider single bind:singleValue={() => form.perProblemSeconds ?? 45, (value) => form.perProblemSeconds = value} min={15} max={180} step={5} label="Time per problem" formatValue={(value) => `${value}s`} />
            {/if}
            <div class="flex items-center justify-between gap-3"><span class={labelClass}>Focus mode</span><Switch checked={form.focusMode} onclick={toggleFocusMode} size="sm" aria-label="Focus mode" /></div>
        </section>
    </div>
</details>

<Button variant="outline" size="sm" class="w-full text-xs" onclick={resetSettings}>Reset settings</Button>
