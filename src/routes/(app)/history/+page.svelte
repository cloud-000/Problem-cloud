<script lang="ts">
    import type { PageData } from "./$types";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { StatusTag } from "$lib/components/status-tag";
    import { Combobox } from "$lib/components/combobox";
    import { Select } from "$lib/components/select";
    import { DatePicker } from "$lib/components/date-picker";
    import { ProblemReview } from "$lib/components/problem";
    import * as Page from "$lib/components/page";
    import { RangeSlider } from "$lib/components/range-slider";
    import { TriStateSwitch, type TriState } from "$lib/components/toggle";
    import {
        fetchRecentSubmissions,
        type RecentSubmissionRow,
    } from "$lib/progress";
    import ProgressNav from "../progress/ProgressNav.svelte";
    import { submissionOutcome } from "$lib/problem-response";

    let { data }: { data: PageData } = $props();
    let { supabase, user } = $derived(data);

    const MIN_RATING = 500;
    const MAX_RATING = 2500;

    // Filter state
    let selectedOutcomes = $state<string[]>([]);
    let timeRange = $state("all");
    let startDate = $state("");
    let endDate = $state("");
    let ratingRange = $state<[number, number]>([MIN_RATING, MAX_RATING]);
    let hasSolutionsFilter = $state<TriState>("neutral");
    let limit = $state(100);

    // Data state
    let submissions = $state<RecentSubmissionRow[]>([]);
    let loading = $state(true);
    let errorMsg = $state<string | null>(null);

    // Collapsed/Expanded card state
    let expandedIds = $state(new Set<number>());

    function toggleExpand(id: number) {
        if (expandedIds.has(id)) {
            expandedIds.delete(id);
        } else {
            expandedIds.add(id);
        }
        expandedIds = new Set(expandedIds);
    }

    // Load data from Supabase
    async function loadData() {
        if (!user) {
            loading = false;
            return;
        }
        loading = true;
        try {
            const res = await fetchRecentSubmissions(supabase, limit);
            submissions = res;
            errorMsg = null;
        } catch (e) {
            errorMsg = (e as Error).message || "Failed to load submissions";
        } finally {
            loading = false;
        }
    }

    $effect(() => {
        loadData();
    });

    // Client-side filtering logic
    let filteredSubmissions = $derived.by(() => {
        return submissions.filter((sub) => {
            // 1. Filter by outcome
            if (selectedOutcomes.length > 0) {
                const outcome = submissionOutcome(sub);
                if (!selectedOutcomes.includes(outcome)) {
                    return false;
                }
            }

            // 2. Filter by time range
            const created = new Date(sub.created_at);
            if (timeRange === "today") {
                const todayStart = new Date();
                todayStart.setHours(0, 0, 0, 0);
                if (created < todayStart) return false;
            } else if (timeRange === "week") {
                const oneWeekAgo = new Date();
                oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
                if (created < oneWeekAgo) return false;
            } else if (timeRange === "month") {
                const oneMonthAgo = new Date();
                oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
                if (created < oneMonthAgo) return false;
            } else if (timeRange === "custom") {
                if (startDate) {
                    const start = new Date(startDate);
                    start.setHours(0, 0, 0, 0);
                    if (created < start) return false;
                }
                if (endDate) {
                    const end = new Date(endDate);
                    end.setHours(23, 59, 59, 999);
                    if (created > end) return false;
                }
            }

            // 3. Filter by rating
            if (ratingRange[0] > MIN_RATING || ratingRange[1] < MAX_RATING) {
                const subRating = sub.problems?.rating?.rating;
                if (subRating == null) {
                    return false;
                }
                if (subRating < ratingRange[0] || subRating > ratingRange[1]) {
                    return false;
                }
            }

            // 4. Filter by has solutions
            if (hasSolutionsFilter !== "neutral") {
                const hasSolution = (sub.problems?.official_solutions?.length ?? 0) > 0;
                if (hasSolutionsFilter === "on" && !hasSolution) {
                    return false;
                }
                if (hasSolutionsFilter === "off" && hasSolution) {
                    return false;
                }
            }

            return true;
        });
    });

    // Dynamic stats computation over filtered set
    let stats = $derived.by(() => {
        const total = filteredSubmissions.length;

        const graded = filteredSubmissions.filter(
            (s) => !s.skipped && s.is_correct !== null,
        );
        const correct = graded.filter((s) => s.is_correct === true).length;

        const accuracy =
            graded.length === 0
                ? "0%"
                : `${Math.round((correct / graded.length) * 100)}%`;

        // Solved count (unique problems solved correctly)
        const solvedSet = new Set(
            filteredSubmissions
                .filter((s) => s.is_correct)
                .map((s) => s.problem_id),
        );
        const solved = solvedSet.size;

        // Time spent
        const totalMs = filteredSubmissions.reduce(
            (acc, s) => acc + (s.elapsed_ms ?? 0),
            0,
        );

        const formatTotalTime = (ms: number) => {
            const totalSec = Math.floor(ms / 1000);
            const hrs = Math.floor(totalSec / 3600);
            const mins = Math.floor((totalSec % 3600) / 60);
            const secs = totalSec % 60;
            if (hrs > 0) {
                return `${hrs}h ${mins}m`;
            }
            if (mins > 0) {
                return `${mins}m ${secs}s`;
            }
            return `${secs}s`;
        };
        const timeSpent = formatTotalTime(totalMs);

        return { total, accuracy, solved, timeSpent };
    });

    // Formatting date headers
    function getDayLabel(dateStr: string): string {
        const date = new Date(dateStr);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) {
            return "Today";
        }
        if (date.toDateString() === yesterday.toDateString()) {
            return "Yesterday";
        }

        return date.toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
        });
    }

    // Grouping filtered list by calendar day
    let groupedSubmissions = $derived.by(() => {
        const groupsMap: Record<string, RecentSubmissionRow[]> = {};
        for (const sub of filteredSubmissions) {
            const label = getDayLabel(sub.created_at);
            if (!groupsMap[label]) {
                groupsMap[label] = [];
            }
            groupsMap[label].push(sub);
        }
        return Object.entries(groupsMap).map(([dayLabel, items]) => ({
            dayLabel,
            items,
        }));
    });

    // Clear filters
    let hasActiveFilters = $derived(
        selectedOutcomes.length > 0 ||
            timeRange !== "all" ||
            startDate !== "" ||
            endDate !== "" ||
            ratingRange[0] > MIN_RATING ||
            ratingRange[1] < MAX_RATING ||
            hasSolutionsFilter !== "neutral",
    );

    function resetFilters() {
        selectedOutcomes = [];
        timeRange = "all";
        startDate = "";
        endDate = "";
        ratingRange = [MIN_RATING, MAX_RATING];
        hasSolutionsFilter = "neutral";
    }

    // Mini elapsed time formatter for each history row
    function formatElapsed(ms: number | null) {
        if (ms == null) return "0s";
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    }

    function formatTimeOfDay(dateStr: string): string {
        return new Date(dateStr).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
        });
    }

    const selectOptions = [
        { value: "all", label: "All Time" },
        { value: "today", label: "Today" },
        { value: "week", label: "Past 7 Days" },
        { value: "month", label: "Past 30 Days" },
        { value: "custom", label: "Custom Range..." },
    ];

    const outcomeOptions = [
        { value: "correct", label: "Correct" },
        { value: "incorrect", label: "Incorrect" },
        { value: "ungraded", label: "Ungraded" },
        { value: "skipped", label: "Skipped" },
    ];
</script>

<svelte:head><title>History · ProblemCloud</title></svelte:head>

<Page.Root width="standard">
    <Page.Header
        title="Progress"
        description="Understand what needs attention, review your work, and follow your development over time."
    >
        {#snippet actions()}
            <Button href="/practice" size="lg">Start targeted practice</Button>
        {/snippet}
    </Page.Header>

    <ProgressNav active="history" />

    {#if !user}
        <div class="flex flex-col items-center gap-4 py-16 text-center">
            <div>
                <h2 class="type-section-title text-foreground">Sign in to view your history</h2>
                <p class="mt-1 type-secondary text-muted-foreground">
                    Your submission history is recorded automatically while you practice.
                </p>
            </div>
            <Button href="/auth/login">Log in</Button>
        </div>
    {:else}
        <Page.Section
            title="History"
            description="Review past submissions and reopen the problem and solution."
        >
            <div class="grid grid-cols-2 border-y border-border md:grid-cols-4">
                <div class="py-4 pr-4">
                    <div class="type-code text-foreground">{stats.total}</div>
                    <div class="type-caption text-muted-foreground">attempts</div>
                </div>
                <div class="border-l border-border py-4 pl-4 md:px-5">
                    <div class="type-code text-foreground">{stats.accuracy}</div>
                    <div class="type-caption text-muted-foreground">accuracy</div>
                </div>
                <div class="border-t border-border py-4 pr-4 md:border-l md:border-t-0 md:px-5">
                    <div class="type-code text-foreground">{stats.solved}</div>
                    <div class="type-caption text-muted-foreground">solved</div>
                </div>
                <div class="border-l border-t border-border py-4 pl-4 md:border-t-0 md:pl-5">
                    <div class="type-code text-foreground">{stats.timeSpent}</div>
                    <div class="type-caption text-muted-foreground">time spent</div>
                </div>
            </div>
        </Page.Section>

        <Page.Toolbar>
            <div class="grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label class="flex min-w-0 flex-col gap-1.5">
                    <span class="type-caption text-muted-foreground">Outcome</span>
                    <Combobox
                        options={outcomeOptions}
                        strict
                        bind:value={selectedOutcomes}
                        placeholder="All outcomes"
                        inputPlaceholder="Add outcome…"
                    />
                </label>
                <label class="flex min-w-0 flex-col gap-1.5">
                    <span class="type-caption text-muted-foreground">Time range</span>
                    <Select options={selectOptions} bind:value={timeRange} />
                </label>
                <label class="flex min-w-0 flex-col gap-1.5">
                    <span class="type-caption text-muted-foreground">
                        Rating {ratingRange[0]}–{ratingRange[1]}
                    </span>
                    <div class="px-1 pt-2">
                        <RangeSlider
                            bind:value={ratingRange}
                            min={MIN_RATING}
                            max={MAX_RATING}
                            step={50}
                            label="Rating"
                        />
                    </div>
                </label>
                <div class="flex min-w-0 flex-col gap-1.5">
                    <span class="type-caption text-muted-foreground">Has solutions</span>
                    <div class="flex min-h-9 items-center gap-2">
                        <TriStateSwitch bind:value={hasSolutionsFilter} size="sm" />
                        <span class="type-caption text-muted-foreground">
                            {hasSolutionsFilter === "on"
                                ? "Yes"
                                : hasSolutionsFilter === "off"
                                  ? "No"
                                  : "Any"}
                        </span>
                    </div>
                </div>
                {#if timeRange === "custom"}
                    <label class="flex min-w-0 flex-col gap-1.5">
                        <span class="type-caption text-muted-foreground">Start date</span>
                        <DatePicker bind:value={startDate} placeholder="Start date" max={endDate || undefined} />
                    </label>
                    <label class="flex min-w-0 flex-col gap-1.5">
                        <span class="type-caption text-muted-foreground">End date</span>
                        <DatePicker bind:value={endDate} placeholder="End date" min={startDate || undefined} />
                    </label>
                {/if}
            </div>
            {#if hasActiveFilters}
                <Button variant="ghost" size="sm" onclick={resetFilters}>Clear filters</Button>
            {/if}
        </Page.Toolbar>

        {#if loading && submissions.length === 0}
            <div class="flex items-center justify-center gap-2 py-16 type-secondary text-muted-foreground">
                <Icon name="progress_activity" class="animate-spin" />
                Loading history…
            </div>
        {:else if errorMsg}
            <p class="rounded-lg bg-destructive/10 p-4 type-secondary text-destructive">{errorMsg}</p>
        {:else if filteredSubmissions.length === 0}
            <div class="flex flex-col items-center gap-4 py-16 text-center">
                <div>
                    <h2 class="type-section-title text-foreground">No submissions found</h2>
                    <p class="mt-1 type-secondary text-muted-foreground">
                        {hasActiveFilters
                            ? "Try clearing the current filters."
                            : "Start practicing to see your attempts here."}
                    </p>
                </div>
                {#if hasActiveFilters}
                    <Button onclick={resetFilters}>Clear filters</Button>
                {:else}
                    <Button href="/practice">Start practicing</Button>
                {/if}
            </div>
        {:else}
            <div class="space-y-8">
                {#each groupedSubmissions as group (group.dayLabel)}
                    <section aria-labelledby={`history-${group.dayLabel.replaceAll(" ", "-")}`}>
                        <h2
                            id={`history-${group.dayLabel.replaceAll(" ", "-")}`}
                            class="type-section-title text-foreground"
                        >
                            {group.dayLabel}
                        </h2>
                        <div class="mt-3 border-t border-border">
                            {#each group.items as sub (sub.id)}
                                {@const isExpanded = expandedIds.has(sub.id)}
                                <div class="border-b border-border">
                                    <button
                                        type="button"
                                        onclick={() => toggleExpand(sub.id)}
                                        aria-expanded={isExpanded}
                                        class="grid min-h-16 w-full gap-3 py-4 text-left transition-colors hover:bg-muted/40 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:items-center sm:gap-5 sm:px-2"
                                    >
                                        <StatusTag
                                            class="w-fit"
                                            status={submissionOutcome(sub)}
                                        />
                                        <div class="min-w-0">
                                            <span class="type-body text-foreground">
                                                {sub.problems?.tests?.name ?? "Practice problem"}
                                                <span class="text-muted-foreground">
                                                    · Problem {(sub.problems?.n ?? 0) + 1}
                                                </span>
                                            </span>
                                            <span class="mt-0.5 flex flex-wrap gap-x-2 type-caption text-muted-foreground">
                                                <span>{formatTimeOfDay(sub.created_at)}</span>
                                                <span>{sub.source}</span>
                                            </span>
                                        </div>
                                        <span class="type-code text-muted-foreground">
                                            {formatElapsed(sub.elapsed_ms)}
                                        </span>
                                        <Icon
                                            name={isExpanded ? "expand_less" : "expand_more"}
                                            class="text-muted-foreground"
                                        />
                                    </button>

                                    {#if isExpanded}
                                        <div class="border-t border-border bg-surface-container-low/30 px-4 py-5">
                                            {#if sub.problems}
                                                <ProblemReview
                                                    entry={{
                                                        problem: sub.problems,
                                                        selectedChoice: sub.selected_choice,
                                                        answer: sub.answer ?? "",
                                                        correct: sub.is_correct,
                                                        flagged: sub.flagged,
                                                        skipped: sub.skipped,
                                                    }}
                                                    showHeader={false}
                                                    autoRevealSolution={false}
                                                    showOrganization
                                                    class="border-0 bg-transparent p-0"
                                                />
                                            {:else}
                                                <p class="type-secondary text-muted-foreground">
                                                    Problem details could not be loaded.
                                                </p>
                                            {/if}
                                        </div>
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    </section>
                {/each}

                {#if submissions.length >= limit}
                    <div class="flex justify-center">
                        <Button variant="outline" onclick={() => (limit += 100)}>
                            Load more attempts
                        </Button>
                    </div>
                {/if}
            </div>
        {/if}
    {/if}
</Page.Root>
