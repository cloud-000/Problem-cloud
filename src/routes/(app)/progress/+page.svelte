<script lang="ts">
    import type { PageData } from "./$types";
    import { goto } from "$app/navigation";
    import { resolve } from "$app/paths";
    import { page } from "$app/state";
    import { Button } from "$lib/components/button";
    import { Combobox } from "$lib/components/combobox";
    import { Icon } from "$lib/components/icon";
    import * as Page from "$lib/components/page";
    import { Select } from "$lib/components/select";
    import {
        fetchProgressBreakdown,
        rankWeaknesses,
        accuracy,
        firstAccuracy,
        avgTimeMs,
        type BreakdownRow as TopicStat,
    } from "$lib/progress-analytics";
    import { startSession } from "$lib/sessions";
    import { defaultPracticeSettings } from "$lib/trainer";
    import {
        topicLabel as topicName,
        fetchAllSeries,
        fetchPlayerRatingHistory,
        RATING_PROVISIONAL_RD,
        type ProblemRow,
        type PlayerRatingPoint,
    } from "$lib/library";
    import { RatingChart } from "$lib/components/rating-chart";
    import SeriesReviewPanel from "./SeriesReviewPanel.svelte";
    import ProgressNav, { type ProgressView } from "./ProgressNav.svelte";
    import {
        fetchDueReviews,
        fetchProblemStateSummary,
        type ProblemStateSummary,
    } from "$lib/progress";
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

    let rows = $state<TopicStat[]>([]);
    // Full rating climb (all-time); sliced to the selected range for display.
    let ratingHistory = $state<PlayerRatingPoint[]>([]);
    let stateSummary = $state<ProblemStateSummary | null>(null);
    let dueReviews = $state<ProblemRow[]>([]);
    let dueLoading = $state(true);
    let dueError = $state<string | null>(null);
    let showReviewTip = $derived(
        shouldShowTip(
            onboarding.acknowledgedTips,
            CONTEXTUAL_TIP.firstReview,
            !dueLoading && dueReviews.length > 0,
        ),
    );
    let loading = $state(true);
    let errorMsg = $state<string | null>(null);
    // Topic currently spinning up a drill session (disables its button).
    let drilling = $state<string | null>(null);
    let startingReview = $state(false);
    let activeView = $derived.by<ProgressView>(() => {
        const view = page.url.searchParams.get("view");
        return view === "review" || view === "matrix" ? view : "overview";
    });

    // Series lens for the overview: empty = all series. The breakdown RPC takes a
    // multi-series array; the state summary is single-series, so it only narrows
    // when exactly one series is picked (all-time otherwise).
    let seriesOptions = $state<{ value: string; label: string }[]>([]);
    let selectedSeriesIds = $state<string[]>([]);

    // Time range → optional `from` bound handed to the RPC.
    let range = $state("all");
    const rangeOptions = [
        { value: "all", label: "All Time" },
        { value: "week", label: "Past 7 Days" },
        { value: "month", label: "Past 30 Days" },
    ];
    function rangeFrom(r: string): string | undefined {
        if (r === "week") return new Date(Date.now() - 7 * 864e5).toISOString();
        if (r === "month")
            return new Date(Date.now() - 30 * 864e5).toISOString();
        return undefined;
    }

    // Stored topic code → display name (falls back to the raw code).
    const topicLabel = (key: string) => topicName(key) ?? key;

    const pct = (v: number | null) =>
        v == null ? "—" : `${Math.round(v * 100)}%`;
    function fmtTime(ms: number | null): string {
        if (ms == null) return "—";
        const s = Math.round(ms / 1000);
        if (s < 60) return `${s}s`;
        return `${Math.floor(s / 60)}m ${s % 60}s`;
    }

    async function load(from?: string, seriesIds: number[] = []) {
        if (!user) {
            loading = false;
            return;
        }
        loading = true;
        try {
            [rows, ratingHistory, stateSummary] = await Promise.all([
                fetchProgressBreakdown(supabase, "topic", {
                    from,
                    seriesIds: seriesIds.length ? seriesIds : undefined,
                }),
                fetchPlayerRatingHistory(supabase, user.id),
                fetchProblemStateSummary(
                    supabase,
                    seriesIds.length === 1 ? seriesIds[0] : null,
                ),
            ]);
            errorMsg = null;
        } catch (e) {
            errorMsg = (e as Error).message || "Failed to load progress";
        } finally {
            loading = false;
        }
    }

    // Series options for the overview lens (public list; empty = all series).
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

    // (Re)load on mount and whenever the range or series lens changes.
    $effect(() => {
        void load(rangeFrom(range), selectedSeriesIds.map(Number));
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
        if (!user) {
            dueReviews = [];
            dueLoading = false;
            return;
        }
        let cancelled = false;
        dueLoading = true;
        fetchDueReviews(supabase)
            .then((problems) => {
                if (cancelled) return;
                dueReviews = problems;
                dueError = null;
            })
            .catch((error) => {
                if (cancelled) return;
                dueError = (error as Error).message || "Failed to load reviews";
            })
            .finally(() => {
                if (!cancelled) dueLoading = false;
            });
        return () => {
            cancelled = true;
        };
    });

    // Overall totals, aggregated from the single topic query (topics are disjoint
    // per problem, so summing distinct_problems gives the true total).
    let totals = $derived.by(() =>
        rows.reduce(
            (a, r) => ({
                graded: a.graded + r.graded,
                correct: a.correct + r.correct,
                firstGraded: a.firstGraded + r.first_graded,
                firstCorrect: a.firstCorrect + r.first_correct,
                distinct: a.distinct + r.distinct_problems,
                timeMs: a.timeMs + r.graded_time_ms,
                timed: a.timed + r.graded_timed,
            }),
            {
                graded: 0,
                correct: 0,
                firstGraded: 0,
                firstCorrect: 0,
                distinct: 0,
                timeMs: 0,
                timed: 0,
            },
        ),
    );

    let overallFirst = $derived(
        totals.firstGraded > 0
            ? totals.firstCorrect / totals.firstGraded
            : null,
    );
    let overallAcc = $derived(
        totals.graded > 0 ? totals.correct / totals.graded : null,
    );
    let overallAvg = $derived(
        totals.timed > 0 ? totals.timeMs / totals.timed : null,
    );

    // Rating climb sliced to the selected range (the RPC handles the topic side;
    // the history is filtered client-side against the same `from` bound).
    let visibleHistory = $derived.by(() => {
        const from = rangeFrom(range);
        if (!from) return ratingHistory;
        return ratingHistory.filter((p) => p.at >= from);
    });
    // Net rating change across the visible slice.
    let ratingDelta = $derived(
        visibleHistory.length >= 2
            ? visibleHistory[visibleHistory.length - 1].rating -
                  visibleHistory[0].rating
            : null,
    );
    // The latest rating is still low-confidence while RD stays high.
    let ratingProvisional = $derived(
        visibleHistory.length > 0 &&
            visibleHistory[visibleHistory.length - 1].rd >=
                RATING_PROVISIONAL_RD,
    );
    let latestRating = $derived(
        visibleHistory.length > 0
            ? visibleHistory[visibleHistory.length - 1].rating
            : null,
    );

    // Weakest topics (min-volume floored, weakest first) for the Focus panel.
    let weaknesses = $derived(rankWeaknesses(rows).slice(0, 4));
    // Full topic list, most-practiced first.
    let topicRows = $derived([...rows].sort((a, b) => b.graded - a.graded));

    function subFor(r: TopicStat): string {
        const probs = `${r.distinct_problems} problem${r.distinct_problems === 1 ? "" : "s"}`;
        return `${probs} · ${r.graded} attempt${r.graded === 1 ? "" : "s"}`;
    }

    // Spin up a topic-scoped practice session and jump into it. Reuses the exact
    // session-creation path as the hub (startSession → /practice?session=<id>),
    // just with the topic filter pre-applied.
    async function drill(topicKey: string) {
        if (!user || drilling) return;
        drilling = topicKey;
        try {
            const settings = {
                ...defaultPracticeSettings(),
                topic: [topicKey],
            };
            const session = await startSession(supabase, user.id, {
                name: `Drill: ${topicLabel(topicKey)}`,
                settings,
            });
            await goto(resolve(`/practice?session=${session.id}`));
        } catch (e) {
            errorMsg = (e as Error).message || "Failed to start drill";
            drilling = null;
        }
    }

    function dismissReviewTip() {
        onboarding = acknowledgeTipInState(onboarding, CONTEXTUAL_TIP.firstReview);
        acknowledgeTip(CONTEXTUAL_TIP.firstReview);
    }

    async function startReview() {
        if (!user || startingReview) return;
        startingReview = true;
        try {
            const settings = {
                ...defaultPracticeSettings(),
                mode: "review" as const,
            };
            const session = await startSession(supabase, user.id, {
                name: "Due review",
                settings,
            });
            await goto(resolve(`/practice?session=${session.id}`));
        } catch (error) {
            dueError = (error as Error).message || "Failed to start review";
            startingReview = false;
        }
    }
</script>

<svelte:head><title>Progress · ProblemCloud</title></svelte:head>

<Page.Root width="standard">
    <Page.Header
        title="Progress"
        description="Understand what needs attention, review your work, and follow your development over time."
    >
        {#snippet actions()}
            <Button href="/practice" size="lg">Start targeted practice</Button>
        {/snippet}
    </Page.Header>

    <ProgressNav active={activeView} />

    {#if !user}
        <div class="flex flex-col items-center gap-4 py-16 text-center">
            <div>
                <h2 class="type-section-title text-foreground">
                    Sign in to view your progress
                </h2>
                <p class="mt-1 type-secondary text-muted-foreground">
                    Your accuracy, pace, review schedule, and topic development
                    will appear here.
                </p>
            </div>
            <Button href="/auth/login">Log in</Button>
        </div>
    {:else if activeView === "matrix"}
        <div class="2xl:-mx-[120px] 2xl:w-[calc(100%+240px)]">
            <SeriesReviewPanel {supabase} />
        </div>
    {:else if activeView === "review"}
        <Page.Section
            title="Review due"
            description="Work through problems scheduled for review across your series."
        >
            {#snippet actions()}
                <Button onclick={startReview} disabled={startingReview || dueReviews.length === 0}>
                    {startingReview ? "Starting…" : "Start review"}
                </Button>
            {/snippet}

            {#if showReviewTip}
                <ContextualTip
                    body={contextualTipCopy(CONTEXTUAL_TIP.firstReview).body}
                    ondismiss={dismissReviewTip}
                />
            {/if}

            {#if dueLoading}
                <div class="flex items-center justify-center gap-2 py-12 type-secondary text-muted-foreground">
                    <Icon name="progress_activity" class="animate-spin" />
                    Loading reviews…
                </div>
            {:else if dueError}
                <p class="rounded-lg bg-destructive/10 p-4 type-secondary text-destructive">
                    {dueError}
                </p>
            {:else if dueReviews.length === 0}
                <div class="py-12 text-center">
                    <h3 class="type-section-title text-foreground">You are caught up</h3>
                    <p class="mt-1 type-secondary text-muted-foreground">
                        Practice another problem to keep building your review queue.
                    </p>
                </div>
            {:else}
                <div class="border-t border-border">
                    {#each dueReviews as problem (problem.id)}
                        <div
                            class="grid gap-3 border-b border-border py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-6"
                        >
                            <div class="min-w-0">
                                <h3 class="type-body text-foreground">
                                    {problem.tests?.name ?? "Practice problem"}
                                    <span class="text-muted-foreground">
                                        · Problem {problem.n + 1}
                                    </span>
                                </h3>
                                <p class="type-caption text-muted-foreground">
                                    {problem.tests?.series?.name ?? "Independent problem"}
                                </p>
                            </div>
                            <span class="type-code text-muted-foreground">
                                {problem.rating
                                    ? Math.round(problem.rating.rating)
                                    : "—"}
                            </span>
                            <Button
                                onclick={startReview}
                                disabled={startingReview}
                                variant="outline"
                                size="sm"
                            >
                                Review
                            </Button>
                        </div>
                    {/each}
                </div>
            {/if}
        </Page.Section>
    {:else}
        <Page.Toolbar>
            <div class="grid w-full gap-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-end">
                <label class="flex min-w-0 flex-col gap-1.5">
                    <span class="type-caption text-muted-foreground">Series</span>
                    <Combobox
                        bind:value={selectedSeriesIds}
                        options={seriesOptions}
                        strict
                        placeholder="All series"
                        inputPlaceholder="Add series…"
                    />
                </label>
                <label class="flex min-w-0 flex-col gap-1.5">
                    <span class="type-caption text-muted-foreground">Time range</span>
                    <Select
                        options={rangeOptions}
                        bind:value={range}
                        placeholder="Select range…"
                    />
                </label>
            </div>
        </Page.Toolbar>

        {#if loading && rows.length === 0}
            <div class="flex items-center justify-center gap-2 py-16 type-secondary text-muted-foreground">
                <Icon name="progress_activity" class="animate-spin" />
                Loading progress…
            </div>
        {:else if errorMsg}
            <p class="rounded-lg bg-destructive/10 p-4 type-secondary text-destructive">
                {errorMsg}
            </p>
        {:else if rows.length === 0}
            <div class="flex flex-col items-center gap-4 py-16 text-center">
                <div>
                    <h2 class="type-section-title text-foreground">No progress yet</h2>
                    <p class="mt-1 type-secondary text-muted-foreground">
                        Attempt some problems and your topic breakdown will appear here.
                    </p>
                </div>
                <Button href="/practice">Start practicing</Button>
            </div>
        {:else}
            <section
                class="grid gap-6 border-b border-border pb-8 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                aria-labelledby="next-step-heading"
            >
                <div>
                    <p class="type-caption text-muted-foreground">Recommended next step</p>
                    <h2 id="next-step-heading" class="mt-1 type-section-title text-foreground">
                        {#if stateSummary?.review_due}
                            Review {stateSummary.review_due}
                            {stateSummary.review_due === 1 ? "problem" : "problems"} due now
                        {:else if weaknesses[0]}
                            Practice {topicLabel(weaknesses[0].bucket_label)}
                        {:else}
                            Continue building your progress
                        {/if}
                    </h2>
                    <p class="mt-1 type-secondary text-muted-foreground">
                        {#if weaknesses[0]}
                            Start with {topicLabel(weaknesses[0].bucket_label)}—the clearest opportunity in this range.
                        {:else}
                            Another focused session will make your next recommendation more precise.
                        {/if}
                    </p>
                </div>
                <div class="sm:text-right">
                    <div class="type-display font-mono tabular-nums text-foreground">
                        {stateSummary?.review_due ?? 0}
                    </div>
                    <a
                        href={resolve("/progress?view=review")}
                        class="type-caption text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
                    >review due</a>
                </div>
            </section>

            <div class="grid gap-10 lg:grid-cols-[1.08fr_0.92fr]">
                <Page.Section title="Focus areas">
                    {#snippet actions()}
                        <a
                            href={resolve("/progress?view=review")}
                            class="type-secondary text-foreground underline decoration-border underline-offset-4"
                        >Open review</a>
                    {/snippet}
                    <div class="border-t border-border">
                        {#each weaknesses.slice(0, 3) as topic (topic.bucket_key)}
                            <div class="border-b border-border py-4">
                                <div class="flex items-baseline justify-between gap-4">
                                    <div>
                                        <h3 class="type-body text-foreground">
                                            {topicLabel(topic.bucket_label)}
                                        </h3>
                                        <p class="type-caption text-muted-foreground">
                                            {subFor(topic)}
                                        </p>
                                    </div>
                                    <span class="type-code text-foreground">
                                        {pct(firstAccuracy(topic))}
                                    </span>
                                </div>
                                <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                                    <div
                                        class="h-full rounded-full bg-primary"
                                        style:width={`${Math.round((firstAccuracy(topic) ?? 0) * 100)}%`}
                                    ></div>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onclick={() => drill(topic.bucket_key)}
                                    disabled={drilling === topic.bucket_key}
                                    class="mt-2 -ml-2"
                                >
                                    {drilling === topic.bucket_key ? "Starting…" : "Practice topic"}
                                </Button>
                            </div>
                        {/each}
                    </div>
                </Page.Section>

                <Page.Section title="Rating">
                    {#snippet actions()}
                        <span class="type-code text-foreground">
                            {latestRating == null ? "—" : Math.round(latestRating)}
                            {#if ratingDelta != null && ratingDelta !== 0}
                                <span class={ratingDelta > 0 ? "text-correct" : "text-destructive"}>
                                    {ratingDelta > 0 ? "+" : ""}{Math.round(ratingDelta)}
                                </span>
                            {/if}
                        </span>
                    {/snippet}
                    {#if visibleHistory.length > 0}
                        <RatingChart
                            points={visibleHistory}
                            color="var(--color-primary-foreground)"
                            bandColor="var(--color-primary)"
                            bandOpacity={0.5}
                        />
                        {#if ratingProvisional}
                            <p class="type-caption text-muted-foreground">
                                Provisional while rating deviation remains high.
                            </p>
                        {/if}
                    {:else}
                        <p class="py-10 type-secondary text-muted-foreground">
                            No rated matches in this range.
                        </p>
                    {/if}
                </Page.Section>
            </div>

            <div class="grid grid-cols-2 border-y border-border md:grid-cols-4">
                <div class="py-4 pr-4">
                    <div class="type-code text-foreground">{totals.distinct}</div>
                    <div class="type-caption text-muted-foreground">problems</div>
                </div>
                <div class="border-l border-border py-4 pl-4 md:px-5">
                    <div class="type-code text-foreground">{pct(overallFirst)}</div>
                    <div class="type-caption text-muted-foreground">first try</div>
                </div>
                <div class="border-t border-border py-4 pr-4 md:border-l md:border-t-0 md:px-5">
                    <div class="type-code text-foreground">{pct(overallAcc)}</div>
                    <div class="type-caption text-muted-foreground">eventual</div>
                </div>
                <div class="border-l border-t border-border py-4 pl-4 md:border-t-0 md:pl-5">
                    <div class="type-code text-foreground">{fmtTime(overallAvg)}</div>
                    <div class="type-caption text-muted-foreground">average time</div>
                </div>
            </div>

            {#if stateSummary}
                <Page.Section
                    title="Problem state"
                    description="Current all-time organization, independent of the selected activity range."
                >
                    <div class="grid grid-cols-2 border-y border-border md:grid-cols-4">
                        <div class="py-4 pr-4">
                            <div class="type-code text-foreground">{stateSummary.unassessed}</div>
                            <div class="type-caption text-muted-foreground">unassessed</div>
                        </div>
                        <div class="border-l border-border py-4 pl-4 md:px-5">
                            <div class="type-code text-destructive">{stateSummary.needs_work}</div>
                            <div class="type-caption text-muted-foreground">needs work</div>
                        </div>
                        <div class="border-t border-border py-4 pr-4 md:border-l md:border-t-0 md:px-5">
                            <div class="type-code text-unsure">{stateSummary.learning}</div>
                            <div class="type-caption text-muted-foreground">learning</div>
                        </div>
                        <div class="border-l border-t border-border py-4 pl-4 md:border-t-0 md:pl-5">
                            <div class="type-code text-correct">{stateSummary.confident}</div>
                            <div class="type-caption text-muted-foreground">confident</div>
                        </div>
                    </div>
                    <p class="type-secondary text-muted-foreground">
                        Working on <span class="text-foreground">{stateSummary.working}</span>
                        · Revisit <span class="text-foreground">{stateSummary.revisit}</span>
                        · Later <span class="text-foreground">{stateSummary.later}</span>
                        · Ignored <span class="text-foreground">{stateSummary.ignored}</span>
                    </p>
                </Page.Section>
            {/if}

            <Page.Section
                title="By topic"
                description="Performance across all practiced topics in the selected range."
            >
                <div class="border-t border-border">
                    {#each topicRows as topic (topic.bucket_key)}
                        <div
                            class="grid gap-3 border-b border-border py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center sm:gap-6"
                        >
                            <div class="min-w-0">
                                <h3 class="type-body text-foreground">
                                    {topicLabel(topic.bucket_label)}
                                </h3>
                                <p class="type-caption text-muted-foreground">{subFor(topic)}</p>
                            </div>
                            <div>
                                <div class="type-code text-foreground">{pct(firstAccuracy(topic))}</div>
                                <div class="type-caption text-muted-foreground">first try</div>
                            </div>
                            <div>
                                <div class="type-code text-foreground">{pct(accuracy(topic))}</div>
                                <div class="type-caption text-muted-foreground">eventual</div>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onclick={() => drill(topic.bucket_key)}
                                disabled={drilling === topic.bucket_key}
                            >
                                Practice
                            </Button>
                        </div>
                    {/each}
                </div>
            </Page.Section>
        {/if}
    {/if}
</Page.Root>
