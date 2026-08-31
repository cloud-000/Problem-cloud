<script lang="ts">
    import type { PageData } from "./$types";
    import { afterNavigate, goto, replaceState } from "$app/navigation";
    import { resolve } from "$app/paths";
    import { page } from "$app/state";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import * as Page from "$lib/components/page";
    import { Switch } from "$lib/components/toggle";
    import {
        archiveGoal,
        dataForGoal,
        deleteGoal,
        evaluateGoals,
        fetchGoalProgress,
        fetchGoals,
        goalStatus,
        planGoalRequests,
        setPrimaryGoal,
        stampAchievedGoals,
        type Goal,
        type GoalFamilyResults,
        type GoalProgressResult,
        type GoalRequestPlan,
        type GoalProgressData,
    } from "$lib/goals";
    import { fetchAllSeries } from "$lib/library";
    import { startSession } from "$lib/sessions";
    import { toasts } from "$lib/state/toast.svelte";
    import { modal } from "$lib/state/modal.svelte";
    import GoalCard from "./GoalCard.svelte";
    import GoalDetail from "./GoalDetail.svelte";
    import GoalForm from "./GoalForm.svelte";
    import { practiceSessionName, practiceSettingsForGoal } from "$lib/goals/practice";
    import { sortGoals, type SeriesNames } from "$lib/goals/presentation";
    import { attentionGoal, primaryGoal, type GoalSnapshot } from "$lib/goals/promote";
    import {
        CONTEXTUAL_TIP,
        acknowledgeTip,
        acknowledgeTipInState,
        contextualTipCopy,
        emptyOnboarding,
        fetchOnboarding,
        shouldShowTip,
        type OnboardingState,
    } from "$lib/onboarding";
    import ContextualTip from "../ContextualTip.svelte";

    let { data }: { data: PageData } = $props();
    let { supabase, user } = $derived(data);

    let onboarding = $state<OnboardingState>(emptyOnboarding());

    let goals = $state<Goal[]>([]);
    // The plan and its results move together: a plan whose results have not
    // arrived would evaluate every goal to null and flash "unmeasured" cards.
    let evaluation = $state<{ plan: GoalRequestPlan; results: GoalFamilyResults } | null>(
        null,
    );
    let loading = $state(true);
    let errorMsg = $state<string | null>(null);
    let busy = $state(false);
    let showArchived = $state(false);
    let seriesOptions = $state<{ value: string; label: string }[]>([]);
    let seriesNames = $derived<SeriesNames>(
        new Map(seriesOptions.map((option) => [option.value, option.label])),
    );

    // One "now" per render pass, shared by every card: two goals whose deadlines
    // were read a millisecond apart would be inconsistent for no reason.
    let now = $state(new Date());

    let formOpen = $state(false);
    let editing = $state<Goal | null>(null);

    let selectedId = $derived.by(() => {
        const raw = page.url.searchParams.get("goal");
        const id = raw === null ? Number.NaN : Number(raw);
        return Number.isFinite(id) ? id : null;
    });
    let selected = $derived(goals.find((goal) => goal.id === selectedId) ?? null);

    let progress = $derived.by<Map<number, GoalProgressResult | null>>(() =>
        evaluation
            ? evaluateGoals(goals, evaluation.plan, evaluation.results)
            : new Map(),
    );

    /** Raw family data is passed alongside the normalized result so each
     * family-specific progress treatment can show the dimensions that matter. */
    function familyDataFor(goal: Goal): GoalProgressData {
        if (!evaluation) return {};
        return dataForGoal(goal, evaluation.plan, evaluation.results);
    }

    let visible = $derived(
        sortGoals(goals).filter(
            (goal) => showArchived || goalStatus(goal) !== "archived",
        ),
    );
    let archivedCount = $derived(
        goals.filter((goal) => goalStatus(goal) === "archived").length,
    );
    let mainGoal = $derived(primaryGoal(goals));
    let goalSnapshots = $derived.by<GoalSnapshot[]>(() =>
        goals.map((goal) => {
            const slot = evaluation?.plan.slots.get(goal.id);
            return {
                goal,
                result: progress.get(goal.id) ?? null,
                familyData: familyDataFor(goal),
                period:
                    slot?.family === "period"
                        ? (evaluation?.results.period?.[slot.index] ?? null)
                        : null,
            };
        }),
    );
    let attention = $derived(attentionGoal(goalSnapshots, now));
    let attentionGoalId = $derived(
        attention?.goal.id !== mainGoal?.id ? (attention?.goal.id ?? null) : null,
    );
    let otherVisible = $derived(
        visible.filter((goal) => goal.id !== mainGoal?.id && goal.id !== attentionGoalId),
    );
    let showGoalTip = $derived(
        shouldShowTip(
            onboarding.acknowledgedTips,
            CONTEXTUAL_TIP.firstGoal,
            !loading && goals.length > 0,
        ),
    );

    async function load() {
        if (!user) {
            loading = false;
            return;
        }
        loading = true;
        try {
            // Archived goals are fetched too: they stay readable, and a detail
            // link to one must not 404 just because the list hides it.
            const rows = await fetchGoals(supabase, { includeArchived: true });
            now = new Date();
            const plan = planGoalRequests(rows, { now });
            const results = await fetchGoalProgress(supabase, plan);
            goals = rows;
            evaluation = { plan, results };
            errorMsg = null;
            await stampAchievements();
        } catch (error) {
            errorMsg = (error as Error).message || "Failed to load goals";
        } finally {
            loading = false;
        }
    }

    /**
     * Stamp every finish line that is met but unrecorded, through the shared
     * helper the home page also uses — one definition of "just crossed the
     * line". A goal that existing work already satisfies is achieved the moment
     * it is created, because creation reloads through here (`docs/goals.md` §7).
     */
    async function stampAchievements() {
        const outcome = await stampAchievedGoals(supabase, goals, progress);
        goals = outcome.goals;
        for (const goal of outcome.stamped) {
            toasts.success(goal.title, { title: "Goal achieved" });
        }
    }

    $effect(() => {
        void load();
    });

    $effect(() => {
        if (!user) return;
        const client = supabase;
        const userId = user.id;
        let cancelled = false;
        fetchOnboarding(client, userId)
            .then((state) => {
                if (!cancelled) onboarding = state;
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    });

    $effect(() => {
        let cancelled = false;
        fetchAllSeries(supabase)
            .then((series) => {
                if (cancelled) return;
                seriesOptions = series.map((s) => ({
                    value: String(s.id),
                    label: s.name,
                }));
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    });

    // `?new=1` is a one-shot command, not state: home's empty state links here
    // to open the dialog, so consume it and replace the history entry with a
    // clean URL — otherwise Back, or a reload, re-opens the dialog forever.
    // (Same treatment the trainer gives its launch params.)
    afterNavigate(() => {
        if (page.url.searchParams.get("new") !== "1") return;
        const cleaned = new URL(page.url);
        cleaned.searchParams.delete("new");
        replaceState(
            resolve(
                cleaned.search
                    ? (`/goals${cleaned.search}` as `/goals?${string}`)
                    : "/goals",
            ),
            page.state,
        );
        openCreate();
    });

    function openGoal(goal: Goal) {
        void goto(resolve(`/goals?goal=${goal.id}`));
    }

    function closeGoal() {
        void goto(resolve("/goals"));
    }

    function openCreate() {
        editing = null;
        formOpen = true;
    }

    function dismissGoalTip() {
        onboarding = acknowledgeTipInState(onboarding, CONTEXTUAL_TIP.firstGoal);
        acknowledgeTip(CONTEXTUAL_TIP.firstGoal);
    }

    function openEdit(goal: Goal) {
        editing = goal;
        formOpen = true;
    }

    function onSaved(goal: Goal, kind: "created" | "updated") {
        editing = null;
        toasts.success(goal.title, {
            title: kind === "created" ? "Goal created" : "Goal saved",
        });
        // Reload rather than splice: a new or edited goal needs evaluating, and
        // the batched plan is what evaluates it.
        void load();
    }

    /**
     * The handoff: the goal's scope, handed to the trainer unchanged, filtered
     * to what the goal still needs (`$lib/goals/practice`). Same session-creation
     * path as every other surface — `startSession` then `/practice?session=<id>`.
     */
    async function practiceGoal(goal: Goal) {
        if (!user || busy) return;
        busy = true;
        try {
            const session = await startSession(supabase, user.id, {
                name: practiceSessionName(goal),
                settings: practiceSettingsForGoal(goal),
            });
            await goto(resolve(`/practice?session=${session.id}`));
        } catch (error) {
            errorMsg = (error as Error).message || "Failed to start practice";
            busy = false;
        }
    }

    async function setArchived(goal: Goal, archived: boolean) {
        if (busy) return;
        busy = true;
        try {
            await archiveGoal(supabase, goal.id, archived);
            await load();
        } catch (error) {
            errorMsg = (error as Error).message || "Failed to archive the goal";
        } finally {
            busy = false;
        }
    }

    async function makePrimary(goal: Goal) {
        if (busy || goalStatus(goal) !== "active") return;
        busy = true;
        try {
            await setPrimaryGoal(supabase, goal.id);
            await load();
        } catch (error) {
            errorMsg = (error as Error).message || "Failed to set your main goal";
        } finally {
            busy = false;
        }
    }

    async function removeGoal(goal: Goal) {
        if (busy) return;
        if (
            !(await modal.confirm({
                title: "Delete goal",
                message: `Delete "${goal.title}"? This is permanent — archiving keeps it readable instead.`,
                confirmLabel: "Delete",
                confirmVariant: "destructive",
            }))
        )
            return;
        busy = true;
        try {
            await deleteGoal(supabase, goal.id);
            if (selectedId === goal.id) await goto(resolve("/goals"));
            await load();
        } catch (error) {
            errorMsg = (error as Error).message || "Failed to delete the goal";
        } finally {
            busy = false;
        }
    }
</script>

<svelte:head><title>Goals · ProblemCloud</title></svelte:head>

{#if !user}
    <Page.Root width="standard">
        <Page.Header
            title="Goals"
            description="Commit to a finish line on a slice of the catalog, and see what already counts toward it."
        />
        <div class="flex flex-col items-start gap-4 border-t border-border/60 py-10">
            <p class="type-secondary text-muted-foreground">
                Sign in to set goals and track them against your own work.
            </p>
            <Button href="/auth/login">Log in</Button>
        </div>
    </Page.Root>
{:else if selectedId !== null && selected}
    <GoalDetail
        goal={selected}
        result={progress.get(selected.id) ?? null}
        data={familyDataFor(selected)}
        {seriesNames}
        {now}
        {busy}
        onback={closeGoal}
        onpractice={practiceGoal}
        onedit={openEdit}
        onmakeprimary={makePrimary}
        onarchive={setArchived}
        ondelete={removeGoal}
    />
{:else}
    <Page.Root width="standard">
        <Page.Header
            title="Goals"
            description="A commitment to reach a stated finish line on a defined slice of the catalog."
        >
            {#snippet actions()}
                <Button size="lg" onclick={openCreate} disabled={busy}>
                    <Icon name="add" class="size-[1em]" />
                    New goal
                </Button>
            {/snippet}
        </Page.Header>

        {#if selectedId !== null && !loading}
            <p class="type-secondary text-muted-foreground">
                That goal no longer exists.
                <button
                    type="button"
                    class="underline underline-offset-2"
                    onclick={closeGoal}>Back to all goals</button
                >
            </p>
        {/if}

        {#if errorMsg}
            <p class="rounded-lg bg-destructive/10 p-4 type-secondary text-destructive">
                {errorMsg}
            </p>
        {/if}

        {#if loading}
            <div
                class="flex items-center justify-center gap-2 py-16 type-secondary text-muted-foreground"
            >
                <Icon name="progress_activity" class="animate-spin" />
                Loading goals…
            </div>
        {:else if visible.length === 0}
            <div class="flex flex-col items-start gap-4 border-t border-border/60 py-12">
                <!-- Same measure as Page.Header's own title + description block:
                     this is the same kind of prose, directly beneath it, and a
                     tighter cap made it wrap noticeably short of the page. -->
                <div class="max-w-3xl">
                    <h2 class="type-section-title text-foreground">
                        {archivedCount > 0 ? "No active goals" : "No goals yet"}
                    </h2>
                    <p class="mt-1 type-secondary text-muted-foreground">
                        A goal is a finish line on a slice of the catalog — 80% of
                        AMC 10 geometry, 100 problems this month, a two-week
                        streak. Everything you have already done counts toward it
                        from the moment you set it.
                    </p>
                </div>
                <Button onclick={openCreate}>Set your first goal</Button>
            </div>
        {:else}
            {#if showGoalTip}
                <ContextualTip
                    body={contextualTipCopy(CONTEXTUAL_TIP.firstGoal).body}
                    ondismiss={dismissGoalTip}
                />
            {/if}
            <div class="border-t border-border/60">
                {#if mainGoal}
                    <section class="border-b border-border/60 py-5">
                        <h2 class="type-section-title text-foreground">Your main goal</h2>
                        <GoalCard
                            goal={mainGoal}
                            result={progress.get(mainGoal.id) ?? null}
                            data={familyDataFor(mainGoal)}
                            {seriesNames}
                            {now}
                            {busy}
                            onopen={openGoal}
                            onpractice={practiceGoal}
                        />
                    </section>
                {/if}
                {#if attention && attentionGoalId !== null}
                    <section class="border-b border-border/60 py-5">
                        <h2 class="type-section-title text-foreground">Needs attention</h2>
                        <GoalCard
                            goal={attention.goal}
                            result={attention.result}
                            data={attention.familyData}
                            {seriesNames}
                            {now}
                            {busy}
                            onopen={openGoal}
                            onpractice={practiceGoal}
                        />
                    </section>
                {/if}
                {#if otherVisible.length > 0}
                    {#if mainGoal || attentionGoalId !== null}
                        <h2 class="pt-5 type-section-title text-foreground">Other goals</h2>
                    {/if}
                    {#each otherVisible as goal (goal.id)}
                        <GoalCard
                            {goal}
                            result={progress.get(goal.id) ?? null}
                            data={familyDataFor(goal)}
                            {seriesNames}
                            {now}
                            {busy}
                            onopen={openGoal}
                            onpractice={practiceGoal}
                        />
                    {/each}
                {/if}
            </div>
        {/if}

        {#if archivedCount > 0}
            <div class="flex items-center justify-between gap-3 pt-2">
                <span class="type-secondary text-muted-foreground">
                    Show archived ({archivedCount})
                </span>
                <Switch bind:checked={showArchived} size="sm" />
            </div>
        {/if}
    </Page.Root>
{/if}

{#if user}
    <GoalForm
        bind:open={formOpen}
        {supabase}
        userId={user.id}
        {seriesOptions}
        {seriesNames}
        goal={editing}
        onsaved={onSaved}
        onstart={practiceGoal}
    />
{/if}
