<script lang="ts">
    import { onMount } from "svelte";
    import { Icon } from "$lib/components/icon";
    import { Button } from "$lib/components/button";
    import { Input } from "$lib/components/input";
    import { Select } from "$lib/components/select";
    import { DatePicker } from "$lib/components/date-picker";
    import { Modal } from "$lib/components/modal";
    import LaTeX from "$lib/components/LaTeX.svelte";
    import { toasts } from "$lib/state/toast.svelte";
    import { cn } from "$lib/utils";
    import {
        fetchRoadmap,
        voteGoal,
        unvoteGoal,
        createGoal,
        updateGoal,
        deleteGoal,
        type RoadmapGoalWithVotes,
        type RoadmapStatus,
    } from "$lib/roadmap";
    import type { PageData } from "./$types";

    let { data }: { data: PageData } = $props();
    let { supabase, session, profile } = $derived(data);

    // User auth variables
    let userId = $derived(session?.user?.id);
    let isAdmin = $derived((profile?.admin_rank ?? 0) > 10);

    // Roadmap items state
    let goals = $state<RoadmapGoalWithVotes[]>([]);
    let loading = $state(true);

    // Modal forms states
    let showAddModal = $state(false);
    let showEditModal = $state(false);
    let showDeleteConfirmModal = $state(false);

    // Form inputs for creating/editing
    let selectedGoal = $state<RoadmapGoalWithVotes | null>(null);
    let formTitle = $state("");
    let formDescription = $state("");
    let formStatus = $state<RoadmapStatus>("future");
    let formPlannedDate = $state(""); // YYYY-MM-DD
    let isSubmitting = $state(false);

    // Load data from Supabase
    async function loadData() {
        loading = true;
        try {
            goals = await fetchRoadmap(supabase);
        } catch (error) {
            console.error(error);
            toasts.error("Failed to load roadmap data.");
        } finally {
            loading = false;
        }
    }

    onMount(() => {
        loadData();
    });

    // Helper: compute counts and aggregate votes for each goal
    let processedGoals = $derived.by(() => {
        return goals.map((goal) => {
            let upvotes = 0;
            let downvotes = 0;
            let userVoteValue: number | null = null;

            for (const v of goal.roadmap_votes) {
                if (v.vote_value === 1) upvotes++;
                else if (v.vote_value === -1) downvotes++;

                if (userId && v.profile_id === userId) {
                    userVoteValue = v.vote_value;
                }
            }

            return {
                ...goal,
                upvotes,
                downvotes,
                net_score: upvotes - downvotes,
                user_vote: userVoteValue,
            };
        });
    });

    // Grouping by columns for the Kanban board
    let columns = $derived.by(() => {
        const futureItems = processedGoals
            .filter((g) => g.status === "future")
            .sort(
                (a, b) =>
                    b.net_score - a.net_score ||
                    new Date(b.created_at).getTime() -
                        new Date(a.created_at).getTime(),
            );
        const activeItems = processedGoals
            .filter((g) => g.status === "active")
            .sort(
                (a, b) =>
                    b.net_score - a.net_score ||
                    new Date(b.created_at).getTime() -
                        new Date(a.created_at).getTime(),
            );
        const doneItems = processedGoals
            .filter((g) => g.status === "done")
            .sort(
                (a, b) =>
                    b.net_score - a.net_score ||
                    new Date(b.created_at).getTime() -
                        new Date(a.created_at).getTime(),
            );

        return [
            {
                id: "future" as const,
                title: "Future",
                items: futureItems,
                icon: "event_upcoming",
                colorClass: "border-t-4 border-t-amber-500",
                textClass: "text-amber-500",
                badgeClass:
                    "bg-amber-500/10 text-amber-500 border border-amber-500/20",
            },
            {
                id: "active" as const,
                title: "Active",
                items: activeItems,
                icon: "schedule",
                colorClass: "border-t-4 border-t-blue-500",
                textClass: "text-blue-500",
                badgeClass:
                    "bg-blue-500/10 text-blue-500 border border-blue-500/20",
            },
            {
                id: "done" as const,
                title: "Done",
                items: doneItems,
                icon: "task_alt",
                colorClass: "border-t-4 border-t-emerald-500",
                textClass: "text-emerald-500",
                badgeClass:
                    "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20",
            },
        ];
    });

    async function handleVote(
        goalId: number,
        currentVote: number | null,
        voteVal: 1 | -1,
    ) {
        if (!userId) {
            toasts.error("Please log in to vote on features.");
            return;
        }

        try {
            if (currentVote === voteVal) {
                // Clicking the active vote button again: retract the vote
                // Optimistic update
                goals = goals.map((g) => {
                    if (g.id === goalId) {
                        return {
                            ...g,
                            roadmap_votes: g.roadmap_votes.filter(
                                (v) => v.profile_id !== userId,
                            ),
                        };
                    }
                    return g;
                });
                await unvoteGoal(supabase, goalId, userId);
            } else {
                // Upsert/change vote
                // Optimistic update
                goals = goals.map((g) => {
                    if (g.id === goalId) {
                        const otherVotes = g.roadmap_votes.filter(
                            (v) => v.profile_id !== userId,
                        );
                        return {
                            ...g,
                            roadmap_votes: [
                                ...otherVotes,
                                {
                                    goal_id: goalId,
                                    profile_id: userId,
                                    vote_value: voteVal,
                                },
                            ],
                        };
                    }
                    return g;
                });
                await voteGoal(supabase, goalId, userId, voteVal);
            }
        } catch (error) {
            console.error(error);
            toasts.error("Failed to register your vote.");
            // Revert changes by refetching
            loadData();
        }
    }

    function openAddModal() {
        formTitle = "";
        formDescription = "";
        formStatus = "future";
        formPlannedDate = "";
        showAddModal = true;
    }

    async function handleAddGoal() {
        if (!formTitle || !formDescription) {
            toasts.error("Please fill in the title and description.");
            return;
        }
        isSubmitting = true;
        try {
            const newGoal = await createGoal(supabase, {
                title: formTitle,
                description: formDescription,
                status: formStatus,
                planned_date: formPlannedDate || null,
            });

            const goalWithVotes: RoadmapGoalWithVotes = {
                ...newGoal,
                roadmap_votes: [],
            };

            goals = [goalWithVotes, ...goals];
            showAddModal = false;
            toasts.success("Roadmap goal created successfully.");
        } catch (error) {
            console.error(error);
            toasts.error("Failed to create goal.");
        } finally {
            isSubmitting = false;
        }
    }

    function openEditModal(goal: RoadmapGoalWithVotes) {
        selectedGoal = goal;
        formTitle = goal.title;
        formDescription = goal.description;
        formStatus = goal.status as RoadmapStatus;
        formPlannedDate = goal.planned_date || "";
        showEditModal = true;
    }

    async function handleEditGoal() {
        if (!selectedGoal) return;
        if (!formTitle || !formDescription) {
            toasts.error("Title and description are required.");
            return;
        }
        isSubmitting = true;
        try {
            const updated = await updateGoal(supabase, selectedGoal.id, {
                title: formTitle,
                description: formDescription,
                status: formStatus,
                planned_date: formPlannedDate || null,
            });

            goals = goals.map((g) => {
                if (g.id === selectedGoal!.id) {
                    return {
                        ...g,
                        ...updated,
                    };
                }
                return g;
            });

            showEditModal = false;
            toasts.success("Goal updated successfully.");
        } catch (error) {
            console.error(error);
            toasts.error("Failed to update goal.");
        } finally {
            isSubmitting = false;
        }
    }

    function openDeleteConfirm(goal: RoadmapGoalWithVotes) {
        selectedGoal = goal;
        showDeleteConfirmModal = true;
    }

    async function handleDeleteGoal() {
        if (!selectedGoal) return;
        isSubmitting = true;
        try {
            await deleteGoal(supabase, selectedGoal.id);
            goals = goals.filter((g) => g.id !== selectedGoal!.id);
            showDeleteConfirmModal = false;
            toasts.success("Goal deleted successfully.");
        } catch (error) {
            console.error(error);
            toasts.error("Failed to delete goal.");
        } finally {
            isSubmitting = false;
        }
    }

    const STAGE_ORDER: RoadmapStatus[] = ["future", "active", "done"];

    async function moveStage(goal: RoadmapGoalWithVotes, direction: 1 | -1) {
        const currentIndex = STAGE_ORDER.indexOf(goal.status as RoadmapStatus);
        const nextIndex = currentIndex + direction;
        if (nextIndex < 0 || nextIndex >= STAGE_ORDER.length) return;

        const nextStatus = STAGE_ORDER[nextIndex];

        // Optimistic update
        goals = goals.map((g) => {
            if (g.id === goal.id) {
                return {
                    ...g,
                    status: nextStatus,
                    updated_at: new Date().toISOString(),
                };
            }
            return g;
        });

        try {
            await updateGoal(supabase, goal.id, {
                title: goal.title,
                description: goal.description,
                status: nextStatus,
                planned_date: goal.planned_date,
            });
            toasts.success(
                `Moved feature to "${nextStatus.charAt(0).toUpperCase() + nextStatus.slice(1)}".`,
            );
        } catch (error) {
            console.error(error);
            toasts.error("Failed to update goal stage.");
            // Revert on error
            loadData();
        }
    }

    function formatDate(dateStr: string | null) {
        if (!dateStr) return "TBD";
        const parts = dateStr.split("-");
        if (parts.length < 3) return dateStr;
        const year = parts[0];
        const monthIndex = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);

        const date = new Date(Date.UTC(parseInt(year, 10), monthIndex, day));
        const monthName = date.toLocaleString("en-US", {
            month: "short",
            timeZone: "UTC",
        });
        return `${monthName} ${day}, ${year}`;
    }
</script>

<div class="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full">
    <!-- Header -->
    <div
        class="border-b border-border/80 pb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
    >
        <div class="space-y-1">
            <h1
                class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2"
            >
                <Icon
                    name="map"
                    fontsize="2rem"
                    class="text-primary-foreground"
                />
                Roadmap
            </h1>

        </div>
        {#if isAdmin}
            <Button
                onclick={openAddModal}
                class="flex items-center gap-1.5 shadow-xs shrink-0 self-start md:self-center"
            >
                <Icon name="add" />
                Add Goal
            </Button>
        {/if}
    </div>

    <!-- Kanban Board Grid -->
    {#if loading}
        <div
            class="flex flex-col items-center justify-center py-20 gap-3 text-center"
        >
            <Icon
                name="hourglass_empty"
                class="text-muted-foreground animate-spin"
                fontsize="3rem"
            />
            <p class="text-sm text-muted-foreground">Loading roadmap...</p>
        </div>
    {:else}
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {#each columns as col}
                <div
                    class="flex flex-col rounded-2xl bg-surface-container-low/40 border border-border/60 shadow-xs min-h-[600px] overflow-hidden"
                >
                    <!-- Column Header -->
                    <div
                        class={cn(
                            "px-4 py-3 bg-surface-container/60 flex items-center justify-between border-b border-border/60",
                            col.colorClass,
                        )}
                    >
                        <div
                            class="flex items-center gap-2 font-semibold text-sm text-foreground"
                        >
                            <Icon name={col.icon} class={col.textClass} />
                            <span>{col.title}</span>
                            <span
                                class={cn(
                                    "text-xs px-2 py-0.5 rounded-full font-medium",
                                    col.badgeClass,
                                )}
                            >
                                {col.items.length}
                            </span>
                        </div>
                    </div>

                    <!-- Column Cards -->
                    <div
                        class="flex-1 p-4 flex flex-col gap-4 overflow-y-auto max-h-[70vh]"
                    >
                        {#if col.items.length === 0}
                            <div
                                class="flex-1 flex flex-col items-center justify-center py-16 px-4 border-2 border-dashed border-border/40 rounded-xl text-center"
                            >
                                <div
                                    class="flex size-10 items-center justify-center rounded-full bg-surface-container mb-2 text-muted-foreground/50"
                                >
                                    <Icon name="inbox" fontsize="1.5rem" />
                                </div>
                                <span
                                    class="text-xs font-semibold text-foreground"
                                    >No features here</span
                                >
                                <span
                                    class="text-[10px] text-muted-foreground mt-0.5"
                                    >Nothing has been catalogued in this phase
                                    yet.</span
                                >
                            </div>
                        {:else}
                            {#each col.items as goal (goal.id)}
                                <div
                                    class="group relative flex flex-col justify-between p-5 rounded-xl bg-surface-container-lowest border border-border/80 hover:border-primary-foreground/30 hover:shadow-xs transition-all duration-200 gap-3 h-fit"
                                >
                                    <!-- Title & Admin Controls -->
                                    <div
                                        class="flex items-start justify-between gap-4"
                                    >
                                        <h3
                                            class="font-semibold text-sm text-foreground leading-snug tracking-tight"
                                        >
                                            {goal.title}
                                        </h3>

                                        {#if isAdmin}
                                            <div
                                                class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                            >
                                                {#if goal.status !== "future"}
                                                    <button
                                                        onclick={() =>
                                                            moveStage(goal, -1)}
                                                        class="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-container transition-colors cursor-pointer"
                                                        title="Move backward"
                                                    >
                                                        <Icon
                                                            name="arrow_back"
                                                            fontsize="16px"
                                                        />
                                                    </button>
                                                {/if}
                                                {#if goal.status !== "done"}
                                                    <button
                                                        onclick={() =>
                                                            moveStage(goal, 1)}
                                                        class="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-container transition-colors cursor-pointer"
                                                        title="Move forward"
                                                    >
                                                        <Icon
                                                            name="arrow_forward"
                                                            fontsize="16px"
                                                        />
                                                    </button>
                                                {/if}
                                                <button
                                                    onclick={() =>
                                                        openEditModal(goal)}
                                                    class="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-container transition-colors cursor-pointer"
                                                    title="Edit Goal"
                                                >
                                                    <Icon
                                                        name="edit"
                                                        fontsize="16px"
                                                    />
                                                </button>
                                                <button
                                                    onclick={() =>
                                                        openDeleteConfirm(goal)}
                                                    class="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                                                    title="Delete Goal"
                                                >
                                                    <Icon
                                                        name="delete"
                                                        fontsize="16px"
                                                    />
                                                </button>
                                            </div>
                                        {/if}
                                    </div>

                                    <!-- Description (LaTeX block) -->
                                    <div
                                        class="text-xs text-muted-foreground font-normal leading-normal break-words min-w-0"
                                    >
                                        <LaTeX class="whitespace-pre-wrap"
                                            >{goal.description}</LaTeX
                                        >
                                    </div>

                                    <!-- Footer (Target Date & Votes widget) -->
                                    <div
                                        class="flex items-center justify-between gap-2 border-t border-border/30 pt-2 mt-auto min-h-fit"
                                    >
                                        <span
                                            class="inline-flex h-7 min-w-0 shrink items-center gap-1 overflow-hidden whitespace-nowrap text-[11px] font-medium text-muted-foreground bg-surface-container-high/40 rounded-full px-2.5 border border-border/20"
                                        >
                                            <Icon
                                                name="calendar_month"
                                                fontsize="12px"
                                                class="text-muted-foreground shrink-0"
                                            />
                                            <span class="truncate"
                                                >{formatDate(
                                                    goal.planned_date,
                                                )}</span
                                            >
                                        </span>

                                        <!-- Votes -->
                                        <div
                                            class="flex h-7 items-center gap-0.5 shrink-0 bg-surface-container/40 rounded-lg p-0.5 border border-border/30"
                                        >
                                            <button
                                                onclick={() =>
                                                    handleVote(
                                                        goal.id,
                                                        goal.user_vote,
                                                        1,
                                                    )}
                                                class={cn(
                                                    "p-1 rounded-md hover:bg-surface-container-high transition-all duration-150 flex items-center justify-center cursor-pointer",
                                                    goal.user_vote === 1
                                                        ? "text-primary-foreground font-semibold"
                                                        : "text-muted-foreground/60 hover:text-foreground",
                                                )}
                                                title={goal.user_vote === 1
                                                    ? "Retract upvote"
                                                    : "Upvote"}
                                            >
                                                <Icon
                                                    name="keyboard_arrow_up"
                                                    fontsize="18px"
                                                    fill={goal.user_vote === 1}
                                                />
                                            </button>

                                            <span
                                                class={cn(
                                                    "text-xs font-semibold px-1.5 min-w-[20px] text-center",
                                                    goal.net_score > 0
                                                        ? "text-primary-foreground"
                                                        : goal.net_score < 0
                                                          ? "text-destructive"
                                                          : "text-muted-foreground",
                                                )}
                                            >
                                                {goal.net_score > 0
                                                    ? `+${goal.net_score}`
                                                    : goal.net_score}
                                            </span>

                                            <button
                                                onclick={() =>
                                                    handleVote(
                                                        goal.id,
                                                        goal.user_vote,
                                                        -1,
                                                    )}
                                                class={cn(
                                                    "p-1 rounded-md hover:bg-surface-container-high transition-all duration-150 flex items-center justify-center cursor-pointer",
                                                    goal.user_vote === -1
                                                        ? "text-destructive font-semibold"
                                                        : "text-muted-foreground/60 hover:text-foreground",
                                                )}
                                                title={goal.user_vote === -1
                                                    ? "Retract downvote"
                                                    : "Downvote"}
                                            >
                                                <Icon
                                                    name="keyboard_arrow_down"
                                                    fontsize="18px"
                                                    fill={goal.user_vote === -1}
                                                />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            {/each}
                        {/if}
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>

<!-- Add Goal Modal -->
<Modal
    bind:open={showAddModal}
    title="Create Roadmap Goal"
    description="Add a new goal or feature request to the application roadmap."
    size="md"
>
    <form
        onsubmit={(e) => {
            e.preventDefault();
            handleAddGoal();
        }}
        class="space-y-4 py-2"
    >
        <div class="flex flex-col gap-1.5">
            <label for="add-title" class="text-xs font-medium text-foreground"
                >Title</label
            >
            <Input
                id="add-title"
                placeholder="Feature title..."
                bind:value={formTitle}
                required
            />
        </div>

        <div class="flex flex-col gap-1.5">
            <label for="add-desc" class="text-xs font-medium text-foreground"
                >Description (Supports LaTeX, e.g. $x^2$)</label
            >
            <textarea
                id="add-desc"
                placeholder="Describe the feature in detail..."
                bind:value={formDescription}
                required
                class="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 h-24 rounded-md border bg-transparent px-2.5 py-2 text-sm shadow-xs transition-[color,box-shadow] focus-visible:ring-3 aria-invalid:ring-3 placeholder:text-muted-foreground w-full min-w-0 outline-none resize-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
            ></textarea>
        </div>

        <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
                <label
                    for="add-status"
                    class="text-xs font-medium text-foreground">Status</label
                >
                <Select
                    value={formStatus}
                    options={[
                        { value: "future", label: "Future" },
                        { value: "active", label: "Active" },
                        { value: "done", label: "Done" },
                    ]}
                    onchange={(val) => (formStatus = val as RoadmapStatus)}
                />
            </div>

            <div class="flex flex-col gap-1.5">
                <label
                    for="add-date"
                    class="text-xs font-medium text-foreground"
                    >Planned Date</label
                >
                <DatePicker
                    bind:value={formPlannedDate}
                    placeholder="Target date..."
                />
            </div>
        </div>
    </form>

    {#snippet footer()}
        <Button
            variant="outline"
            onclick={() => (showAddModal = false)}
            disabled={isSubmitting}>Cancel</Button
        >
        <Button onclick={handleAddGoal} disabled={isSubmitting}>
            {#if isSubmitting}Creating...{:else}Create{/if}
        </Button>
    {/snippet}
</Modal>

<!-- Edit Goal Modal -->
<Modal
    bind:open={showEditModal}
    title="Edit Roadmap Goal"
    description="Update the details, status, or date of this goal."
    size="md"
>
    {#if selectedGoal}
        <form
            onsubmit={(e) => {
                e.preventDefault();
                handleEditGoal();
            }}
            class="space-y-4 py-2"
        >
            <div class="flex flex-col gap-1.5">
                <label
                    for="edit-title"
                    class="text-xs font-medium text-foreground">Title</label
                >
                <Input
                    id="edit-title"
                    placeholder="Feature title..."
                    bind:value={formTitle}
                    required
                />
            </div>

            <div class="flex flex-col gap-1.5">
                <label
                    for="edit-desc"
                    class="text-xs font-medium text-foreground"
                    >Description (Supports LaTeX, e.g. $x^2$)</label
                >
                <textarea
                    id="edit-desc"
                    placeholder="Describe the feature in detail..."
                    bind:value={formDescription}
                    required
                    class="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 h-24 rounded-md border bg-transparent px-2.5 py-2 text-sm shadow-xs transition-[color,box-shadow] focus-visible:ring-3 aria-invalid:ring-3 placeholder:text-muted-foreground w-full min-w-0 outline-none resize-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
                ></textarea>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div class="flex flex-col gap-1.5">
                    <label
                        for="edit-status"
                        class="text-xs font-medium text-foreground"
                        >Status</label
                    >
                    <Select
                        value={formStatus}
                        options={[
                            { value: "future", label: "Future" },
                            { value: "active", label: "Active" },
                            { value: "done", label: "Done" },
                        ]}
                        onchange={(val) => (formStatus = val as RoadmapStatus)}
                    />
                </div>

                <div class="flex flex-col gap-1.5">
                    <label
                        for="edit-date"
                        class="text-xs font-medium text-foreground"
                        >Planned Date</label
                    >
                    <DatePicker
                        bind:value={formPlannedDate}
                        placeholder="Target date..."
                    />
                </div>
            </div>
        </form>
    {/if}

    {#snippet footer()}
        <Button
            variant="outline"
            onclick={() => (showEditModal = false)}
            disabled={isSubmitting}>Cancel</Button
        >
        <Button onclick={handleEditGoal} disabled={isSubmitting}>
            {#if isSubmitting}Saving...{:else}Save Changes{/if}
        </Button>
    {/snippet}
</Modal>

<!-- Delete Confirm Modal -->
<Modal
    bind:open={showDeleteConfirmModal}
    title="Delete Roadmap Goal"
    description="Are you absolutely sure you want to delete this roadmap goal? This action cannot be undone and will delete all associated votes."
    size="sm"
>
    {#if selectedGoal}
        <div
            class="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-xs text-destructive flex items-start gap-2"
        >
            <Icon name="warning" class="shrink-0 mt-0.5" />
            <div>
                <strong>Warning:</strong> Deleting "<strong
                    >{selectedGoal.title}</strong
                >" will permanently erase it and its votes.
            </div>
        </div>
    {/if}
    {#snippet footer()}
        <Button
            variant="outline"
            onclick={() => (showDeleteConfirmModal = false)}
            disabled={isSubmitting}>Cancel</Button
        >
        <Button
            variant="destructive"
            onclick={handleDeleteGoal}
            disabled={isSubmitting}
        >
            {#if isSubmitting}Deleting...{:else}Delete Goal{/if}
        </Button>
    {/snippet}
</Modal>
