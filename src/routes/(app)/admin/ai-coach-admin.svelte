<script lang="ts">
    import type { SupabaseClient } from "@supabase/supabase-js";
    import type { Database, Tables } from "$lib/types/database.types";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Input } from "$lib/components/input";
    import { Modal } from "$lib/components/modal";
    import { toasts } from "$lib/state/toast.svelte";
    import { fetchProfiles, resetAiHostedUsage } from "$lib/admin";
    import { cn } from "$lib/utils";

    let {
        supabase,
        profile,
    }: {
        supabase: SupabaseClient<Database>;
        profile?: Tables<"profiles"> | null;
    } = $props();

    type ScopeType = "all" | "selected";
    type PeriodType = "all" | "current";

    let scope = $state<ScopeType>("all");
    let period = $state<PeriodType>("all");
    let userSearch = $state("");
    let selectedUserIds = $state<string[]>([]);

    let profiles = $state<Tables<"profiles">[]>([]);
    let loadingProfiles = $state(false);

    let isConfirmOpen = $state(false);
    let isResetting = $state(false);
    let lastResetResult = $state<{
        count: number;
        timestamp: string;
        targetDescription: string;
        periodDescription: string;
    } | null>(null);

    function getCurrentPeriodStart(): string {
        const now = new Date();
        const year = now.getUTCFullYear();
        const month = String(now.getUTCMonth() + 1).padStart(2, "0");
        return `${year}-${month}-01`;
    }

    async function loadProfilesIfNeeded() {
        if (profiles.length > 0 || loadingProfiles) return;
        loadingProfiles = true;
        try {
            profiles = await fetchProfiles(supabase, "rank_highest");
        } catch (e) {
            toasts.error((e as Error).message || "Failed to load user list");
        } finally {
            loadingProfiles = false;
        }
    }

    $effect(() => {
        if (scope === "selected") {
            loadProfilesIfNeeded();
        }
    });

    let filteredProfiles = $derived(
        profiles.filter((p) => {
            if (!userSearch.trim()) return true;
            const term = userSearch.toLowerCase();
            return (
                (p.username && p.username.toLowerCase().includes(term)) ||
                p.id.toLowerCase().includes(term)
            );
        }),
    );

    let selectedProfiles = $derived(
        profiles.filter((p) => selectedUserIds.includes(p.id)),
    );

    function toggleUserSelection(id: string) {
        if (selectedUserIds.includes(id)) {
            selectedUserIds = selectedUserIds.filter((uid) => uid !== id);
        } else {
            selectedUserIds = [...selectedUserIds, id];
        }
    }

    function removeSelectedUser(id: string) {
        selectedUserIds = selectedUserIds.filter((uid) => uid !== id);
    }

    function clearSelectedUsers() {
        selectedUserIds = [];
    }

    function openConfirmModal() {
        if (scope === "selected" && selectedUserIds.length === 0) {
            toasts.error("Please select at least one user to reset.");
            return;
        }
        isConfirmOpen = true;
    }

    async function handleExecuteReset() {
        if (isResetting) return;
        isResetting = true;
        const currentPeriodStr = getCurrentPeriodStart();
        const periodStartParam = period === "current" ? currentPeriodStr : undefined;
        const userIdsParam = scope === "selected" ? selectedUserIds : undefined;

        try {
            const count = await resetAiHostedUsage(supabase, {
                userIds: userIdsParam,
                periodStart: periodStartParam,
            });

            const targetDesc =
                scope === "all"
                    ? "all users"
                    : `${selectedUserIds.length} selected user${selectedUserIds.length === 1 ? "" : "s"}`;
            const periodDesc =
                period === "current"
                    ? `current period (${currentPeriodStr})`
                    : "all billing periods";

            lastResetResult = {
                count,
                timestamp: new Date().toLocaleTimeString(),
                targetDescription: targetDesc,
                periodDescription: periodDesc,
            };

            toasts.success(
                `Reset complete: ${count} usage record${count === 1 ? "" : "s"} cleared.`,
            );
            isConfirmOpen = false;
        } catch (e) {
            toasts.error((e as Error).message || "Failed to reset AI Coach usage.");
        } finally {
            isResetting = false;
        }
    }
</script>

<section class="flex max-w-3xl flex-col gap-6" aria-labelledby="ai-coach-admin-heading">
    <div>
        <h2 id="ai-coach-admin-heading" class="type-section-title text-foreground">
            AI Coach Usage Management
        </h2>
        <p class="mt-1 type-secondary text-muted-foreground">
            Reset hosted AI Coach usage allowances (turns and spent credits) for users.
            Ordinary limits are 5,000 turns and 230,000 credits per monthly billing period.
            Resetting clears recorded usage so users can immediately continue using the hosted AI Coach.
        </p>
    </div>

    <!-- Info Box -->
    <div class="flex items-start gap-3 rounded-lg border border-border bg-surface-container/50 p-4">
        <Icon name="info" fontsize="1.2rem" class="mt-0.5 shrink-0 text-muted-foreground" />
        <div class="space-y-1 type-secondary">
            <span class="font-medium text-foreground">Hosted Allowance Limits</span>
            <p class="text-muted-foreground">
                First-party hosted AI Coach uses the server-owned API key and tracks spent credits and
                turns in <code>public.ai_hosted_usage</code>. Resetting deletes these records, restoring
                the full quota for the selected scope. Requires admin rank 10 or higher.
            </p>
        </div>
    </div>

    <!-- Configuration Form -->
    <div class="flex flex-col gap-6 border-y border-border py-6">
        <!-- Target Scope -->
        <fieldset class="flex flex-col gap-3">
            <legend class="type-body font-medium text-foreground">Target scope</legend>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                    type="button"
                    onclick={() => (scope = "all")}
                    class={cn(
                        "flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors",
                        scope === "all"
                            ? "border-primary bg-primary/5 text-foreground"
                            : "border-border bg-surface hover:bg-surface-container/40 text-muted-foreground",
                    )}
                >
                    <div class="flex items-center gap-2 font-medium text-foreground">
                        <Icon name="groups" fontsize="1.1rem" />
                        <span>All users</span>
                    </div>
                    <span class="type-caption text-muted-foreground">
                        Reset hosted AI Coach usage for every user across the application.
                    </span>
                </button>

                <button
                    type="button"
                    onclick={() => (scope = "selected")}
                    class={cn(
                        "flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors",
                        scope === "selected"
                            ? "border-primary bg-primary/5 text-foreground"
                            : "border-border bg-surface hover:bg-surface-container/40 text-muted-foreground",
                    )}
                >
                    <div class="flex items-center gap-2 font-medium text-foreground">
                        <Icon name="person" fontsize="1.1rem" />
                        <span>Selected users only</span>
                    </div>
                    <span class="type-caption text-muted-foreground">
                        Pick specific accounts to reset without affecting other users.
                    </span>
                </button>
            </div>
        </fieldset>

        <!-- Selected Users Picker (shown if scope === 'selected') -->
        {#if scope === "selected"}
            <div class="flex flex-col gap-3 rounded-lg border border-border bg-surface-container/20 p-4">
                <div class="flex items-center justify-between gap-2">
                    <span class="type-body font-medium text-foreground">
                        Select users ({selectedUserIds.length} chosen)
                    </span>
                    {#if selectedUserIds.length > 0}
                        <Button
                            variant="ghost"
                            size="sm"
                            onclick={clearSelectedUsers}
                            class="h-7 text-xs text-muted-foreground hover:text-foreground"
                        >
                            Clear selection
                        </Button>
                    {/if}
                </div>

                <!-- Selected user chips -->
                {#if selectedProfiles.length > 0}
                    <div class="flex flex-wrap gap-1.5 py-1">
                        {#each selectedProfiles as user (user.id)}
                            <span
                                class="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-0.5 type-caption text-foreground"
                            >
                                <span>{user.username || user.id.slice(0, 8)}</span>
                                <button
                                    type="button"
                                    onclick={() => removeSelectedUser(user.id)}
                                    class="text-muted-foreground hover:text-foreground"
                                    aria-label="Remove {user.username || user.id}"
                                >
                                    <Icon name="close" fontsize="0.85rem" />
                                </button>
                            </span>
                        {/each}
                    </div>
                {/if}

                <!-- Search input -->
                <div class="relative w-full">
                    <Input
                        bind:value={userSearch}
                        placeholder="Search by username or ID..."
                        class="w-full"
                    />
                </div>

                <!-- User list picker -->
                {#if loadingProfiles}
                    <div class="flex items-center gap-2 py-6 type-secondary text-muted-foreground">
                        <Icon name="progress_activity" class="animate-spin" fontsize="1.2rem" />
                        Loading users…
                    </div>
                {:else if filteredProfiles.length === 0}
                    <div class="py-4 text-center type-caption text-muted-foreground">
                        No matching users found.
                    </div>
                {:else}
                    <div class="max-h-52 overflow-y-auto divide-y divide-border/60 rounded-md border border-border bg-surface">
                        {#each filteredProfiles.slice(0, 50) as user (user.id)}
                            {@const isSelected = selectedUserIds.includes(user.id)}
                            <button
                                type="button"
                                onclick={() => toggleUserSelection(user.id)}
                                class={cn(
                                    "flex w-full items-center justify-between px-3 py-2 text-left transition-colors",
                                    isSelected
                                        ? "bg-primary/10 text-foreground"
                                        : "hover:bg-surface-container/60 text-muted-foreground",
                                )}
                            >
                                <div class="flex items-center gap-2.5 min-w-0">
                                    <div
                                        class={cn(
                                            "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                                            isSelected ? "bg-primary text-primary-foreground" : "bg-surface-container text-foreground",
                                        )}
                                    >
                                        {user.username ? user.username.charAt(0).toUpperCase() : "?"}
                                    </div>
                                    <span class="truncate type-caption font-medium text-foreground">
                                        {user.username || "Unknown"}
                                    </span>
                                    {#if user.admin_rank > 0}
                                        <span class="type-caption text-xs text-primary">
                                            (Admin {user.admin_rank})
                                        </span>
                                    {/if}
                                </div>
                                <input
                                    type="checkbox"
                                    checked={isSelected}
                                    class="size-4 rounded border-border accent-primary pointer-events-none"
                                    tabindex={-1}
                                    aria-hidden="true"
                                />
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}

        <!-- Period Selection -->
        <fieldset class="flex flex-col gap-3">
            <legend class="type-body font-medium text-foreground">Period scope</legend>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                    type="button"
                    onclick={() => (period = "all")}
                    class={cn(
                        "flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors",
                        period === "all"
                            ? "border-primary bg-primary/5 text-foreground"
                            : "border-border bg-surface hover:bg-surface-container/40 text-muted-foreground",
                    )}
                >
                    <span class="font-medium text-foreground">All billing periods</span>
                    <span class="type-caption text-muted-foreground">
                        Resets recorded usage across all past and current months. Recommended for a full reset.
                    </span>
                </button>

                <button
                    type="button"
                    onclick={() => (period = "current")}
                    class={cn(
                        "flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors",
                        period === "current"
                            ? "border-primary bg-primary/5 text-foreground"
                            : "border-border bg-surface hover:bg-surface-container/40 text-muted-foreground",
                    )}
                >
                    <span class="font-medium text-foreground">
                        Current month only ({getCurrentPeriodStart()})
                    </span>
                    <span class="type-caption text-muted-foreground">
                        Resets usage only for the active monthly cycle without affecting historic logs.
                    </span>
                </button>
            </div>
        </fieldset>

        <!-- Action Button -->
        <div class="flex items-center justify-between pt-2">
            <Button
                variant="destructive"
                onclick={openConfirmModal}
                disabled={isResetting || (scope === "selected" && selectedUserIds.length === 0)}
                class="gap-2"
            >
                <Icon name="restart_alt" fontsize="1.1rem" />
                Reset AI Coach Usage
            </Button>
        </div>
    </div>

    <!-- Last Reset Result Banner -->
    {#if lastResetResult}
        <div class="flex flex-col gap-2 rounded-lg border border-border bg-surface-container/30 p-4">
            <div class="flex items-center gap-2 type-caption font-semibold text-foreground">
                <Icon name="check_circle" fontsize="1.1rem" class="text-primary" />
                <span>Last Reset Action ({lastResetResult.timestamp})</span>
            </div>
            <p class="type-secondary text-muted-foreground">
                Cleared <strong>{lastResetResult.count}</strong> usage record(s) for{" "}
                <strong>{lastResetResult.targetDescription}</strong> under{" "}
                <strong>{lastResetResult.periodDescription}</strong>.
            </p>
        </div>
    {/if}
</section>

<!-- Confirmation Modal -->
<Modal
    bind:open={isConfirmOpen}
    title="Confirm AI Coach Usage Reset"
    description="Please review the reset scope before continuing."
    size="md"
>
    <div class="space-y-4 py-2">
        <div class="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-foreground">
            <div class="flex items-center gap-2 font-medium text-destructive">
                <Icon name="warning" fontsize="1.1rem" />
                <span>Warning: Irreversible Action</span>
            </div>
            <p class="mt-1 text-xs text-muted-foreground">
                This will delete the recorded turn count and token credits from the hosted AI Coach usage
                table. Affected users will immediately receive fresh turn and credit allowances.
            </p>
        </div>

        <dl class="divide-y divide-border rounded-md border border-border text-sm">
            <div class="flex justify-between p-3">
                <dt class="text-muted-foreground">Target scope:</dt>
                <dd class="font-medium text-foreground">
                    {scope === "all" ? "All users in system" : `${selectedUserIds.length} selected user(s)`}
                </dd>
            </div>
            <div class="flex justify-between p-3">
                <dt class="text-muted-foreground">Period scope:</dt>
                <dd class="font-medium text-foreground">
                    {period === "all" ? "All billing periods" : `Current month (${getCurrentPeriodStart()})`}
                </dd>
            </div>
            {#if scope === "selected"}
                <div class="p-3">
                    <dt class="text-muted-foreground mb-1">Selected accounts:</dt>
                    <dd class="flex flex-wrap gap-1">
                        {#each selectedProfiles as u (u.id)}
                            <span class="rounded bg-surface-container px-2 py-0.5 text-xs text-foreground">
                                {u.username || u.id.slice(0, 8)}
                            </span>
                        {/each}
                    </dd>
                </div>
            {/if}
        </dl>
    </div>

    {#snippet footer()}
        <Button variant="outline" onclick={() => (isConfirmOpen = false)} disabled={isResetting}>
            Cancel
        </Button>
        <Button variant="destructive" onclick={handleExecuteReset} disabled={isResetting} class="gap-1.5">
            {#if isResetting}
                <Icon name="progress_activity" class="animate-spin" fontsize="1rem" />
                Resetting…
            {:else}
                <Icon name="restart_alt" fontsize="1rem" />
                Confirm Reset
            {/if}
        </Button>
    {/snippet}
</Modal>
