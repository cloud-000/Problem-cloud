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

<div class="flex w-full flex-col gap-8">
    <div class="flex w-full flex-col gap-1.5 sm:w-52">
            <span class="type-caption text-muted-foreground">Status</span>
            <Select
                options={statusOptions}
                bind:value={statusFilter}
                placeholder="Filter status..."
            />
    </div>

    <!-- Feed -->
    {#if loading && suggestions.length === 0}
        <div class="flex items-center gap-2 py-16 type-secondary text-muted-foreground">
            <Icon
                name="progress_activity"
                class="animate-spin text-muted-foreground"
                fontsize="1.8rem"
            />
            Loading answer suggestions…
        </div>
    {:else if errorMsg}
        <div class="border-y border-destructive/30 py-4 type-secondary text-destructive" role="alert">
            {errorMsg}
        </div>
    {:else if groups.length === 0}
        <div class="flex flex-col items-start gap-1 border-y border-border/60 py-8">
                <h2 class="type-section-title text-foreground">No answer suggestions found</h2>
                <p class="type-secondary text-muted-foreground">
                    {statusFilter === "pending"
                        ? "Nothing waiting for review."
                        : "No suggestions match this filter."}
                </p>
        </div>
    {:else}
        <div class="border-t border-border">
            {#each groups as group (group.problemId)}
                <section class="border-b border-border py-6" aria-label={`Suggestions for problem ${group.problemId}`}>
                    <div class="pb-5">
                        {#if group.problem}
                            <Problem
                                problem={group.problem}
                                mode="preview"
                                disabled={true}
                            />
                        {:else}
                            <p class="type-secondary italic text-muted-foreground">
                                Problem #{group.problemId} could not be loaded.
                            </p>
                        {/if}
                    </div>

                    <div class="border-t border-border/60 divide-y divide-border/60">
                        {#each group.items as row (row.id)}
                            {@const choice =
                                row.answer_index != null &&
                                group.problem?.choices?.[row.answer_index]}
                            <div class="flex flex-col gap-3 py-4">
                                <div
                                    class="flex items-start justify-between gap-3"
                                >
                                    <div class="flex flex-col gap-1 min-w-0">
                                        <span
                                            class="type-caption text-muted-foreground"
                                        >
                                            {row.profiles?.username ??
                                                "Unknown"}
                                            • {formatDate(row.created_at)}
                                        </span>
                                        <div
                                            class="flex items-center gap-2 type-body text-foreground"
                                        >
                                            <span
                                                class="type-caption shrink-0 text-muted-foreground"
                                                >Suggests</span
                                            >
                                            {#if choice}
                                                <span
                                                class="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary type-caption text-primary-foreground"
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
                                        class="border-l-2 border-border pl-3 type-secondary whitespace-pre-wrap text-muted-foreground"
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
                </section>
            {/each}
        </div>
    {/if}
</div>
