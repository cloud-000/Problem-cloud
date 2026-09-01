<script lang="ts">
    import type { SupabaseClient } from "@supabase/supabase-js";
    import type { Database } from "$lib/types/database.types";
    import { Button } from "$lib/components/button";
    import { DatePicker } from "$lib/components/date-picker";
    import { Input } from "$lib/components/input";
    import { Modal } from "$lib/components/modal";
    import { modal } from "$lib/state/modal.svelte";
    import { Select, type SelectOption } from "$lib/components/select";
    import { TOPICS } from "$lib/library";
    import {
        createGoal,
        describeTarget,
        evaluateGoals,
        fetchGoalProgress,
        fetchScopeTotals,
        planGoalRequests,
        scopeKey,
        targetOf,
        updateGoal,
        validateTarget,
        type Goal,
        type GoalScope,
        type GoalTargetData,
        type GoalTargetType,
        type GoalProgressResult,
        type VolumePeriod,
    } from "$lib/goals";
    import { acknowledgeSetGoal } from "$lib/onboarding";
    import Track from "../practice/Track.svelte";
    import { createTrackValue, type TrackValue } from "../practice/practice-settings";
    import {
        describeScope,
        goalCommitmentSentence,
        isMaterialEdit,
        progressSummary,
        type SeriesNames,
    } from "$lib/goals/presentation";

    type Supabase = SupabaseClient<Database>;

    let {
        open = $bindable(false),
        supabase,
        userId,
        seriesOptions = [],
        seriesNames,
        goal = null,
        onsaved,
        onstart,
    }: {
        open?: boolean;
        supabase: Supabase;
        userId: string;
        seriesOptions?: { value: string; label: string }[];
        seriesNames: SeriesNames;
        /** null creates; a goal edits it in place. */
        goal?: Goal | null;
        onsaved: (goal: Goal, kind: "created" | "updated") => void;
        /** Starts the same scoped handoff as the goal's ordinary practice action. */
        onstart?: (goal: Goal) => void | Promise<void>;
    } = $props();

    // The timezone is captured when the goal is authored and stored on it, never
    // read per-device: a streak that breaks depending on where you open the app
    // is not a streak (`docs/goals.md` §6).
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const TYPE_OPTIONS: { value: GoalTargetType; label: string; group: string }[] = [
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
    type Intent = "work" | "solve" | "improve" | "habit";
    type MaterialChoice = "all" | "series" | "topic" | "custom";

    const INTENTS: { value: Intent; title: string; description: string }[] = [
        { value: "work", title: "Work through material", description: "Example: Attempt 80% of AMC 10 Geometry." },
        { value: "solve", title: "Solve material confidently", description: "Example: Solve 20 AMC 10 Geometry problems." },
        { value: "improve", title: "Improve my performance", description: "Example: Reach 85% accuracy on 30 fresh algebra problems." },
        { value: "habit", title: "Build a practice routine", description: "Example: Practice 5 problems a day for 14 days." },
    ];

    const SERIES_MATERIAL_OPTIONS: SelectOption[] = [
        { value: "", label: "Choose a competition series" },
    ];
    const TOPIC_MATERIAL_OPTIONS: SelectOption[] = [
        { value: "", label: "Choose a topic" },
        ...TOPICS,
    ];

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
    let intent = $state<Intent>("solve");
    let materialChoice = $state<MaterialChoice>("all");
    let step = $state(1);
    let titleEdited = $state(false);
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
    let draftProgress = $state<GoalProgressResult | null>(null);
    let draftProgressLoading = $state(false);
    let hydratedKey: string | null = null;

    function intentFor(targetType: GoalTargetType): Intent {
        if (targetType.startsWith("attempted")) return "work";
        if (targetType.startsWith("solved")) return "solve";
        if (targetType === "accuracy" || targetType === "speed") return "improve";
        return "habit";
    }

    function defaultTypeFor(nextIntent: Intent): GoalTargetType {
        switch (nextIntent) {
            case "work": return "attempted_count";
            case "solve": return "solved_count";
            case "improve": return "accuracy";
            case "habit": return "streak";
        }
    }

    function chooseIntent(nextIntent: Intent) {
        intent = nextIntent;
        if (intentFor(type) !== nextIntent) type = defaultTypeFor(nextIntent);
    }

    function chooseMaterial(next: MaterialChoice) {
        materialChoice = next;
        if (next === "all") track = createTrackValue();
        if (next === "series") track = { topic: [], seriesIds: [], seriesScopes: {} };
        if (next === "topic") track = { topic: [], seriesIds: [], seriesScopes: {} };
    }

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
            intent = intentFor(type);
            materialChoice = "custom";
            step = 1;
            titleEdited = true;
            fields = known ? fieldsFrom(known) : defaultFields();
            deadline = source.deadline ?? "";
            track = trackFrom(source.scope);
        } else {
            title = "";
            type = "solved_count";
            intent = "solve";
            materialChoice = "all";
            step = 1;
            titleEdited = false;
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
    let reviewedCommitment = $derived(
        goalCommitmentSentence(target, scope, seriesNames, deadline || null),
    );
    let immediatelyAchieved = $derived(draftProgress?.isTargetMet ?? false);
    let canStartPracticing = $derived(
        !invalid && !draftProgressLoading && draftProgress !== null && !immediatelyAchieved && (totalsLoading || totals?.eligibleTotal !== 0),
    );
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

    // The review uses the real family RPCs, not a second browser-side
    // evaluator. That makes existing qualifying work and immediate achievement
    // accurate for volume, accuracy, speed, and streak goals as well as sets.
    $effect(() => {
        if (goal || !open || step !== 5 || invalid) {
            draftProgress = null;
            draftProgressLoading = false;
            return;
        }
        void scopeKey(scope);
        const draft: Goal = {
            id: -1,
            userId,
            title: "Draft goal",
            scope: cloneScope(scope),
            target,
            deadline: deadline || null,
            achievedAt: null,
            archivedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        const plan = planGoalRequests([draft], { now: new Date() });
        let cancelled = false;
        draftProgressLoading = true;
        void fetchGoalProgress(supabase, plan)
            .then((results) => {
                if (cancelled) return;
                draftProgress = evaluateGoals([draft], plan, results).get(draft.id) ?? null;
            })
            .catch(() => {
                if (!cancelled) draftProgress = null;
            })
            .finally(() => {
                if (!cancelled) draftProgressLoading = false;
            });
        return () => {
            cancelled = true;
        };
    });

    function openReview() {
        if (!titleEdited) title = reviewedCommitment.slice(0, 120);
        step = 5;
    }

    async function save(startPracticing = false) {
        if (busy || invalid) return;
        const name = title.trim() || describeTarget(target).slice(0, 120);
        busy = true;
        saveError = null;
        try {
            if (goal) {
                let reopen = false;
                if (material && goal.achievedAt) {
                    reopen = await modal.confirm({
                        title: "Reopen goal",
                        message:
                            "This goal is already achieved. Changing its scope or finish line reopens it and clears the achievement date. Continue?",
                        confirmLabel: "Continue",
                    });
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
                acknowledgeSetGoal();
                open = false;
                onsaved(created, "created");
                if (startPracticing && onstart) await onstart(created);
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

<!-- The body scrolls rather than overflowing: this form grows with the target
     family and the scope Track, and an `overflow-visible` panel ran off the
     bottom of short viewports. The dialog's own `max-h-[90vh]` is the ceiling;
     Select and DatePicker scroll their popovers into view inside it. -->
<Modal
    bind:open
    title={goal ? "Edit goal" : "New goal"}
    size="md"
    class="flex flex-col min-h-120"
>
    {#if goal}
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
    {:else}
        <div class="flex w-full flex-col gap-5">
            <p class="text-xs text-muted-foreground">Step {step} of 5</p>

            {#if step === 1}
                <div class="flex flex-col gap-2">
                    <h3 class="type-section-title">What do you want to do?</h3>
                    <p class="type-secondary text-muted-foreground">Choose the kind of commitment you want to make.</p>
                    {#each INTENTS as choice (choice.value)}
                        <button
                            type="button"
                            class={`rounded-lg border border-border/60 p-3 text-left transition-colors hover:bg-surface-container-low focus-visible:ring-2 focus-visible:ring-ring/50 ${intent === choice.value ? "border-primary bg-primary/10 ring-1 ring-primary/50" : ""}`}
                            aria-pressed={intent === choice.value}
                            onclick={() => chooseIntent(choice.value)}
                        >
                            <span class="flex items-center justify-between gap-3">
                                <span class="text-sm font-medium text-foreground">{choice.title}</span>
                                {#if intent === choice.value}
                                    <span class="rounded-full bg-primary px-2 py-0.5 text-xxs font-semibold text-primary-foreground">✓ Selected</span>
                                {/if}
                            </span>
                            <span class="mt-0.5 block text-xs text-muted-foreground">{choice.description}</span>
                        </button>
                    {/each}
                </div>
            {:else if step === 2}
                <div class="flex flex-col gap-3">
                    <h3 class="type-section-title">Choose the material</h3>
                    <p class="type-secondary text-muted-foreground">This is the material that will count toward your goal.</p>
                    <div class="grid gap-2 sm:grid-cols-2">
                        <Button variant={materialChoice === "all" ? "primary" : "outline"} onclick={() => chooseMaterial("all")}>Everything eligible</Button>
                        <Button variant={materialChoice === "series" ? "primary" : "outline"} onclick={() => chooseMaterial("series")}>A competition series</Button>
                        <Button variant={materialChoice === "topic" ? "primary" : "outline"} onclick={() => chooseMaterial("topic")}>A topic</Button>
                        <Button variant={materialChoice === "custom" ? "primary" : "outline"} onclick={() => chooseMaterial("custom")}>Customize selection</Button>
                    </div>
                    {#if materialChoice === "series"}
                        <Select options={[...SERIES_MATERIAL_OPTIONS, ...seriesOptions]} value={track.seriesIds[0] ?? ""} onchange={(value: string) => (track = { topic: [], seriesIds: value ? [value] : [], seriesScopes: {} })} />
                    {:else if materialChoice === "topic"}
                        <Select options={TOPIC_MATERIAL_OPTIONS} value={track.topic[0] ?? ""} onchange={(value: string) => (track = { topic: value ? [value] : [], seriesIds: [], seriesScopes: {} })} />
                    {:else if materialChoice === "custom"}
                        <Track bind:value={track} {seriesOptions} {supabase} />
                    {/if}
                    {#if totalsLoading}
                        <p class="text-xs text-muted-foreground">Counting the material…</p>
                    {:else if totals}
                        <p class="text-xs text-muted-foreground">{scopeText} · {totals.eligibleTotal} gradeable problems</p>
                    {/if}
                </div>
            {:else if step === 3}
                <div class="flex flex-col gap-3">
                    <h3 class="type-section-title">Set the finish line</h3>
                    {#if intent === "work" || intent === "solve"}
                        <Select options={TYPE_OPTIONS.filter((option) => intent === "work" ? option.value.startsWith("attempted") : option.value.startsWith("solved"))} value={type} onchange={(value: string) => (type = value as GoalTargetType)} />
                    {:else if intent === "improve"}
                        <Select options={TYPE_OPTIONS.filter((option) => option.value === "accuracy" || option.value === "speed")} value={type} onchange={(value: string) => (type = value as GoalTargetType)} />
                    {:else}
                        <Select options={TYPE_OPTIONS.filter((option) => option.value === "volume" || option.value === "streak")} value={type} onchange={(value: string) => (type = value as GoalTargetType)} />
                    {/if}
                    <div class="flex flex-col gap-3">
                        {#if isCountTarget}
                            {@render numberField({ label: "How many problems", value: fields.count, set: (v) => (fields.count = v), min: 1, max: 100000, suffix: totals ? `of ${totals.eligibleTotal} in this material` : undefined })}
                        {:else if type === "attempted_percent" || type === "solved_percent"}
                            {@render numberField({ label: "Share of this material", value: fields.percentage, set: (v) => (fields.percentage = v), min: 1, max: 100, suffix: "%" })}
                        {:else if type === "volume"}
                            {@render numberField({ label: "How many attempts", value: fields.volumeCount, set: (v) => (fields.volumeCount = v), min: 1, max: 100000 })}
                            <Select options={PERIOD_OPTIONS} value={fields.period} onchange={(value: string) => (fields.period = value as PeriodChoice)} />
                            {#if fields.period === "rolling"}{@render numberField({ label: "Window", value: fields.rollingDays, set: (v) => (fields.rollingDays = v), min: 1, max: 365, suffix: "days" })}{/if}
                        {:else if type === "accuracy"}
                            {@render numberField({ label: "Accuracy", value: fields.accuracy, set: (v) => (fields.accuracy = v), min: 1, max: 100, suffix: "%" })}
                            {@render numberField({ label: "Measured over", value: fields.accuracySample, set: (v) => (fields.accuracySample = v), min: 10, max: 500, suffix: "fresh problems" })}
                            <p class="text-xs text-muted-foreground">Fresh problems are ones you have not already graded.</p>
                        {:else if type === "speed"}
                            {@render numberField({ label: "Average time", value: fields.maxSeconds, set: (v) => (fields.maxSeconds = v), min: 1, max: 3600, suffix: "seconds or less" })}
                            {@render numberField({ label: "Measured over", value: fields.speedSample, set: (v) => (fields.speedSample = v), min: 10, max: 500, suffix: "problems" })}
                            {@render numberField({ label: "While staying at least", value: fields.minAccuracy, set: (v) => (fields.minAccuracy = v), min: 1, max: 100, suffix: "% accurate" })}
                        {:else if type === "streak"}
                            {@render numberField({ label: "Days in a row", value: fields.streakDays, set: (v) => (fields.streakDays = v), min: 1, max: 3650, suffix: "days" })}
                            {@render numberField({ label: "Each day, at least", value: fields.perDay, set: (v) => (fields.perDay = v), min: 1, max: 500, suffix: "problems" })}
                        {/if}
                    </div>
                    {#if invalid}<p class="text-xs text-destructive">{invalid}</p>{/if}
                </div>
            {:else if step === 4}
                <div class="flex flex-col gap-3">
                    <h3 class="type-section-title">Add a planning date?</h3>
                    <p class="type-secondary text-muted-foreground">Optional. Passing this date does not erase the goal or your progress.</p>
                    <DatePicker bind:value={deadline} placeholder="No planning date" />
                </div>
            {:else}
                <div class="flex flex-col gap-3">
                    <h3 class="type-section-title" tabindex="-1">Review your commitment</h3>
                    <div class="flex flex-col gap-1.5">
                        <span class="text-xs font-medium text-muted-foreground">Your commitment</span>
                        <Input bind:value={title} oninput={() => (titleEdited = true)} maxlength={120} />
                        <p class="text-xxs text-muted-foreground">Editing these words changes the label, not what counts toward the goal.</p>
                    </div>
                    <div class="rounded-lg border border-border/60 bg-surface-container-low/50 p-3">
                        <p class="type-secondary text-foreground">{reviewedCommitment}</p>
                        {#if draftProgressLoading || totalsLoading}<p class="mt-1 text-xs text-muted-foreground">Counting current work…</p>
                        {:else if alreadyCounts}<p class="mt-1 text-xs text-muted-foreground">{alreadyCounts}</p>
                        {:else if draftProgress}<p class="mt-1 text-xs text-muted-foreground">So far: {progressSummary(draftProgress)}.</p>
                        {:else if totals}<p class="mt-1 text-xs text-muted-foreground">{totals.eligibleTotal} gradeable problems are in this material.</p>{/if}
                        {#if immediatelyAchieved}<p class="mt-2 text-xs text-correct">Your existing work already completes this goal. It will be marked achieved when you create it.</p>{/if}
                    </div>
                    {#if saveError}<p class="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">{saveError}</p>{/if}
                </div>
            {/if}
        </div>
    {/if}

    {#snippet footer()}
        <Button variant="ghost" size="sm" onclick={() => (open = false)}>Cancel</Button>
        {#if goal}
            <Button size="sm" variant="primary" onclick={() => save()} disabled={busy || Boolean(invalid)}>Save</Button>
        {:else if step < 5}
            {#if step > 1}<Button size="sm" variant="outline" onclick={() => (step -= 1)}>Back</Button>{/if}
            <Button size="sm" variant="primary" onclick={() => step === 4 ? openReview() : (step += 1)} disabled={step === 3 && Boolean(invalid)}>Continue</Button>
        {:else}
            <Button size="sm" variant="outline" onclick={() => (step = 4)} disabled={busy}>Back</Button>
            {#if canStartPracticing}
                <Button size="sm" variant="outline" onclick={() => save(true)} disabled={busy}>Create and start practicing</Button>
            {/if}
            <Button size="sm" variant="primary" onclick={() => save()} disabled={busy || Boolean(invalid)}>Create goal</Button>
        {/if}
    {/snippet}
</Modal>
