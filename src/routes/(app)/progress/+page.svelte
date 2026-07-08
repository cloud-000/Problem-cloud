<script lang="ts">
    import type { PageData } from "./$types";
    import { goto } from "$app/navigation";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Select } from "$lib/components/select";
    import {
        BreakdownRow,
        type BreakdownMetric,
    } from "$lib/components/breakdown-row";
    import type { Segment } from "$lib/components/segment-bar";
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
        fetchPlayerRatingHistory,
        RATING_PROVISIONAL_RD,
        type PlayerRatingPoint,
    } from "$lib/library";
    import { RatingChart } from "$lib/components/rating-chart";

    let { data }: { data: PageData } = $props();
    let { supabase, user } = $derived(data);

    let rows = $state<TopicStat[]>([]);
    // Full rating climb (all-time); sliced to the selected range for display.
    let ratingHistory = $state<PlayerRatingPoint[]>([]);
    let loading = $state(true);
    let errorMsg = $state<string | null>(null);
    // Topic currently spinning up a drill session (disables its button).
    let drilling = $state<string | null>(null);

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

    async function load(from?: string) {
        if (!user) {
            loading = false;
            return;
        }
        loading = true;
        try {
            [rows, ratingHistory] = await Promise.all([
                fetchProgressBreakdown(supabase, "topic", { from }),
                fetchPlayerRatingHistory(supabase, user.id),
            ]);
            errorMsg = null;
        } catch (e) {
            errorMsg = (e as Error).message || "Failed to load progress";
        } finally {
            loading = false;
        }
    }

    // (Re)load on mount and whenever the range changes.
    $effect(() => {
        void load(rangeFrom(range));
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

    // Weakest topics (min-volume floored, weakest first) for the Focus panel.
    let weaknesses = $derived(rankWeaknesses(rows).slice(0, 4));
    // Full topic list, most-practiced first.
    let topicRows = $derived([...rows].sort((a, b) => b.graded - a.graded));

    function segmentsFor(r: TopicStat): Segment[] {
        const incorrect = Math.max(r.graded - r.correct, 0);
        return [
            {
                value: r.correct,
                color: "var(--color-correct)",
                label: "Correct",
            },
            {
                value: incorrect,
                color: "var(--color-destructive)",
                label: "Incorrect",
            },
            {
                value: r.skipped,
                color: "var(--color-muted-foreground)",
                label: "Skipped",
            },
        ];
    }

    function metricsFor(r: TopicStat): BreakdownMetric[] {
        return [
            {
                label: "eventual",
                value: pct(accuracy(r)),
                title: "Eventual accuracy",
            },
            {
                label: "avg time",
                value: fmtTime(avgTimeMs(r)),
                title: "Avg time / graded attempt",
            },
        ];
    }

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
            await goto(`/practice?session=${session.id}`);
        } catch (e) {
            errorMsg = (e as Error).message || "Failed to start drill";
            drilling = null;
        }
    }
</script>

<div class="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
    <!-- Header -->
    <div class="border-b border-border/80 pb-4 space-y-1">
        <h1
            class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2"
        >
            <Icon
                name="insights"
                fontsize="2rem"
                class="text-primary-foreground"
            />
            Progress
        </h1>
        <p class="text-sm text-muted-foreground">
            See how you're doing by topic, and drill straight into your weak
            spots.
        </p>
    </div>

    {#if !user}
        <!-- Unauthenticated prompt -->
        <div
            class="flex flex-col items-center justify-center gap-4 text-center py-16"
        >
            <div
                class="flex size-16 items-center justify-center rounded-full bg-surface-container text-muted-foreground"
            >
                <Icon name="insights" fontsize="2.5rem" />
            </div>
            <div class="flex max-w-5xl flex-col gap-1">
                <h2 class="text-lg font-semibold">
                    Sign in to view your progress
                </h2>
                <p class="text-sm text-muted-foreground">
                    We track your accuracy and pace by topic automatically once
                    you're logged in.
                </p>
            </div>
            <Button
                href="/auth/login"
                class="bg-primary text-primary-foreground hover:bg-primary/95 mt-2 px-6 shadow-sm"
            >
                Log In
            </Button>
        </div>
    {:else}
        <!-- Range control -->
        <div class="flex items-end justify-end">
            <div class="flex flex-col gap-1.5 w-full md:w-48">
                <span
                    class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >Time Range</span
                >
                <Select
                    options={rangeOptions}
                    bind:value={range}
                    placeholder="Select range..."
                />
            </div>
        </div>

        {#if loading && rows.length === 0}
            <div class="flex flex-col items-center justify-center py-16 gap-3">
                <Icon
                    name="progress_activity"
                    class="animate-spin text-muted-foreground"
                    fontsize="1.8rem"
                />
                <p class="text-xs text-muted-foreground">Loading progress...</p>
            </div>
        {:else if errorMsg}
            <div
                class="p-4 rounded-lg bg-destructive/10 text-destructive text-sm text-center"
            >
                {errorMsg}
            </div>
        {:else if rows.length === 0}
            <div
                class="flex flex-col items-center justify-center py-16 gap-3 text-center"
            >
                <div
                    class="flex size-12 items-center justify-center rounded-full bg-surface-container text-muted-foreground"
                >
                    <Icon name="query_stats" fontsize="1.8rem" />
                </div>
                <div>
                    <h3 class="text-sm font-semibold">No progress yet</h3>
                    <p class="text-xs text-muted-foreground mt-0.5">
                        Attempt some problems and your topic breakdown will
                        appear here.
                    </p>
                </div>
                <Button size="sm" href="/practice" class="mt-1"
                    >Go Practice</Button
                >
            </div>
        {:else}
            <!-- Rating climb -->
            {#if ratingHistory.length > 0}
                <div
                    class="rounded-xl border border-border/60 bg-surface-container-low p-4"
                >
                    <div class="flex items-center gap-2">
                        <Icon
                            name="trending_up"
                            class="text-primary-foreground"
                            fontsize="1.2rem"
                        />
                        <h2
                            class="text-sm font-bold uppercase tracking-wider text-muted-foreground"
                        >
                            Rating
                        </h2>
                        {#if ratingDelta != null && ratingDelta !== 0}
                            <span
                                class="font-mono text-xs font-semibold {ratingDelta >
                                0
                                    ? 'text-correct'
                                    : 'text-destructive'}"
                            >
                                {ratingDelta > 0 ? "+" : ""}{Math.round(
                                    ratingDelta,
                                )}
                            </span>
                        {/if}
                        {#if ratingProvisional}
                            <span
                                class="text-xs text-muted-foreground"
                                title="Rating deviation is still high — it will settle as you play more rated matches."
                            >
                                · provisional
                            </span>
                        {/if}
                    </div>
                    {#if visibleHistory.length > 0}
                        <RatingChart
                            points={visibleHistory}
                            class="mt-3"
                            color="var(--color-primary-foreground)"
                            bandColor="var(--color-primary)"
                            bandOpacity={0.5}
                        />
                    {:else}
                        <p class="mt-4 text-xs text-muted-foreground">
                            No rated matches in this range.
                        </p>
                    {/if}
                </div>
            {/if}

            <!-- Overall stat tiles -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div
                    class="p-4 rounded-xl border border-border/60 bg-surface-container-low flex flex-col justify-center"
                >
                    <div
                        class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                        Problems
                    </div>
                    <div
                        class="mt-2 text-2xl font-bold text-foreground font-mono"
                    >
                        {totals.distinct}
                    </div>
                </div>
                <div
                    class="p-4 rounded-xl border border-border/60 bg-surface-container-low flex flex-col justify-center"
                >
                    <div
                        class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                        First-Try
                    </div>
                    <div
                        class="mt-2 text-2xl font-bold text-foreground font-mono"
                    >
                        {pct(overallFirst)}
                    </div>
                </div>
                <div
                    class="p-4 rounded-xl border border-border/60 bg-surface-container-low flex flex-col justify-center"
                >
                    <div
                        class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                        Eventual
                    </div>
                    <div
                        class="mt-2 text-2xl font-bold text-foreground font-mono"
                    >
                        {pct(overallAcc)}
                    </div>
                </div>
                <div
                    class="p-4 rounded-xl border border-border/60 bg-surface-container-low flex flex-col justify-center"
                >
                    <div
                        class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                        Avg Time
                    </div>
                    <div
                        class="mt-2 text-2xl font-bold text-foreground font-mono"
                    >
                        {fmtTime(overallAvg)}
                    </div>
                </div>
            </div>

            <!-- Focus areas (weakness → drill) -->
            {#if weaknesses.length > 0}
                <div class="space-y-3">
                    <div class="flex items-center gap-2">
                        <Icon
                            name="target"
                            class="text-destructive"
                            fontsize="1.2rem"
                        />
                        <h2
                            class="text-sm font-bold uppercase tracking-wider text-muted-foreground"
                        >
                            Focus Areas
                        </h2>
                    </div>
                    <div class="space-y-2">
                        {#each weaknesses as r (r.bucket_key)}
                            <BreakdownRow
                                highlight
                                label={topicLabel(r.bucket_label)}
                                sublabel={subFor(r)}
                                score={firstAccuracy(r)}
                                segments={segmentsFor(r)}
                                metrics={metricsFor(r)}
                            >
                                {#snippet action()}
                                    <Button
                                        size="sm"
                                        onclick={() => drill(r.bucket_key)}
                                        disabled={drilling === r.bucket_key}
                                        class="gap-1"
                                    >
                                        <Icon
                                            name={drilling === r.bucket_key
                                                ? "progress_activity"
                                                : "sprint"}
                                            class={drilling === r.bucket_key
                                                ? "animate-spin size-[1.1em]"
                                                : "size-[1.1em]"}
                                        />
                                        Drill
                                    </Button>
                                {/snippet}
                            </BreakdownRow>
                        {/each}
                    </div>
                </div>
            {/if}

            <!-- Full topic breakdown -->
            <div class="space-y-3">
                <h2
                    class="text-sm font-bold uppercase tracking-wider text-muted-foreground border-b border-border/40 pb-1"
                >
                    By Topic
                </h2>
                <div class="space-y-2">
                    {#each topicRows as r (r.bucket_key)}
                        <BreakdownRow
                            label={topicLabel(r.bucket_label)}
                            sublabel={subFor(r)}
                            score={firstAccuracy(r)}
                            segments={segmentsFor(r)}
                            metrics={metricsFor(r)}
                        />
                    {/each}
                </div>
            </div>
        {/if}
    {/if}
</div>
