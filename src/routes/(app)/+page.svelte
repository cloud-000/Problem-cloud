<script lang="ts">
    import type { PageData } from "./$types";
    import { onMount, untrack } from "svelte";
    import { resolve } from "$app/paths";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import * as Page from "$lib/components/page";
    import { toasts } from "$lib/state/toast.svelte";
    import {
        fetchAllSeries,
        fetchByIds,
        fetchPlayerRating,
        playerRatingIsProvisional,
        topicLabel,
        type PlayerRating,
        type SeriesRow,
    } from "$lib/library";
    import {
        fetchProblemStateSummary,
        fetchRecentSubmissions,
        type ProblemStateSummary,
        type RecentSubmissionRow,
    } from "$lib/progress";
    import {
        fetchSessions,
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
    import { promoteGoals, type GoalSnapshot } from "$lib/goals/promote";
    import { startSession } from "$lib/sessions";
    import { goto } from "$app/navigation";
    import { fetchFocusedSeriesWorklist, type WorklistItem } from "$lib/home";
    import FocusedSeriesChips from "./FocusedSeriesChips.svelte";
    import FocusedSeriesStats from "./FocusedSeriesStats.svelte";
    import FocusedWorklist from "./FocusedWorklist.svelte";
    import HomeGoalRow from "./HomeGoalRow.svelte";

    let { data }: { data: PageData } = $props();
    let { supabase, user, profile } = $derived(data);

    let rating = $state<PlayerRating | null>(null);
    let summary = $state<ProblemStateSummary | null>(null);
    let activeSession = $state<PracticeSessionRow | null>(null);
    let recentSubmissions = $state<RecentSubmissionRow[]>([]);
    let loading = $state(true);

    // Source of truth for the "Focused series" section — locally mutable so
    // FocusedSeriesChips's optimistic edits are reflected immediately, distinct
    // from `profile.focused_series` which only updates on the next page load.
    let focusedSeriesIds = $state<number[]>(
        untrack(() => profile?.focused_series ?? []),
    );
    let focusedSeriesNames = $state<Map<number, string>>(new Map());
    let focusedStats = $state<
        { seriesId: number; name: string; summary: ProblemStateSummary }[]
    >([]);
    let focusedWorklist = $state<WorklistItem[]>([]);

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

    let promoted = $derived(promoteGoals(goalSnapshots, goalsNow));
    // The hero carries the single most urgent one (it owns the action); the
    // section below lists the rest, so nothing is shown twice.
    let heroGoal = $derived(promoted[0] ?? null);
    let otherGoals = $derived(promoted.slice(1));

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

    // Refetches the focused-series names/stats/worklist whenever the set of
    // focused series changes — on first load (seeded from the profile) and
    // again whenever FocusedSeriesChips adds/removes one. Kept separate from
    // loadHome() so editing focus doesn't re-fetch the rest of the page.
    $effect(() => {
        const ids = focusedSeriesIds;
        if (!user || ids.length === 0) {
            focusedSeriesNames = new Map();
            focusedStats = [];
            focusedWorklist = [];
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                const [seriesRows, summaries, worklist] = await Promise.all([
                    fetchByIds(supabase, "series", ids) as Promise<SeriesRow[]>,
                    Promise.all(ids.map((id) => fetchProblemStateSummary(supabase, id))),
                    fetchFocusedSeriesWorklist(supabase, ids),
                ]);
                if (cancelled) return;
                const names = new Map(seriesRows.map((row) => [row.id, row.name]));
                focusedSeriesNames = names;
                focusedStats = ids.map((id, index) => ({
                    seriesId: id,
                    name: names.get(id) ?? `Series ${id}`,
                    summary: summaries[index],
                }));
                focusedWorklist = worklist;
            } catch (e) {
                if (!cancelled)
                    toasts.error(
                        (e as Error).message || "Failed to load your focused series.",
                    );
            }
        })();

        return () => {
            cancelled = true;
        };
    });

    async function loadHome() {
        if (!user) {
            loading = false;
            return;
        }

        loading = true;
        try {
            const [nextRating, nextSummary, activeSessions, recent] =
                await Promise.all([
                    fetchPlayerRating(supabase, user.id),
                    fetchProblemStateSummary(supabase),
                    fetchSessions(supabase, { status: "active" }),
                    fetchRecentSubmissions(supabase, 3),
                ]);

            rating = nextRating;
            summary = nextSummary;
            activeSession = activeSessions[0] ?? null;
            recentSubmissions = recent;
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

    let provisional = $derived(playerRatingIsProvisional(rating));
    let practiceHref = $derived(
        activeSession
            ? `${resolve("/practice")}?session=${activeSession.id}`
            : resolve("/practice"),
    );

    function plural(value: number, singular: string, pluralForm = `${singular}s`) {
        return value === 1 ? singular : pluralForm;
    }

    function problemTitle(submission: RecentSubmissionRow) {
        const problem = submission.problems;
        if (!problem) return "Practice problem";
        return `${problem.tests?.name ?? "Practice problem"} · Problem ${problem.n + 1}`;
    }

    function outcomeLabel(submission: RecentSubmissionRow) {
        if (submission.skipped) return "Skipped";
        if (submission.is_correct === true) return "Solved";
        if (submission.is_correct === false) return "Needs review";
        return "Submitted";
    }

    function outcomeIcon(submission: RecentSubmissionRow) {
        if (submission.skipped) return "arrow_forward";
        if (submission.is_correct === null) return "pending";
        return submission.is_correct ? "check_circle" : "cancel";
    }

    function outcomeClass(submission: RecentSubmissionRow) {
        if (submission.skipped) return "text-muted-foreground";
        if (submission.is_correct === null) return "text-muted-foreground";
        return submission.is_correct ? "text-correct" : "text-destructive";
    }

    function activityDescription(submission: RecentSubmissionRow) {
        const topic = topicLabel(submission.problems?.topic);
        return topic
            ? `${topic} · ${outcomeLabel(submission)}`
            : outcomeLabel(submission);
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

<Page.Root width="standard">
    <Page.Header
        title={`Welcome back${profile?.username ? `, ${profile.username}` : ""}`}
        description="Pick up where you left off or work on what needs attention."
    >
        {#snippet actions()}
            <Button href={resolve("/practice")} class="max-sm:w-full">
                Start practice
            </Button>
        {/snippet}
    </Page.Header>

    {#if loading}
        <div
            class="flex min-h-40 items-center justify-center gap-2 type-secondary text-muted-foreground"
            aria-live="polite"
        >
            <Icon name="progress_activity" class="animate-spin" />
            Loading your next step…
        </div>
    {:else}
        <div class="flex flex-col gap-10">
            <section
                aria-labelledby="continue-title"
                class="flex flex-col gap-5 rounded-xl border border-border bg-surface-container-lowest p-5 sm:p-6"
            >
                <div
                    class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
                >
                    <div>
                        <p class="type-caption text-muted-foreground">
                            {activeSession
                                ? "Continue where you left off"
                                : "Your next session"}
                        </p>
                        <h2 id="continue-title" class="mt-1 type-section-title">
                            {activeSession?.name || "Ready to practice?"}
                        </h2>
                        <p class="mt-1 type-secondary text-muted-foreground">
                            {#if activeSession}
                                {activeSession.times_seen}
                                {plural(activeSession.times_seen, "problem")} attempted ·
                                {activeSession.times_correct} correct
                            {:else}
                                Start a focused session or practice freely.
                            {/if}
                        </p>
                    </div>

                    {#if activeSession?.last_submission_at}
                        <span class="type-caption text-muted-foreground">
                            Active {relativeDate(activeSession.last_submission_at)}
                        </span>
                    {/if}
                </div>

                <div class="flex flex-wrap items-center gap-2">
                    <Button href={practiceHref} variant="outline">
                        {activeSession ? "Continue session" : "Choose a session"}
                        <Icon name="arrow_forward" />
                    </Button>
                </div>

                <!-- The commitment behind the session. The hero answers "what was
                     I doing"; a goal answers "why", and owns the action that
                     moves it — so it belongs in the same card, not in a widget
                     further down the page. -->
                {#if heroGoal}
                    <HomeGoalRow
                        entry={heroGoal}
                        {seriesNames}
                        now={goalsNow}
                        busy={startingGoal}
                        onpractice={practiceGoal}
                        class="border-t border-border/60 pt-5"
                    />
                {/if}
            </section>

            {#if user && goalsLoaded && goals.length === 0}
                <!-- The empty state is the point: goals are invisible to exactly
                     the students who have none, which on day one is everyone. -->
                <section
                    class="flex flex-col items-start gap-4 rounded-xl border border-dashed border-border p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
                >
                    <!-- 3xl is the app's prose measure (Page.Header's own title
                         block). The "Set a goal" button is `shrink-0` beside it,
                         so the cap only has to stay clear of that. -->
                    <div class="max-w-3xl">
                        <h2 class="type-section-title text-foreground">
                            Set a finish line
                        </h2>
                        <p class="mt-1 type-secondary text-muted-foreground">
                            Commit to something you can finish — 80% of AMC 10
                            geometry, 100 problems this month, a two-week streak.
                            Everything you have already done counts toward it from
                            the moment you set it.
                        </p>
                    </div>
                    <Button href={`${resolve("/goals")}?new=1`} class="shrink-0">
                        <Icon name="flag" class="size-[1em]" />
                        Set a goal
                    </Button>
                </section>
            {:else if otherGoals.length > 0}
                <Page.Section
                    title="Your goals"
                    description="What you committed to, and what can move today."
                >
                    {#snippet actions()}
                        <Button href={resolve("/goals")} variant="ghost" size="sm">
                            All goals
                            <Icon name="arrow_forward" />
                        </Button>
                    {/snippet}

                    <div class="divide-y divide-border border-y border-border">
                        {#each otherGoals as entry (entry.goal.id)}
                            <HomeGoalRow
                                {entry}
                                {seriesNames}
                                now={goalsNow}
                                busy={startingGoal}
                                onpractice={practiceGoal}
                                class="py-4"
                            />
                        {/each}
                    </div>
                </Page.Section>
            {/if}

            {#if user}
                <Page.Section
                    title="Focused series"
                    description="Pick up to 3 series to track closely on this page."
                >
                    <div class="flex flex-col gap-5">
                        <FocusedSeriesChips
                            {supabase}
                            userId={user.id}
                            bind:focusedSeriesIds
                            seriesNames={focusedSeriesNames}
                        />

                        {#if focusedSeriesIds.length > 0}
                            <FocusedSeriesStats entries={focusedStats} />
                            <FocusedWorklist
                                items={focusedWorklist}
                                seriesNames={focusedSeriesNames}
                            />
                        {/if}
                    </div>
                </Page.Section>
            {/if}

            <Page.Section
                title="Recommended next"
                description="Use your review schedule or choose what you want to explore."
            >
                <div class="grid gap-3 md:grid-cols-2">
                    <a
                        href={resolve("/practice")}
                        class="group flex min-h-40 flex-col justify-between gap-6 rounded-xl border border-border bg-surface-container-lowest p-5 transition-colors hover:bg-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <div>
                            <p class="type-caption text-muted-foreground">
                                {summary?.review_due
                                    ? `${summary.review_due} due now`
                                    : "Review queue"}
                            </p>
                            <h3 class="mt-1 type-section-title">
                                {summary?.review_due
                                    ? `Review ${summary.review_due} ${plural(summary.review_due, "problem")}`
                                    : "Build your review queue"}
                            </h3>
                            <p class="mt-1 type-secondary text-muted-foreground">
                                {summary?.review_due
                                    ? "Refresh problems that are ready for another attempt."
                                    : "Practiced problems will return when they need attention."}
                            </p>
                        </div>
                        <span
                            class="flex items-center gap-1 type-secondary font-medium group-hover:text-primary-foreground"
                        >
                            {summary?.review_due ? "Open practice" : "Start practicing"}
                            <Icon name="arrow_forward" />
                        </span>
                    </a>

                    <a
                        href={resolve("/library")}
                        class="group flex min-h-40 flex-col justify-between gap-6 rounded-xl border border-border bg-surface-container-lowest p-5 transition-colors hover:bg-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <div>
                            <p class="type-caption text-muted-foreground">
                                Choose your own direction
                            </p>
                            <h3 class="mt-1 type-section-title">
                                Explore the library
                            </h3>
                            <p class="mt-1 type-secondary text-muted-foreground">
                                Find a problem, test, or series for your next session.
                            </p>
                        </div>
                        <span
                            class="flex items-center gap-1 type-secondary font-medium group-hover:text-primary-foreground"
                        >
                            Open library
                            <Icon name="arrow_forward" />
                        </span>
                    </a>
                </div>
            </Page.Section>

            <Page.Section
                title="Your progress"
                description="A compact snapshot of your recent work."
            >
                {#snippet actions()}
                    <Button href={resolve("/progress")} variant="ghost" size="sm">
                        View progress
                        <Icon name="arrow_forward" />
                    </Button>
                {/snippet}

                <dl
                    class="grid border-y border-border sm:grid-cols-3 sm:divide-x sm:divide-border"
                >
                    <div class="py-4 sm:pr-5">
                        <dt class="type-caption text-muted-foreground">
                            Skill rating
                        </dt>
                        <dd class="mt-1 type-display text-foreground">
                            {rating ? Math.round(rating.rating) : "—"}
                        </dd>
                        <p class="mt-1 type-caption text-muted-foreground">
                            {#if provisional}
                                Provisional
                            {:else if rating}
                                ±{Math.round(rating.rd)} uncertainty
                            {:else}
                                Complete a rated problem
                            {/if}
                        </p>
                    </div>
                    <div class="border-t border-border py-4 sm:border-t-0 sm:px-5">
                        <dt class="type-caption text-muted-foreground">
                            Review due
                        </dt>
                        <dd class="mt-1 type-display text-foreground">
                            {summary?.review_due ?? 0}
                        </dd>
                        <p class="mt-1 type-caption text-muted-foreground">
                            Ready for another attempt
                        </p>
                    </div>
                    <div class="border-t border-border py-4 sm:border-t-0 sm:pl-5">
                        <dt class="type-caption text-muted-foreground">
                            Problems seen
                        </dt>
                        <dd class="mt-1 type-display text-foreground">
                            {summary?.seen ?? 0}
                        </dd>
                        <p class="mt-1 type-caption text-muted-foreground">
                            {rating?.matches ?? 0} rated
                            {plural(rating?.matches ?? 0, "match", "matches")}
                        </p>
                    </div>
                </dl>
            </Page.Section>

            <Page.Section title="Recent activity">
                {#snippet actions()}
                    <Button href={resolve("/history")} variant="ghost" size="sm">
                        View history
                        <Icon name="arrow_forward" />
                    </Button>
                {/snippet}

                {#if recentSubmissions.length > 0}
                    <div class="divide-y divide-border border-y border-border">
                        {#each recentSubmissions as submission (submission.id)}
                            <div
                                class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
                            >
                                <Icon
                                    name={outcomeIcon(submission)}
                                    class={outcomeClass(submission)}
                                />
                                <div class="min-w-0">
                                    <p class="truncate type-secondary font-medium text-foreground">
                                        {problemTitle(submission)}
                                    </p>
                                    <p class="mt-0.5 type-caption text-muted-foreground">
                                        {activityDescription(submission)}
                                    </p>
                                </div>
                                <time
                                    class="col-start-2 type-caption text-muted-foreground sm:col-start-3 sm:row-start-1"
                                    datetime={submission.created_at}
                                >
                                    {relativeDate(submission.created_at)}
                                </time>
                            </div>
                        {/each}
                    </div>
                {:else}
                    <div class="py-6">
                        <p class="type-secondary text-muted-foreground">
                            Your recent problem activity will appear here.
                        </p>
                    </div>
                {/if}
            </Page.Section>
        </div>
    {/if}
</Page.Root>
