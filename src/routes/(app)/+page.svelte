<script lang="ts">
    import type { PageData } from "./$types";
    import { onMount } from "svelte";
    import { resolve } from "$app/paths";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import * as Page from "$lib/components/page";
    import { toasts } from "$lib/state/toast.svelte";
    import { fetchAllSeries, fetchPlayerRating, type PlayerRating } from "$lib/library";
    import {
        fetchProblemStateSummary,
        type ProblemStateSummary,
    } from "$lib/progress";
    import {
        fetchSessions,
        startSession,
        type PracticeSessionRow,
    } from "$lib/sessions";
    import {
        evaluateGoals,
        dataForGoal,
        fetchGoalProgress,
        fetchGoals,
        planGoalRequests,
        stampAchievedGoals,
        type Goal,
        type GoalFamilyResults,
        type GoalRequestPlan,
    } from "$lib/goals";
    import { practiceSessionName, practiceSettingsForGoal } from "$lib/goals/practice";
    import type { SeriesNames } from "$lib/goals/presentation";
    import {
        attentionGoal,
        primaryGoal,
        promoteGoals,
        type GoalSnapshot,
        type PromotedGoal,
    } from "$lib/goals/promote";
    import { goto } from "$app/navigation";
    import {
        decideNextUp,
        homeProgressMetrics,
        type NextUpAction,
    } from "$lib/home-next";
    import {
        completeTourStep,
        completeWelcome,
        decideHomePresentation,
        emptyOnboarding,
        fetchOnboarding,
        hasProductHistory,
        resumeTourStep,
        saveOnboarding,
        skipWelcome,
        startTour,
        type OnboardingState,
    } from "$lib/onboarding";
    import { cn } from "$lib/utils";
    import HomeGoalRow from "./HomeGoalRow.svelte";
    import TourView from "./TourView.svelte";

    let { data }: { data: PageData } = $props();
    let { supabase, user, profile } = $derived(data);

    let rating = $state<PlayerRating | null>(null);
    let summary = $state<ProblemStateSummary | null>(null);
    let activeSession = $state<PracticeSessionRow | null>(null);
    let loading = $state(true);
    let onboarding = $state<OnboardingState>(emptyOnboarding());
    let onboardingFailed = $state(false);
    let tourExitedThisVisit = $state(false);

    // Goals are loaded on their own, not inside `loadHome`: they are the one
    // section that can fail without costing the student anything else on the
    // page, and a full-catalog scope resolution should never hold up the rest.
    let goals = $state<Goal[]>([]);
    let goalEvaluation = $state<{
        plan: GoalRequestPlan;
        results: GoalFamilyResults;
    } | null>(null);
    let goalsLoaded = $state(false);
    let startingGoal = $state(false);
    // One "now" for every goal in a render pass.
    let goalsNow = $state(new Date());

    // Series names for rendering goal scopes. Fetched only when a goal actually
    // names a series — a student whose goals are all whole-catalog should not
    // pay for the series list to render the words "the whole catalog".
    let seriesNames = $state<SeriesNames>(new Map());

    /**
     * What the promoter needs: each goal's evaluated result, plus the raw period
     * row for streaks. `todayCount` never reaches `GoalProgressResult` — "how
     * many more today" is the most actionable number on this page and cannot be
     * derived from a streak length, so it is read from the family data directly
     * (as `types.ts` says surfaces wanting it should).
     */
    let goalSnapshots = $derived.by<GoalSnapshot[]>(() => {
        const evaluation = goalEvaluation;
        if (!evaluation) return [];
        const progress = evaluateGoals(goals, evaluation.plan, evaluation.results);
        return goals.map((goal) => {
            const slot = evaluation.plan.slots.get(goal.id);
            return {
                goal,
                result: progress.get(goal.id) ?? null,
                familyData: dataForGoal(goal, evaluation.plan, evaluation.results),
                period:
                    slot?.family === "period"
                        ? (evaluation.results.period?.[slot.index] ?? null)
                        : null,
            };
        });
    });

    // Destination and urgency deliberately answer different questions. The
    // primary remains stable while `attention` identifies the commitment with
    // the strongest reason to act today.
    let mainGoal = $derived(primaryGoal(goals));
    let attention = $derived(attentionGoal(goalSnapshots, goalsNow));
    let mainEntry = $derived.by<PromotedGoal | null>(() => {
        if (!mainGoal) return null;
        return (
            goalSnapshots
                .map((snapshot) => promoteGoals([snapshot], goalsNow, 1)[0] ?? null)
                .find((entry) => entry?.goal.id === mainGoal.id) ?? {
                goal: mainGoal,
                result: goalSnapshots.find((snapshot) => snapshot.goal.id === mainGoal.id)?.result ?? null,
                reason: "remaining",
            }
        );
    });
    let attentionEntry = $derived(
        attention?.goal.id !== mainGoal?.id ? attention : null,
    );

    let next = $derived(
        decideNextUp({
            session: activeSession,
            reviewDue: summary?.review_due ?? 0,
            leadGoal: mainEntry,
            goalsReady: goalsLoaded,
        }),
    );
    let progressMetrics = $derived(
        homeProgressMetrics({
            summary,
            rating,
            nextUpKind: next.action.kind,
        }),
    );
    let goalAction = $derived(
        next.action.kind === "goal_practice" ? next.action : null,
    );
    let presentation = $derived.by(() => {
        if (onboardingFailed) return "home" as const;
        if (loading) return null;
        const decided = decideHomePresentation({
            status: onboarding.welcomeStatus,
            hasProductHistory: hasProductHistory({
                attempted: summary?.attempted ?? 0,
                seen: summary?.seen ?? 0,
                sessionTimesSeen: activeSession?.times_seen ?? 0,
            }),
        });
        if (decided === "introduction" && tourExitedThisVisit) return "home";
        return decided;
    });

    async function loadGoals() {
        if (!user) {
            goalsLoaded = true;
            return;
        }
        try {
            const rows = await fetchGoals(supabase);
            goalsNow = new Date();
            const plan = planGoalRequests(rows, { now: goalsNow });
            const results = await fetchGoalProgress(supabase, plan);
            // Home stamps achievements too, through the same helper the goals
            // page uses: the student should see "Achieved" on the screen they
            // open first, and the write is idempotent so both surfaces racing is
            // a non-event.
            const outcome = await stampAchievedGoals(
                supabase,
                rows,
                evaluateGoals(rows, plan, results),
            );
            goals = outcome.goals;
            goalEvaluation = { plan, results };
            for (const goal of outcome.stamped) {
                toasts.success(goal.title, { title: "Goal achieved" });
            }
            if (rows.some((goal) => (goal.scope.seriesIds ?? []).length > 0)) {
                const series = await fetchAllSeries(supabase);
                seriesNames = new Map(
                    series.map((row) => [String(row.id), row.name]),
                );
            }
        } catch {
            // Deliberately quiet: a goals section that could not load is a
            // missing section, not a broken home page.
            goals = [];
            goalEvaluation = null;
        } finally {
            goalsLoaded = true;
        }
    }

    /** The same handoff the goals page uses — the goal's scope, narrowed to what
     * it still needs, as a named session. */
    async function practiceGoal(goal: Goal) {
        if (!user || startingGoal) return;
        startingGoal = true;
        try {
            const session = await startSession(supabase, user.id, {
                name: practiceSessionName(goal),
                settings: practiceSettingsForGoal(goal),
            });
            await goto(resolve(`/practice?session=${session.id}`));
        } catch (e) {
            toasts.error((e as Error).message || "Failed to start practice.");
            startingGoal = false;
        }
    }

    async function persistOnboarding(state: OnboardingState) {
        onboarding = state;
        if (!user) return;
        try {
            await saveOnboarding(supabase, user.id, state);
        } catch {
            // Acknowledgement is best-effort: a failed write must never block Home.
        }
    }

    function nowIso() {
        return new Date().toISOString();
    }

    function skipOnboarding() {
        void persistOnboarding(skipWelcome(onboarding, nowIso()));
    }

    function closeTour() {
        tourExitedThisVisit = true;
    }

    function advanceTour(completedIndex: number) {
        void persistOnboarding(completeTourStep(onboarding, completedIndex));
    }

    function finishTour() {
        void persistOnboarding(completeWelcome(onboarding, nowIso()));
    }

    async function loadHome() {
        if (!user) {
            loading = false;
            onboardingFailed = true;
            return;
        }

        loading = true;
        onboardingFailed = false;
        try {
            const [nextRating, nextSummary, activeSessions, nextOnboarding] =
                await Promise.all([
                    fetchPlayerRating(supabase, user.id),
                    fetchProblemStateSummary(supabase),
                    fetchSessions(supabase, { status: "active" }),
                    fetchOnboarding(supabase, user.id).catch(() => {
                        onboardingFailed = true;
                        return emptyOnboarding();
                    }),
                ]);

            rating = nextRating;
            summary = nextSummary;
            activeSession = activeSessions[0] ?? null;
            if (!onboardingFailed) {
                onboarding = nextOnboarding;
                if (nextOnboarding.welcomeStatus === "unseen") {
                    const history = hasProductHistory({
                        attempted: nextSummary?.attempted ?? 0,
                        seen: nextSummary?.seen ?? 0,
                        sessionTimesSeen: activeSession?.times_seen ?? 0,
                    });
                    void persistOnboarding(
                        history
                            ? skipWelcome(nextOnboarding, nowIso())
                            : startTour(nextOnboarding, nowIso()),
                    );
                }
            }
        } catch (e) {
            toasts.error((e as Error).message || "Failed to load your home page.");
        } finally {
            loading = false;
        }
    }

    onMount(() => {
        void loadHome();
        void loadGoals();
    });

    function nextHref(action: NextUpAction): string | undefined {
        switch (action.kind) {
            case "continue_session":
                return resolve(`/practice?session=${action.sessionId}`);
            case "review_due":
                return resolve("/progress?view=review");
            case "start_practice":
                return resolve("/practice");
            default:
                return undefined;
        }
    }

    function relativeDate(value: string) {
        const date = new Date(value);
        const today = new Date();
        const startToday = new Date(
            today.getFullYear(),
            today.getMonth(),
            today.getDate(),
        );
        const startDate = new Date(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
        );
        const days = Math.round(
            (startToday.getTime() - startDate.getTime()) / 86_400_000,
        );

        if (days === 0) return "Today";
        if (days === 1) return "Yesterday";
        return new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
        }).format(date);
    }
</script>

{#if loading}
    <Page.Root width="standard">
        <div
            class="flex min-h-40 items-center justify-center gap-2 type-secondary text-muted-foreground"
            aria-live="polite"
        >
            <Icon name="progress_activity" class="animate-spin" />
            Loading your next step…
        </div>
    </Page.Root>
{:else if presentation === "introduction"}
    <TourView
        initialStep={resumeTourStep(onboarding.lastCompletedTourStep)}
        username={profile?.username ?? null}
        onskip={skipOnboarding}
        onclose={closeTour}
        onadvance={advanceTour}
        onfinish={finishTour}
    />
{:else}
    <Page.Root width="standard">
        <Page.Header
            title={`Welcome back${profile?.username ? `, ${profile.username}` : ""}`}
        />
        <div class="flex flex-col gap-10">
            <section
                aria-labelledby="next-up-title"
                class="flex flex-col gap-5 rounded-xl border border-border bg-surface-container-lowest p-5 sm:p-6"
            >
                <div
                    class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
                >
                    <div>
                        <h2 id="next-up-title" class="type-section-title">
                            {next.work.title}
                        </h2>
                        {#if next.work.detail}
                            <p class="mt-1 type-secondary text-muted-foreground">
                                {next.work.detail}
                            </p>
                        {/if}
                    </div>

                    {#if next.work.lastActiveAt}
                        <span class="type-caption text-muted-foreground">
                            Active {relativeDate(next.work.lastActiveAt)}
                        </span>
                    {/if}
                </div>

                {#if next.commitment.kind === "goal"}
                    <HomeGoalRow
                        entry={next.commitment.entry}
                        {seriesNames}
                        now={goalsNow}
                        busy={startingGoal}
                        onpractice={practiceGoal}
                        showAction={false}
                        hideFallbackCaption
                        class="border-t border-border/60 pt-5"
                    />
                {:else if next.commitment.kind === "invitation"}
                    <p
                        class="border-t border-border/60 pt-5 type-secondary text-muted-foreground"
                    >
                        No goal yet —
                        <a
                            href={resolve("/goals?new=1")}
                            class="text-foreground underline decoration-border underline-offset-4 hover:text-foreground"
                        >
                            Set a direction
                        </a>
                        when you are ready
                    </p>
                {/if}

                <div>
                    {#if goalAction}
                        <Button
                            class="max-sm:w-full"
                            onclick={() => {
                                if (goalAction) void practiceGoal(goalAction.goal);
                            }}
                            disabled={startingGoal}
                        >
                            {goalAction.label}
                            <Icon name="arrow_forward" />
                        </Button>
                    {:else}
                        <Button href={nextHref(next.action)} class="max-sm:w-full">
                            {next.action.label}
                            <Icon name="arrow_forward" />
                        </Button>
                    {/if}
                </div>
            </section>

            {#if attentionEntry}
                <Page.Section title="Needs attention">
                    {#snippet actions()}
                        <Button href={resolve("/goals")} variant="ghost" size="sm">
                            All goals
                            <Icon name="arrow_forward" />
                        </Button>
                    {/snippet}

                    <div class="divide-y divide-border border-y border-border">
                        <HomeGoalRow
                            entry={attentionEntry}
                            {seriesNames}
                            now={goalsNow}
                            busy={startingGoal}
                            onpractice={practiceGoal}
                            class="py-4"
                        />
                    </div>
                </Page.Section>
            {/if}

            {#if progressMetrics.length > 0}
                <Page.Section title="Progress">
                    {#snippet actions()}
                        <Button href={resolve("/progress")} variant="ghost" size="sm">
                            View progress
                            <Icon name="arrow_forward" />
                        </Button>
                    {/snippet}

                    <dl
                        class={cn(
                            "grid border-y border-border",
                            progressMetrics.length > 1 &&
                                "sm:divide-x sm:divide-border",
                            progressMetrics.length === 2 && "sm:grid-cols-2",
                            progressMetrics.length >= 3 && "sm:grid-cols-3",
                        )}
                    >
                        {#each progressMetrics as metric, index (metric.key)}
                            <div
                                class={[
                                    "py-4",
                                    index > 0 && "border-t border-border sm:border-t-0",
                                    progressMetrics.length > 1 &&
                                        (index === 0
                                            ? "sm:pr-5"
                                            : index === progressMetrics.length - 1
                                              ? "sm:pl-5"
                                              : "sm:px-5"),
                                ]}
                            >
                                <dt class="type-caption text-muted-foreground">
                                    {metric.label}
                                </dt>
                                <dd class="mt-1 type-display text-foreground">
                                    {metric.value}
                                </dd>
                                {#if metric.caption}
                                    <p class="mt-1 type-caption text-muted-foreground">
                                        {metric.caption}
                                    </p>
                                {/if}
                            </div>
                        {/each}
                    </dl>
                </Page.Section>
            {/if}
        </div>
    </Page.Root>
{/if}
