<script lang="ts">
    import type { PageData } from "./$types";
    import { onMount } from "svelte";
    import { resolve } from "$app/paths";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import * as Page from "$lib/components/page";
    import { toasts } from "$lib/state/toast.svelte";
    import {
        fetchPlayerRating,
        playerRatingIsProvisional,
        topicLabel,
        type PlayerRating,
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

    let { data }: { data: PageData } = $props();
    let { supabase, user, profile } = $derived(data);

    let rating = $state<PlayerRating | null>(null);
    let summary = $state<ProblemStateSummary | null>(null);
    let activeSession = $state<PracticeSessionRow | null>(null);
    let recentSubmissions = $state<RecentSubmissionRow[]>([]);
    let loading = $state(true);

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

    onMount(loadHome);

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
        return submission.is_correct ? "check_circle" : "cancel";
    }

    function outcomeClass(submission: RecentSubmissionRow) {
        if (submission.skipped) return "text-muted-foreground";
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
            </section>

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
