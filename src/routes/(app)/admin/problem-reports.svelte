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
        fetchProblemReports,
        reviewProblemReport,
        type ProblemReportRow,
        type ProblemReportStatusFilter,
    } from "$lib/admin";
    import { toasts } from "$lib/state/toast.svelte";
    import { SvelteMap, SvelteSet } from "svelte/reactivity";

    let { supabase }: { supabase: SupabaseClient<Database> } = $props();

    let statusFilter = $state("pending");
    let reports = $state<ProblemReportRow[]>([]);
    let loading = $state(true);
    let errorMsg = $state<string | null>(null);
    // Feedback ids with an in-flight review call.
    const busyIds = new SvelteSet<number>();

    async function loadData(status: ProblemReportStatusFilter) {
        loading = true;
        try {
            reports = await fetchProblemReports(supabase, status);
            errorMsg = null;
        } catch (e) {
            errorMsg = (e as Error).message || "Failed to load feedback";
        } finally {
            loading = false;
        }
    }

    $effect(() => {
        loadData(statusFilter as ProblemReportStatusFilter);
    });

    // Group reports by problem so multiple reports cluster together,
    // preserving the newest-first order of their first appearance.
    let groups = $derived.by(() => {
        const map = new SvelteMap<number, ProblemReportRow[]>();
        for (const report of reports) {
            // Problem reports are always scoped; skip any stray legacy row.
            if (report.problem_id == null) continue;
            const list = map.get(report.problem_id) ?? [];
            list.push(report);
            map.set(report.problem_id, list);
        }
        return [...map.entries()].map(([problemId, items]) => ({
            problemId,
            problem: items[0].problems,
            items,
        }));
    });

    async function review(
        row: ProblemReportRow,
        status: "resolved" | "dismissed",
        applyAnswer = false,
    ) {
        if (busyIds.has(row.id)) return;
        busyIds.add(row.id);
        try {
            await reviewProblemReport(supabase, row.id, status, applyAnswer);
            toasts.success(
                applyAnswer
                    ? "Answer applied and report resolved."
                    : status === "resolved"
                      ? "Report resolved."
                      : "Report dismissed.",
            );
            // Reflect the new state without a refetch: drop it from a scoped
            // view, or update its status in the "all" view.
            if (statusFilter === "all") {
                reports = reports.map((report) =>
                    report.id === row.id ? { ...report, status } : report,
                );
            } else {
                reports = reports.filter((report) => report.id !== row.id);
            }
        } catch (e) {
            toasts.error((e as Error).message || "Action failed.");
        } finally {
            busyIds.delete(row.id);
        }
    }

    const statusOptions = [
        { value: "pending", label: "Open" },
        { value: "resolved", label: "Resolved" },
        { value: "dismissed", label: "Dismissed" },
        { value: "all", label: "All" },
    ];

    function statusKind(status: string) {
        if (status === "resolved") return "correct" as const;
        if (status === "dismissed") return "incorrect" as const;
        return "new" as const;
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
    {#if loading && reports.length === 0}
        <div class="flex items-center gap-2 py-16 type-secondary text-muted-foreground">
            <Icon
                name="progress_activity"
                class="animate-spin text-muted-foreground"
                fontsize="1.8rem"
            />
            Loading problem reports…
        </div>
    {:else if errorMsg}
        <div class="border-y border-destructive/30 py-4 type-secondary text-destructive" role="alert">
            {errorMsg}
        </div>
    {:else if groups.length === 0}
        <div class="flex flex-col items-start gap-1 border-y border-border/60 py-8">
                <h2 class="type-section-title text-foreground">No problem reports found</h2>
                <p class="type-secondary text-muted-foreground">
                    {statusFilter === "pending"
                        ? "Nothing waiting for review."
                        : "No reports match this filter."}
                </p>
        </div>
    {:else}
        <div class="border-t border-border">
            {#each groups as group (group.problemId)}
                <section class="border-b border-border py-6" aria-label={`Reports for problem ${group.problemId}`}>
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
                                        {#if row.answer_index != null}
                                            <div
                                                class="flex items-center gap-2 type-body text-foreground"
                                            >
                                                <span
                                                    class="type-caption shrink-0 text-muted-foreground"
                                                    >Suggested answer</span
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
                                                    <span class="text-muted-foreground italic">
                                                        choice #{row.answer_index}
                                                    </span>
                                                {/if}
                                            </div>
                                        {:else if row.answer_text}
                                            <div
                                                class="flex items-start gap-2 type-body text-foreground"
                                            >
                                                <span
                                                    class="type-caption shrink-0 text-muted-foreground"
                                                >
                                                    Custom answer
                                                </span>
                                                <MathStatement
                                                    text={row.answer_text}
                                                    class="min-w-0"
                                                />
                                            </div>
                                        {/if}
                                    </div>
                                    <StatusTag
                                        class="shrink-0"
                                        status={statusKind(row.status)}
                                        label={row.status}
                                        size="sm"
                                    />
                                </div>

                                {#if row.message}
                                    <p
                                        class="border-l-2 border-border pl-3 type-secondary whitespace-pre-wrap text-muted-foreground"
                                    >
                                        {row.message}
                                    </p>
                                {/if}

                                {#if row.status === "pending"}
                                    <div class="flex justify-end gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={busyIds.has(row.id)}
                                            onclick={() => review(row, "dismissed")}
                                        >
                                            <Icon
                                                name="close"
                                                class="size-[1.1em]"
                                            />
                                            Dismiss
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={busyIds.has(row.id)}
                                            onclick={() => review(row, "resolved")}
                                        >
                                            <Icon
                                                name="check"
                                                class="size-[1.1em]"
                                            />
                                            Resolve
                                        </Button>
                                        {#if row.answer_index != null}
                                            <Button
                                                size="sm"
                                                disabled={busyIds.has(row.id)}
                                                onclick={() => review(row, "resolved", true)}
                                            >
                                                <Icon name="done_all" class="size-[1.1em]" />
                                                Apply answer
                                            </Button>
                                        {/if}
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
