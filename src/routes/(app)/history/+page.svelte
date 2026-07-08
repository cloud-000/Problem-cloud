<script lang="ts">
    import type { PageData } from "./$types";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { StatusTag } from "$lib/components/status-tag";
    import { Combobox } from "$lib/components/combobox";
    import { Select } from "$lib/components/select";
    import { Input } from "$lib/components/input";
    import { DatePicker } from "$lib/components/date-picker";
    import { Problem } from "$lib/components/problem";
    import {
        fetchRecentSubmissions,
        type RecentSubmissionRow,
    } from "$lib/progress";
    import { cn } from "$lib/utils";

    let { data }: { data: PageData } = $props();
    let { supabase, user } = $derived(data);

    // Filter state
    let selectedOutcomes = $state<string[]>([]);
    let timeRange = $state("all");
    let startDate = $state("");
    let endDate = $state("");
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
                let outcome = "skipped";
                if (!sub.skipped) {
                    outcome = sub.is_correct ? "correct" : "incorrect";
                }
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

            return true;
        });
    });

    // Dynamic stats computation over filtered set
    let stats = $derived.by(() => {
        const total = filteredSubmissions.length;

        // Graded attempts (not skipped)
        const graded = filteredSubmissions.filter((s) => !s.skipped);
        const correct = graded.filter((s) => s.is_correct).length;

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
            endDate !== "",
    );

    function resetFilters() {
        selectedOutcomes = [];
        timeRange = "all";
        startDate = "";
        endDate = "";
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
        { value: "skipped", label: "Skipped" },
    ];
</script>

<div class="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
    <!-- Header -->
    <div class="border-b border-border/80 pb-4 space-y-1">
        <h1
            class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2"
        >
            <Icon
                name="history"
                fontsize="2rem"
                class="text-primary-foreground"
            />
            History
        </h1>
        <p class="text-sm text-muted-foreground">
            Track your practice history and review past problem-solving
            attempts.
        </p>
    </div>

    {#if !user}
        <!-- Unauthenticated Prompt -->
        <div
            class="flex flex-col items-center justify-center gap-4 text-center py-16"
        >
            <div
                class="flex size-16 items-center justify-center rounded-full bg-surface-container text-muted-foreground"
            >
                <Icon name="history" fontsize="2.5rem" />
            </div>
            <div class="flex max-w-5xl flex-col gap-1">
                <h2 class="text-lg font-semibold">
                    Sign in to view your history
                </h2>
                <p class="text-sm text-muted-foreground">
                    We track your progress and submission history automatically
                    once you are logged in.
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
        <!-- Stats Summary Block (Dynamic) -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div
                class="p-4 rounded-xl border border-border/60 bg-surface-container-low flex flex-col justify-center"
            >
                <div
                    class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                    Total Attempts
                </div>
                <div class="mt-2 text-2xl font-bold text-foreground font-mono">
                    {stats.total}
                </div>
            </div>
            <div
                class="p-4 rounded-xl border border-border/60 bg-surface-container-low flex flex-col justify-center"
            >
                <div
                    class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                    Accuracy
                </div>
                <div class="mt-2 text-2xl font-bold text-foreground font-mono">
                    {stats.accuracy}
                </div>
            </div>
            <div
                class="p-4 rounded-xl border border-border/60 bg-surface-container-low flex flex-col justify-center"
            >
                <div
                    class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                    Solved Count
                </div>
                <div class="mt-2 text-2xl font-bold text-foreground font-mono">
                    {stats.solved}
                </div>
            </div>
            <div
                class="p-4 rounded-xl border border-border/60 bg-surface-container-low flex flex-col justify-center"
            >
                <div
                    class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                    Time Spent
                </div>
                <div class="mt-2 text-2xl font-bold text-foreground font-mono">
                    {stats.timeSpent}
                </div>
            </div>
        </div>

        <!-- Filters Panel -->
        <div
            class="flex flex-col md:flex-row gap-4 items-end bg-surface-container-low p-4 rounded-xl border border-border/60"
        >
            <div class="flex flex-col gap-1.5 md:w-64 w-full">
                <span
                    class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >Outcome</span
                >
                <Combobox
                    options={outcomeOptions}
                    strict
                    bind:value={selectedOutcomes}
                    placeholder="Filter outcomes..."
                    inputPlaceholder="Add filter..."
                />
            </div>

            <div class="flex flex-col gap-1.5 md:w-48 w-full">
                <span
                    class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >Time Range</span
                >
                <Select
                    options={selectOptions}
                    bind:value={timeRange}
                    placeholder="Select range..."
                />
            </div>

            {#if timeRange === "custom"}
                <div class="flex flex-col gap-1.5 md:w-40 w-full">
                    <span
                        class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                        >Start Date</span
                    >
                    <DatePicker
                        bind:value={startDate}
                        placeholder="Start date"
                        max={endDate || undefined}
                    />
                </div>
                <div class="flex flex-col gap-1.5 md:w-40 w-full">
                    <span
                        class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                        >End Date</span
                    >
                    <DatePicker
                        bind:value={endDate}
                        placeholder="End date"
                        min={startDate || undefined}
                    />
                </div>
            {/if}

            {#if hasActiveFilters}
                <Button
                    variant="ghost"
                    onclick={resetFilters}
                    class="text-muted-foreground hover:text-foreground text-xs font-normal gap-1 px-3 h-9 md:w-auto w-full border border-dashed border-border"
                >
                    <Icon name="clear" class="size-[1.2em]" />
                    Clear Filters
                </Button>
            {/if}
        </div>

        <!-- History Feed -->
        {#if loading && submissions.length === 0}
            <div class="flex flex-col items-center justify-center py-16 gap-3">
                <Icon
                    name="progress_activity"
                    class="animate-spin text-muted-foreground"
                    fontsize="1.8rem"
                />
                <p class="text-xs text-muted-foreground">Loading history...</p>
            </div>
        {:else if errorMsg}
            <div
                class="p-4 rounded-lg bg-destructive/10 text-destructive text-sm text-center"
            >
                {errorMsg}
            </div>
        {:else if filteredSubmissions.length === 0}
            <div
                class="flex flex-col items-center justify-center py-16 gap-3 text-center"
            >
                <div
                    class="flex size-12 items-center justify-center rounded-full bg-surface-container text-muted-foreground"
                >
                    <Icon name="history_toggle_off" fontsize="1.8rem" />
                </div>
                <div>
                    <h3 class="text-sm font-semibold">No submissions found</h3>
                    <p class="text-xs text-muted-foreground mt-0.5">
                        {hasActiveFilters
                            ? "Try resetting the filters."
                            : "Start practicing to see your attempts here!"}
                    </p>
                </div>
                {#if hasActiveFilters}
                    <Button size="sm" onclick={resetFilters} class="mt-1"
                        >Clear Filters</Button
                    >
                {:else}
                    <Button size="sm" href="/practice" class="mt-1"
                        >Go Practice</Button
                    >
                {/if}
            </div>
        {:else}
            <div class="space-y-6">
                {#each groupedSubmissions as group}
                    <div class="space-y-3">
                        <h2
                            class="text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border/40 pb-1"
                        >
                            {group.dayLabel}
                        </h2>

                        <div class="space-y-2">
                            {#each group.items as sub (sub.id)}
                                {@const isExpanded = expandedIds.has(sub.id)}
                                <div
                                    class="rounded-xl border border-border/60 bg-surface-container-lowest overflow-hidden transition-all duration-200 shadow-xs hover:border-border"
                                >
                                    <!-- Card Header/Summary Row -->
                                    <button
                                        type="button"
                                        onclick={() => toggleExpand(sub.id)}
                                        class="w-full flex items-center justify-between gap-4 p-4 text-left outline-none cursor-pointer select-none hover:bg-surface-container-low/30 transition-colors"
                                    >
                                        <div
                                            class="flex items-center gap-3 min-w-0 flex-1"
                                        >
                                            <!-- Outcome Indicator Badge -->
                                            <StatusTag
                                                class="shrink-0"
                                                status={sub.skipped
                                                    ? "skipped"
                                                    : sub.is_correct
                                                      ? "correct"
                                                      : "incorrect"}
                                            />

                                            <!-- Metadata: Test name and Problem number -->
                                            <div class="flex flex-col min-w-0">
                                                <span
                                                    class="text-sm font-semibold text-foreground truncate"
                                                >
                                                    {#if sub.problems?.tests?.name}
                                                        {sub.problems.tests
                                                            .name}
                                                    {:else}
                                                        Practice Problem
                                                    {/if}
                                                    <span
                                                        class="text-muted-foreground font-normal"
                                                    >
                                                        • Problem {(sub.problems
                                                            ?.n ?? 0) + 1}
                                                    </span>
                                                </span>
                                                <span
                                                    class="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5"
                                                >
                                                    <span
                                                        >{formatTimeOfDay(
                                                            sub.created_at,
                                                        )}</span
                                                    >
                                                    <span>•</span>
                                                    <span
                                                        >{formatElapsed(
                                                            sub.elapsed_ms,
                                                        )}</span
                                                    >
                                                    {#if sub.source}
                                                        <span>•</span>
                                                        <span
                                                            class="uppercase tracking-wider text-[9px] font-bold bg-muted px-1 py-0.2 rounded border border-border/50"
                                                        >
                                                            {sub.source}
                                                        </span>
                                                    {/if}
                                                </span>
                                            </div>
                                        </div>

                                        <div
                                            class="flex items-center gap-3 shrink-0"
                                        >
                                            {#if sub.flagged}
                                                <Icon
                                                    name="flag"
                                                    class="text-unsure size-[1.2rem]"
                                                    fill
                                                />
                                            {/if}
                                            <Icon
                                                name={isExpanded
                                                    ? "expand_less"
                                                    : "expand_more"}
                                                class="text-muted-foreground transition-transform duration-200"
                                            />
                                        </div>
                                    </button>

                                    <!-- Expanded Card Body (Problem Details) -->
                                    {#if isExpanded}
                                        <div
                                            class="border-t border-border/40 p-4 bg-surface-container-low/10"
                                        >
                                            {#if sub.problems}
                                                <Problem
                                                    problem={sub.problems}
                                                    selectedChoice={sub.selected_choice}
                                                    showAnswerState={true}
                                                    disabled={true}
                                                    mode="preview"
                                                />
                                            {:else}
                                                <p
                                                    class="text-xs text-muted-foreground italic"
                                                >
                                                    Problem details could not be
                                                    loaded.
                                                </p>
                                            {/if}
                                        </div>
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    </div>
                {/each}

                <!-- Load More Button -->
                {#if submissions.length >= limit}
                    <div class="flex justify-center pt-2">
                        <Button
                            variant="outline"
                            onclick={() => (limit += 100)}
                            class="text-xs font-semibold px-6 py-2 shadow-xs"
                        >
                            Load More Attempts
                        </Button>
                    </div>
                {/if}
            </div>
        {/if}
    {/if}
</div>
