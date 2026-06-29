<script lang="ts">
    import type { SupabaseClient } from "@supabase/supabase-js";
    import type { Database } from "$lib/types/database.types";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Select } from "$lib/components/select";
    import { StatusTag } from "$lib/components/status-tag";
    import { Problem } from "$lib/components/problem";
    import { MathStatement } from "$lib/components/math-statement";
    import {
        fetchAnswerSuggestions,
        reviewAnswerSuggestion,
        type AnswerSuggestionRow,
        type FeedbackStatusFilter,
    } from "$lib/admin";
    import { toasts } from "$lib/state/toast.svelte";

    let { supabase }: { supabase: SupabaseClient<Database> } = $props();

    let statusFilter = $state("pending");
    let suggestions = $state<AnswerSuggestionRow[]>([]);
    let loading = $state(true);
    let errorMsg = $state<string | null>(null);
    // Feedback ids with an in-flight Accept/Reject call.
    let busyIds = $state(new Set<number>());

    async function loadData(status: FeedbackStatusFilter) {
        loading = true;
        try {
            suggestions = await fetchAnswerSuggestions(supabase, status);
            errorMsg = null;
        } catch (e) {
            errorMsg = (e as Error).message || "Failed to load feedback";
        } finally {
            loading = false;
        }
    }

    $effect(() => {
        loadData(statusFilter as FeedbackStatusFilter);
    });

    // Group suggestions by problem so multiple suggestions cluster together,
    // preserving the newest-first order of their first appearance.
    let groups = $derived.by(() => {
        const map = new Map<number, AnswerSuggestionRow[]>();
        for (const s of suggestions) {
            // Answer suggestions are always problem-scoped; skip any stray null.
            if (s.problem_id == null) continue;
            const list = map.get(s.problem_id) ?? [];
            list.push(s);
            map.set(s.problem_id, list);
        }
        return [...map.entries()].map(([problemId, items]) => ({
            problemId,
            problem: items[0].problems,
            items,
        }));
    });

    async function review(row: AnswerSuggestionRow, accept: boolean) {
        if (busyIds.has(row.id)) return;
        busyIds = new Set(busyIds).add(row.id);
        try {
            await reviewAnswerSuggestion(supabase, row.id, accept);
            toasts.success(
                accept
                    ? "Answer applied to the problem."
                    : "Suggestion rejected.",
            );
            // Reflect the new state without a refetch: drop it from a scoped
            // view, or update its status in the "all" view.
            if (statusFilter === "all") {
                suggestions = suggestions.map((s) =>
                    s.id === row.id
                        ? { ...s, status: accept ? "accepted" : "rejected" }
                        : s,
                );
            } else {
                suggestions = suggestions.filter((s) => s.id !== row.id);
            }
        } catch (e) {
            toasts.error((e as Error).message || "Action failed.");
        } finally {
            const next = new Set(busyIds);
            next.delete(row.id);
            busyIds = next;
        }
    }

    const statusOptions = [
        { value: "pending", label: "Pending" },
        { value: "accepted", label: "Accepted" },
        { value: "rejected", label: "Rejected" },
        { value: "all", label: "All" },
    ];

    function statusKind(status: string) {
        if (status === "accepted") return "correct" as const;
        if (status === "rejected") return "incorrect" as const;
        return "unanswered" as const;
    }

    function formatDate(dateStr: string): string {
        return new Date(dateStr).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
        });
    }
</script>

<div class="flex flex-col gap-6 w-full">
    <!-- Filter -->
    <div
        class="flex flex-col md:flex-row gap-4 items-end bg-surface-container-low p-4 rounded-xl border border-border/60"
    >
        <div class="flex flex-col gap-1.5 md:w-48 w-full">
            <span
                class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >Status</span
            >
            <Select
                options={statusOptions}
                bind:value={statusFilter}
                placeholder="Filter status..."
            />
        </div>
    </div>

    <!-- Feed -->
    {#if loading && suggestions.length === 0}
        <div class="flex flex-col items-center justify-center py-16 gap-3">
            <Icon
                name="progress_activity"
                class="animate-spin text-muted-foreground"
                fontsize="1.8rem"
            />
            <p class="text-xs text-muted-foreground">Loading feedback...</p>
        </div>
    {:else if errorMsg}
        <div
            class="p-4 rounded-lg bg-destructive/10 text-destructive text-sm text-center"
        >
            {errorMsg}
        </div>
    {:else if groups.length === 0}
        <div
            class="flex flex-col items-center justify-center py-16 gap-3 text-center"
        >
            <div
                class="flex size-12 items-center justify-center rounded-full bg-surface-container text-muted-foreground"
            >
                <Icon name="inbox" fontsize="1.8rem" />
            </div>
            <div>
                <h3 class="text-sm font-semibold">No feedback found</h3>
                <p class="text-xs text-muted-foreground mt-0.5">
                    {statusFilter === "pending"
                        ? "Nothing waiting for review."
                        : "No suggestions match this filter."}
                </p>
            </div>
        </div>
    {:else}
        <div class="space-y-6">
            {#each groups as group (group.problemId)}
                <div
                    class="rounded-xl border border-border/60 bg-surface-container-lowest overflow-hidden shadow-xs"
                >
                    <!-- Problem context -->
                    <div class="border-b border-border/40 p-4">
                        {#if group.problem}
                            <Problem
                                problem={group.problem}
                                mode="preview"
                                disabled={true}
                            />
                        {:else}
                            <p class="text-xs text-muted-foreground italic">
                                Problem #{group.problemId} could not be loaded.
                            </p>
                        {/if}
                    </div>

                    <!-- Suggestions for this problem -->
                    <div class="divide-y divide-border/40">
                        {#each group.items as row (row.id)}
                            {@const choice =
                                row.answer_index != null &&
                                group.problem?.choices?.[row.answer_index]}
                            <div class="flex flex-col gap-3 p-4">
                                <div
                                    class="flex items-start justify-between gap-3"
                                >
                                    <div class="flex flex-col gap-1 min-w-0">
                                        <span
                                            class="text-xs text-muted-foreground"
                                        >
                                            {row.profiles?.username ??
                                                "Unknown"}
                                            • {formatDate(row.created_at)}
                                        </span>
                                        <div
                                            class="flex items-center gap-2 text-sm text-foreground"
                                        >
                                            <span
                                                class="text-xs font-medium text-muted-foreground shrink-0"
                                                >Suggests</span
                                            >
                                            {#if choice}
                                                <span
                                                    class="flex size-5 shrink-0 items-center justify-center rounded-full border border-primary bg-primary text-primary-foreground text-[10px] font-semibold"
                                                >
                                                    {String.fromCharCode(
                                                        65 +
                                                            (row.answer_index ??
                                                                0),
                                                    )}
                                                </span>
                                                <MathStatement
                                                    text={`$${choice}$`}
                                                    class="min-w-0"
                                                />
                                            {:else}
                                                <span
                                                    class="text-muted-foreground italic"
                                                    >choice #{row.answer_index}</span
                                                >
                                            {/if}
                                        </div>
                                    </div>
                                    <StatusTag
                                        class="shrink-0"
                                        status={statusKind(row.status)}
                                        label={row.status}
                                        size="sm"
                                    />
                                </div>

                                {#if row.steps}
                                    <p
                                        class="text-sm text-muted-foreground whitespace-pre-wrap rounded-lg bg-surface-container-low p-3 border border-border/40"
                                    >
                                        {row.steps}
                                    </p>
                                {/if}

                                {#if row.status === "pending"}
                                    <div class="flex justify-end gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={busyIds.has(row.id)}
                                            onclick={() => review(row, false)}
                                        >
                                            <Icon
                                                name="close"
                                                class="size-[1.1em]"
                                            />
                                            Reject
                                        </Button>
                                        <Button
                                            size="sm"
                                            disabled={busyIds.has(row.id) ||
                                                row.answer_index == null}
                                            onclick={() => review(row, true)}
                                        >
                                            <Icon
                                                name="check"
                                                class="size-[1.1em]"
                                            />
                                            Accept
                                        </Button>
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>
