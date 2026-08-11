<script lang="ts">
    import type { SupabaseClient } from "@supabase/supabase-js";
    import type { Database } from "$lib/types/database.types";
    import { Button } from "$lib/components/button";
    import { DatePicker } from "$lib/components/date-picker";
    import { Input } from "$lib/components/input";
    import { Modal } from "$lib/components/modal";
    import { Select, type SelectOption } from "$lib/components/select";
    import {
        createGoal,
        describeTarget,
        fetchScopeTotals,
        scopeKey,
        targetOf,
        updateGoal,
        validateTarget,
        type Goal,
        type GoalScope,
        type GoalTargetData,
        type GoalTargetType,
        type VolumePeriod,
    } from "$lib/goals";
    import Track from "../practice/Track.svelte";
    import { createTrackValue, type TrackValue } from "../practice/practice-settings";
    import {
        describeScope,
        isMaterialEdit,
        type SeriesNames,
    } from "./goal-presentation";

    type Supabase = SupabaseClient<Database>;

    let {
        open = $bindable(false),
        supabase,
        userId,
        seriesOptions = [],
        seriesNames,
        goal = null,
        onsaved,
    }: {
        open?: boolean;
        supabase: Supabase;
        userId: string;
        seriesOptions?: { value: string; label: string }[];
        seriesNames: SeriesNames;
        /** null creates; a goal edits it in place. */
        goal?: Goal | null;
        onsaved: (goal: Goal, kind: "created" | "updated") => void;
    } = $props();

    // The timezone is captured when the goal is authored and stored on it, never
    // read per-device: a streak that breaks depending on where you open the app
    // is not a streak (`docs/goals.md` §6).
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const TYPE_OPTIONS: SelectOption[] = [
        { value: "attempted_count", label: "Attempt a number of problems", group: "Coverage" },
        { value: "attempted_percent", label: "Attempt a share of the scope", group: "Coverage" },
        { value: "solved_count", label: "Solve a number of problems", group: "Coverage" },
        { value: "solved_percent", label: "Solve a share of the scope", group: "Coverage" },
        { value: "volume", label: "Put in the reps", group: "Volume" },
        { value: "accuracy", label: "Be accurate on fresh problems", group: "Form" },
        { value: "speed", label: "Be fast enough", group: "Form" },
        { value: "streak", label: "Show up every day", group: "Habit" },
    ];

    const PERIOD_OPTIONS: SelectOption[] = [
        { value: "rolling", label: "Over a rolling window" },
        { value: "week", label: "This calendar week" },
        { value: "month", label: "This calendar month" },
        { value: "since_creation", label: "Since I set the goal" },
    ];

    type PeriodChoice = "rolling" | "week" | "month" | "since_creation";

    /** One labelled number input. Passed as an object so the snippet's shape is
     * readable at every call site, and so `suffix` can be left out. */
    type NumberField = {
        label: string;
        value: number;
        set: (value: number) => void;
        min: number;
        max: number;
        suffix?: string;
    };

    /** Every target's fields at once, so switching type keeps what the student
     * already typed instead of resetting the form under them. */
    type Fields = {
        count: number;
        percentage: number;
        volumeCount: number;
        period: PeriodChoice;
        rollingDays: number;
        accuracy: number;
        accuracySample: number;
        maxSeconds: number;
        speedSample: number;
        minAccuracy: number;
        streakDays: number;
        perDay: number;
    };

    function defaultFields(): Fields {
        return {
            count: 25,
            percentage: 80,
            volumeCount: 100,
            period: "rolling",
            rollingDays: 7,
            accuracy: 85,
            accuracySample: 30,
            maxSeconds: 120,
            speedSample: 30,
            minAccuracy: 70,
            streakDays: 14,
            perDay: 5,
        };
    }

    /** Seed the form's fields from an existing target, leaving the other
     * targets' fields at their defaults. */
    function fieldsFrom(target: GoalTargetData): Fields {
        const f = defaultFields();
        switch (target.type) {
            case "attempted_count":
            case "solved_count":
                f.count = target.count;
                break;
            case "attempted_percent":
            case "solved_percent":
                f.percentage = target.percentage;
                break;
            case "volume":
                f.volumeCount = target.count;
                f.period =
                    target.period.kind === "rolling"
                        ? "rolling"
                        : target.period.kind === "calendar"
                          ? target.period.unit
                          : "since_creation";
                if (target.period.kind === "rolling") f.rollingDays = target.period.days;
                break;
            case "accuracy":
                f.accuracy = target.percentage;
                f.accuracySample = target.sampleSize;
                break;
            case "speed":
                f.maxSeconds = target.maxSeconds;
                f.speedSample = target.sampleSize;
                f.minAccuracy = target.minAccuracy;
                break;
            case "streak":
                f.streakDays = target.days;
                f.perDay = target.perDay;
                break;
        }
        return f;
    }

    /** A detached copy of a scope. Used both to seed the Track and to hand a
     * stable snapshot to an async fetch, so a later edit cannot mutate a request
     * that is already in flight. */
    function cloneScope(source: GoalScope): GoalScope {
        const scopes: GoalScope["seriesScopes"] = {};
        for (const [id, entry] of Object.entries(source.seriesScopes ?? {})) {
            scopes[id] = {
                divisions: [...(entry?.divisions ?? [])],
                formats: [...(entry?.formats ?? [])],
            };
        }
        return {
            topic: [...(source.topic ?? [])],
            seriesIds: [...(source.seriesIds ?? [])],
            seriesScopes: scopes,
        };
    }

    function trackFrom(source: GoalScope): TrackValue {
        const { topic, seriesIds, seriesScopes } = cloneScope(source);
        return { topic, seriesIds, seriesScopes };
    }

    let title = $state("");
    let type = $state<GoalTargetType>("solved_count");
    let fields = $state<Fields>(defaultFields());
    let deadline = $state("");
    let track = $state<TrackValue>(createTrackValue());
    let busy = $state(false);
    let saveError = $state<string | null>(null);
    let totals = $state<{ attempted: number; solved: number; eligibleTotal: number } | null>(
        null,
    );
    let totalsError = $state(false);
    let totalsLoading = $state(false);
    let hydratedKey: string | null = null;

    // Reset when the dialog opens, from the edited goal or from scratch, so a
    // re-opened dialog never shows the last edit's leftovers. `hydratedKey` is a
    // plain variable, not state: the list behind this dialog reloads while it is
    // open (achievement stamping), and depending on the goal object's identity
    // would wipe a half-typed form under the student.
    $effect(() => {
        if (!open) {
            hydratedKey = null;
            return;
        }
        const source = goal;
        const key = source ? `edit:${source.id}` : "create";
        if (hydratedKey === key) return;
        hydratedKey = key;
        busy = false;
        saveError = null;
        if (source) {
            // A stored target is untrusted (architecture doc §7). Editing an
            // unreadable goal is how a student fixes one, so the form opens on a
            // valid finish line rather than on a type nothing can render.
            const known = targetOf(source.target);
            title = source.title;
            type = known?.type ?? "solved_count";
            fields = known ? fieldsFrom(known) : defaultFields();
            deadline = source.deadline ?? "";
            track = trackFrom(source.scope);
        } else {
            title = "";
            type = "solved_count";
            fields = defaultFields();
            deadline = "";
            track = createTrackValue();
        }
    });

    let scope = $derived<GoalScope>({
        topic: track.topic,
        seriesIds: track.seriesIds,
        seriesScopes: track.seriesScopes,
    });

    function volumePeriod(): VolumePeriod {
        if (fields.period === "rolling") {
            return { kind: "rolling", days: fields.rollingDays };
        }
        if (fields.period === "since_creation") return { kind: "since_creation" };
        return { kind: "calendar", unit: fields.period, timeZone };
    }

    let target = $derived.by<GoalTargetData>(() => {
        switch (type) {
            case "attempted_count":
                return { type, count: fields.count };
            case "solved_count":
                return { type, count: fields.count };
            case "attempted_percent":
                return { type, percentage: fields.percentage };
            case "solved_percent":
                return { type, percentage: fields.percentage };
            case "volume":
                return { type, count: fields.volumeCount, period: volumePeriod() };
            case "accuracy":
                return {
                    type,
                    percentage: fields.accuracy,
                    sampleSize: fields.accuracySample,
                };
            case "speed":
                return {
                    type,
                    maxSeconds: fields.maxSeconds,
                    sampleSize: fields.speedSample,
                    minAccuracy: fields.minAccuracy,
                };
            case "streak":
                return { type, days: fields.streakDays, perDay: fields.perDay, timeZone };
        }
    });

    let isSetFamily = $derived(
        type === "attempted_count" ||
            type === "attempted_percent" ||
            type === "solved_count" ||
            type === "solved_percent",
    );
    let isCountTarget = $derived(type === "attempted_count" || type === "solved_count");

    // The preview reads the same denominator the goal itself will report — the
    // resolver is asked, never re-derived here (§7).
    $effect(() => {
        if (!open) return;
        // `scopeKey` reads every axis, which is exactly the dependency set this
        // effect wants — and a re-render that did not change the scope re-uses
        // the count rather than paying for a full catalog scan again.
        void scopeKey(scope);
        const request = cloneScope(scope);
        let cancelled = false;
        totalsLoading = true;
        const timer = setTimeout(() => {
            fetchScopeTotals(supabase, request)
                .then((result) => {
                    if (cancelled) return;
                    totals = result;
                    totalsError = false;
                })
                .catch(() => {
                    if (cancelled) return;
                    totals = null;
                    totalsError = true;
                })
                .finally(() => {
                    if (!cancelled) totalsLoading = false;
                });
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    });

    let invalid = $derived(
        validateTarget(target, {
            // A count target may not exceed the denominator it counts against —
            // but only when we actually know it (§7).
            eligibleTotal: isCountTarget ? totals?.eligibleTotal : undefined,
        }),
    );

    let scopeText = $derived(describeScope(scope, seriesNames));
    let alreadyCounts = $derived.by(() => {
        if (!isSetFamily || !totals) return null;
        const done =
            type === "attempted_count" || type === "attempted_percent"
                ? totals.attempted
                : totals.solved;
        const verb =
            type === "attempted_count" || type === "attempted_percent"
                ? "attempted"
                : "solved";
        return `You have already ${verb} ${done} of ${totals.eligibleTotal}.`;
    });

    /** Changing scope or the finish line changes what the goal MEANS, so an
     * achieved goal must explicitly reopen (§7). */
    let material = $derived(
        goal ? isMaterialEdit(goal, { scope, target }) : false,
    );

    async function save() {
        if (busy || invalid) return;
        const name = title.trim() || describeTarget(target).slice(0, 120);
        busy = true;
        saveError = null;
        try {
            if (goal) {
                let reopen = false;
                if (material && goal.achievedAt) {
                    reopen = window.confirm(
                        "This goal is already achieved. Changing its scope or finish line reopens it and clears the achievement date. Continue?",
                    );
                    if (!reopen) {
                        busy = false;
                        return;
                    }
                }
                const saved = await updateGoal(
                    supabase,
                    goal.id,
                    {
                        title: name,
                        scope: cloneScope(scope),
                        target,
                        deadline: deadline || null,
                    },
                    { reopen },
                );
                open = false;
                onsaved(saved, "updated");
            } else {
                const created = await createGoal(
                    supabase,
                    userId,
                    {
                        title: name,
                        scope: cloneScope(scope),
                        target,
                        deadline: deadline || null,
                    },
                    { eligibleTotal: isCountTarget ? totals?.eligibleTotal : undefined },
                );
                open = false;
                onsaved(created, "created");
            }
        } catch (error) {
            saveError = (error as Error).message || "Failed to save the goal";
        } finally {
            busy = false;
        }
    }
</script>

{#snippet numberField(field: NumberField)}
    <div class="flex flex-col gap-1.5">
        <span class="text-xs font-medium text-muted-foreground">{field.label}</span>
        <div class="flex items-center gap-2">
            <Input
                type="number"
                min={field.min}
                max={field.max}
                bind:value={
                    () => field.value,
                    (raw) => field.set(Number(raw) || 0)
                }
            />
            {#if field.suffix}
                <span class="shrink-0 text-xs text-muted-foreground">
                    {field.suffix}
                </span>
            {/if}
        </div>
    </div>
{/snippet}

<Modal
    bind:open
    title={goal ? "Edit goal" : "New goal"}
    size="md"
    class="flex flex-col min-h-120"
    overflowVisible={true}
>
    <div class="flex w-full flex-col gap-4">
        <div class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-muted-foreground">Title</span>
            <Input
                bind:value={title}
                maxlength={120}
                placeholder={describeTarget(target)}
            />
        </div>

        <div class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-muted-foreground">Finish line</span>
            <Select
                options={TYPE_OPTIONS}
                value={type}
                onchange={(value: string) => (type = value as GoalTargetType)}
            />
        </div>

        <!-- Per-target fields. Adding a target type adds a branch here and
             nothing else on this page (architecture doc §9). -->
        <div class="flex flex-col gap-3">
            {#if isCountTarget}
                {@render numberField({
                    label: "How many problems",
                    value: fields.count,
                    set: (v) => (fields.count = v),
                    min: 1,
                    max: 100000,
                    suffix: totals ? `of ${totals.eligibleTotal} in scope` : undefined,
                })}
            {:else if type === "attempted_percent" || type === "solved_percent"}
                {@render numberField({
                    label: "Share of the scope",
                    value: fields.percentage,
                    set: (v) => (fields.percentage = v),
                    min: 1,
                    max: 100,
                    suffix: "%",
                })}
            {:else if type === "volume"}
                {@render numberField({
                    label: "How many attempts",
                    value: fields.volumeCount,
                    set: (v) => (fields.volumeCount = v),
                    min: 1,
                    max: 100000,
                })}
                <div class="flex flex-col gap-1.5">
                    <span class="text-xs font-medium text-muted-foreground">Period</span>
                    <Select
                        options={PERIOD_OPTIONS}
                        value={fields.period}
                        onchange={(value: string) =>
                            (fields.period = value as PeriodChoice)}
                    />
                    <p class="text-xxs text-muted-foreground">
                        {fields.period === "rolling" || fields.period === "since_creation"
                            ? "Finishable once: reach it and it stays reached."
                            : "A recurring quota — it starts over each " +
                              fields.period +
                              "."}
                    </p>
                </div>
                {#if fields.period === "rolling"}
                    {@render numberField({
                        label: "Window",
                        value: fields.rollingDays,
                        set: (v) => (fields.rollingDays = v),
                        min: 1,
                        max: 365,
                        suffix: "days",
                    })}
                {/if}
            {:else if type === "accuracy"}
                {@render numberField({
                    label: "Accuracy",
                    value: fields.accuracy,
                    set: (v) => (fields.accuracy = v),
                    min: 1,
                    max: 100,
                    suffix: "%",
                })}
                {@render numberField({
                    label: "Measured over",
                    value: fields.accuracySample,
                    set: (v) => (fields.accuracySample = v),
                    min: 10,
                    max: 500,
                    suffix: "fresh problems",
                })}
            {:else if type === "speed"}
                {@render numberField({
                    label: "Average time",
                    value: fields.maxSeconds,
                    set: (v) => (fields.maxSeconds = v),
                    min: 1,
                    max: 3600,
                    suffix: "seconds or less",
                })}
                {@render numberField({
                    label: "Measured over",
                    value: fields.speedSample,
                    set: (v) => (fields.speedSample = v),
                    min: 10,
                    max: 500,
                    suffix: "problems",
                })}
                {@render numberField({
                    label: "While staying at least",
                    value: fields.minAccuracy,
                    set: (v) => (fields.minAccuracy = v),
                    min: 1,
                    max: 100,
                    suffix: "% accurate",
                })}
                <p class="text-xxs text-muted-foreground">
                    The accuracy floor is what stops "faster" from being solved by
                    guessing.
                </p>
            {:else if type === "streak"}
                {@render numberField({
                    label: "Days in a row",
                    value: fields.streakDays,
                    set: (v) => (fields.streakDays = v),
                    min: 1,
                    max: 3650,
                    suffix: "days",
                })}
                {@render numberField({
                    label: "Each day, at least",
                    value: fields.perDay,
                    set: (v) => (fields.perDay = v),
                    min: 1,
                    max: 500,
                    suffix: "problems",
                })}
                <p class="text-xxs text-muted-foreground">
                    Days are counted in {timeZone}, wherever you open the app.
                </p>
            {/if}
        </div>

        <!-- Scope is the practice Track, unchanged: that identity is what makes
             "practice what's left" free (§3). -->
        <div class="flex flex-col gap-4">
            <span class="text-xs font-medium text-muted-foreground">Scope</span>
            <Track bind:value={track} {seriesOptions} {supabase} />
        </div>

        <div class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-muted-foreground">
                Deadline (optional)
            </span>
            <DatePicker bind:value={deadline} placeholder="No deadline" />
            <p class="text-xxs text-muted-foreground">
                A horizon, not a second finish line — passing it never fails the
                goal.
            </p>
        </div>

        <!-- The literal interpretation, before saving (§7). -->
        <div
            class="flex flex-col gap-1 rounded-lg border border-border/60 bg-surface-container-low/50 p-3"
        >
            <p class="type-secondary text-foreground">
                {describeTarget(target)} in {scopeText}.
            </p>
            {#if totalsLoading}
                <p class="text-xxs text-muted-foreground">Counting the scope…</p>
            {:else if totalsError}
                <p class="text-xxs text-muted-foreground">
                    Could not count this scope right now.
                </p>
            {:else if alreadyCounts}
                <p class="text-xxs text-muted-foreground">{alreadyCounts}</p>
            {:else if totals}
                <p class="text-xxs text-muted-foreground">
                    {totals.eligibleTotal} problems in this scope can be graded.
                </p>
            {/if}
            {#if invalid}
                <p class="text-xxs text-destructive">{invalid}</p>
            {/if}
            {#if goal && material && goal.achievedAt}
                <p class="text-xxs text-unsure">
                    This changes what the goal means, so saving reopens it.
                </p>
            {/if}
        </div>

        {#if saveError}
            <p class="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
                {saveError}
            </p>
        {/if}
    </div>

    {#snippet footer()}
        <Button variant="ghost" size="sm" onclick={() => (open = false)}>Cancel</Button>
        <Button
            size="sm"
            variant="primary"
            onclick={save}
            disabled={busy || Boolean(invalid)}
        >
            {goal ? "Save" : "Create goal"}
        </Button>
    {/snippet}
</Modal>
