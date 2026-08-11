<script lang="ts">
    import type { PageData } from "./$types";
    import { goto } from "$app/navigation";
    import { resolve } from "$app/paths";
    import { page } from "$app/state";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import * as Page from "$lib/components/page";
    import { Switch } from "$lib/components/toggle";
    import {
        archiveGoal,
        deleteGoal,
        evaluateGoals,
        fetchGoalProgress,
        fetchGoals,
        goalStatus,
        markGoalAchieved,
        planGoalRequests,
        type Goal,
        type GoalFamilyResults,
        type GoalRequestPlan,
        type GoalProgressResult,
        type SetData,
    } from "$lib/goals";
    import { fetchAllSeries } from "$lib/library";
    import { startSession } from "$lib/sessions";
    import { toasts } from "$lib/state/toast.svelte";
    import GoalCard from "./GoalCard.svelte";
    import GoalDetail from "./GoalDetail.svelte";
    import GoalForm from "./GoalForm.svelte";
    import { practiceSessionName, practiceSettingsForGoal } from "./goal-practice";
    import { newlyAchieved, sortGoals, type SeriesNames } from "./goal-presentation";

    let { data }: { data: PageData } = $props();
    let { supabase, user } = $derived(data);

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

    /** The raw family row behind a goal, for the surfaces that need more than
     * `GoalProgressResult` (the set family's remaining count). */
    function setDataFor(goal: Goal): SetData | null {
        const slot = evaluation?.plan.slots.get(goal.id);
        if (!evaluation || !slot || slot.family !== "set") return null;
        return evaluation.results.set?.[slot.index] ?? null;
    }

    let visible = $derived(
        sortGoals(goals).filter(
            (goal) => showArchived || goalStatus(goal) !== "archived",
        ),
    );
    let archivedCount = $derived(
        goals.filter((goal) => goalStatus(goal) === "archived").length,
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
     * Stamp every finish line that is met but unrecorded. The write is
     * idempotent and first-writer-wins (`markGoalAchieved`), so a second tab
     * doing this at the same moment cannot move an existing date — and a goal
     * that existing work already satisfies is achieved the moment it is created,
     * because creation reloads through here (`docs/goals.md` §7).
     */
    async function stampAchievements() {
        const ids = newlyAchieved(goals, progress);
        if (ids.length === 0) return;
        const stamped = await Promise.all(
            ids.map((id) =>
                markGoalAchieved(supabase, id).catch(() => null),
            ),
        );
        const byId = new Map(
            stamped.filter((row): row is Goal => row !== null).map((row) => [row.id, row]),
        );
        if (byId.size === 0) return;
        goals = goals.map((goal) => byId.get(goal.id) ?? goal);
        for (const goal of byId.values()) {
            toasts.success(goal.title, { title: "Goal achieved" });
        }
    }

    $effect(() => {
        void load();
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
     * to what the goal still needs (`goal-practice.ts`). Same session-creation
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

    async function removeGoal(goal: Goal) {
        if (busy) return;
        if (
            !window.confirm(
                `Delete "${goal.title}"? This is permanent — archiving keeps it readable instead.`,
            )
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
        setData={setDataFor(selected)}
        {seriesNames}
        {now}
        {busy}
        onback={closeGoal}
        onpractice={practiceGoal}
        onedit={openEdit}
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
                <div class="max-w-xl">
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
            <div class="border-t border-border/60">
                {#each visible as goal (goal.id)}
                    <GoalCard
                        {goal}
                        result={progress.get(goal.id) ?? null}
                        {seriesNames}
                        {now}
                        {busy}
                        onopen={openGoal}
                        onpractice={practiceGoal}
                    />
                {/each}
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
    />
{/if}
