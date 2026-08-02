<script lang="ts">
    import type { SupabaseClient } from "@supabase/supabase-js";
    import type { Database } from "$lib/types/database.types";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Select } from "$lib/components/select";
    import { StatusTag } from "$lib/components/status-tag";
    import {
        fetchGeneralFeedback,
        resolveFeedback,
        type GeneralFeedbackRow,
        type GeneralFeedbackStatusFilter,
        type GeneralFeedbackType,
    } from "$lib/admin";
    import { toasts } from "$lib/state/toast.svelte";

    let { supabase }: { supabase: SupabaseClient<Database> } = $props();

    let statusFilter = $state("pending");
    let typeFilter = $state("all");
    let feedback = $state<GeneralFeedbackRow[]>([]);
    let loading = $state(true);
    let errorMsg = $state<string | null>(null);
    // Feedback ids with an in-flight Resolve/Dismiss call.
    let busyIds = $state(new Set<number>());

    async function loadData(
        status: GeneralFeedbackStatusFilter,
        type: GeneralFeedbackType | "all",
    ) {
        loading = true;
        try {
            feedback = await fetchGeneralFeedback(supabase, status, type);
            errorMsg = null;
        } catch (e) {
            errorMsg = (e as Error).message || "Failed to load feedback";
        } finally {
            loading = false;
        }
    }

    $effect(() => {
        loadData(
            statusFilter as GeneralFeedbackStatusFilter,
            typeFilter as GeneralFeedbackType | "all",
        );
    });

    async function resolve(
        row: GeneralFeedbackRow,
        status: "resolved" | "dismissed",
    ) {
        if (busyIds.has(row.id)) return;
        busyIds = new Set(busyIds).add(row.id);
        try {
            await resolveFeedback(supabase, row.id, status);
            toasts.success(
                status === "resolved"
                    ? "Marked as resolved."
                    : "Marked as dismissed.",
            );
            // Reflect the new state without a refetch: drop it from a scoped
            // view, or update its status in the "all" view.
            if (statusFilter === "all") {
                feedback = feedback.map((f) =>
                    f.id === row.id ? { ...f, status } : f,
                );
            } else {
                feedback = feedback.filter((f) => f.id !== row.id);
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
        { value: "pending", label: "Open" },
        { value: "resolved", label: "Resolved" },
        { value: "dismissed", label: "Dismissed" },
        { value: "all", label: "All" },
    ];

    const typeOptions = [
        { value: "all", label: "All categories" },
        { value: "bug_report", label: "Bugs" },
        { value: "feature_suggestion", label: "Features" },
        { value: "general", label: "General" },
    ];

    const typeMeta: Record<string, { icon: string; label: string }> = {
        bug_report: { icon: "bug_report", label: "Bug" },
        feature_suggestion: { icon: "lightbulb", label: "Feature" },
        general: { icon: "chat", label: "General" },
    };

    function statusKind(status: string) {
        if (status === "resolved") return "correct" as const;
        if (status === "dismissed") return "incorrect" as const;
        return "new" as const;
    }

    function statusLabel(status: string) {
        if (status === "resolved") return "Resolved";
        if (status === "dismissed") return "Dismissed";
        return "Open";
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
    <div class="flex flex-col gap-4 md:flex-row md:items-end">
        <div class="flex w-full flex-col gap-1.5 md:w-48">
            <span class="type-caption text-muted-foreground">Status</span>
            <Select
                options={statusOptions}
                bind:value={statusFilter}
                placeholder="Filter status..."
            />
        </div>
        <div class="flex w-full flex-col gap-1.5 md:w-48">
            <span class="type-caption text-muted-foreground">Category</span>
            <Select
                options={typeOptions}
                bind:value={typeFilter}
                placeholder="Filter category..."
            />
        </div>
    </div>

    <!-- Feed -->
    {#if loading && feedback.length === 0}
        <div class="flex items-center gap-2 py-16 type-secondary text-muted-foreground">
            <Icon
                name="progress_activity"
                class="animate-spin text-muted-foreground"
                fontsize="1.8rem"
            />
            Loading feedback…
        </div>
    {:else if errorMsg}
        <div class="border-y border-destructive/30 py-4 type-secondary text-destructive" role="alert">
            {errorMsg}
        </div>
    {:else if feedback.length === 0}
        <div class="flex flex-col items-start gap-1 border-y border-border/60 py-8">
                <h2 class="type-section-title text-foreground">No feedback found</h2>
                <p class="type-secondary text-muted-foreground">
                    {statusFilter === "pending"
                        ? "Nothing waiting for review."
                        : "No feedback matches these filters."}
                </p>
        </div>
    {:else}
        <div class="border-t border-border">
            {#each feedback as row (row.id)}
                {@const meta = typeMeta[row.type] ?? {
                    icon: "chat",
                    label: row.type,
                }}
                <div
                    class="flex flex-col gap-3 border-b border-border py-4"
                >
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex flex-col gap-1 min-w-0">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span
                                    class="inline-flex items-center gap-1 type-caption text-muted-foreground"
                                >
                                    <Icon name={meta.icon} fontsize="0.9rem" />
                                    {meta.label}
                                </span>
                                <span class="type-caption text-muted-foreground">
                                    {row.profiles?.username ?? "Unknown"}
                                    • {formatDate(row.created_at)}
                                </span>
                            </div>
                        </div>
                        <StatusTag
                            class="shrink-0"
                            status={statusKind(row.status)}
                            label={statusLabel(row.status)}
                            size="sm"
                        />
                    </div>

                    {#if row.message}
                        <p
                            class="border-l-2 border-border pl-3 type-secondary whitespace-pre-wrap text-foreground"
                        >
                            {row.message}
                        </p>
                    {:else}
                        <p class="type-secondary italic text-muted-foreground">
                            (no message)
                        </p>
                    {/if}

                    {#if row.status === "pending"}
                        <div class="flex justify-end gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={busyIds.has(row.id)}
                                onclick={() => resolve(row, "dismissed")}
                            >
                                <Icon name="close" class="size-[1.1em]" />
                                Dismiss
                            </Button>
                            <Button
                                size="sm"
                                disabled={busyIds.has(row.id)}
                                onclick={() => resolve(row, "resolved")}
                            >
                                <Icon name="check" class="size-[1.1em]" />
                                Resolve
                            </Button>
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}
</div>
