<script lang="ts">
    import type { SupabaseClient } from "@supabase/supabase-js";
    import type { Database, Tables } from "$lib/types/database.types";
    import { Icon } from "$lib/components/icon";
    import { Select } from "$lib/components/select";
    import { Button } from "$lib/components/button";
    import { Modal } from "$lib/components/modal";
    import { toasts } from "$lib/state/toast.svelte";
    import { fetchProfiles, resetAiHostedUsage, type ProfilesSortOption } from "$lib/admin";
    import { cn } from "$lib/utils";

    let {
        supabase,
        profile: callerProfile,
    }: {
        supabase: SupabaseClient<Database>;
        profile?: Tables<"profiles"> | null;
    } = $props();

    let canResetUsage = $derived((callerProfile?.admin_rank ?? 0) >= 10);

    let sortBy = $state<ProfilesSortOption>("newest");
    let profiles = $state<Tables<"profiles">[]>([]);
    let loading = $state(true);
    let errorMsg = $state<string | null>(null);

    // Selection & Reset state
    let selectedUserIds = $state<string[]>([]);
    let userToReset = $state<Tables<"profiles"> | null>(null);
    let resetScope = $state<"single" | "bulk" | null>(null);
    let showResetModal = $state(false);
    let isResetting = $state(false);

    async function loadData(currentSort: ProfilesSortOption) {
        loading = true;
        try {
            profiles = await fetchProfiles(supabase, currentSort);
            errorMsg = null;
        } catch (e) {
            errorMsg = (e as Error).message || "Failed to load profiles";
        } finally {
            loading = false;
        }
    }

    $effect(() => {
        loadData(sortBy);
    });

    const sortOptions = [
        { value: "newest", label: "Date Joined (Newest)" },
        { value: "oldest", label: "Date Joined (Oldest)" },
        { value: "rank_highest", label: "Admin Rank (Highest)" },
        { value: "rank_lowest", label: "Admin Rank (Lowest)" },
        { value: "active_newest", label: "Last Active (Newest)" },
        { value: "active_oldest", label: "Last Active (Oldest)" },
    ];

    function formatDate(dateStr: string): string {
        return new Date(dateStr).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
        });
    }

    function toggleSelectAll() {
        if (selectedUserIds.length === profiles.length) {
            selectedUserIds = [];
        } else {
            selectedUserIds = profiles.map((p) => p.id);
        }
    }

    function toggleUser(id: string) {
        if (selectedUserIds.includes(id)) {
            selectedUserIds = selectedUserIds.filter((uid) => uid !== id);
        } else {
            selectedUserIds = [...selectedUserIds, id];
        }
    }

    function openSingleResetModal(p: Tables<"profiles">) {
        userToReset = p;
        resetScope = "single";
        showResetModal = true;
    }

    function openBulkResetModal() {
        if (selectedUserIds.length === 0) return;
        userToReset = null;
        resetScope = "bulk";
        showResetModal = true;
    }

    async function handleConfirmReset() {
        if (isResetting) return;
        isResetting = true;
        const targetIds =
            resetScope === "single" && userToReset
                ? [userToReset.id]
                : selectedUserIds;

        try {
            const count = await resetAiHostedUsage(supabase, {
                userIds: targetIds,
            });
            toasts.success(
                `Reset AI Coach usage: ${count} record${count === 1 ? "" : "s"} cleared.`,
            );
            if (resetScope === "bulk") {
                selectedUserIds = [];
            }
            showResetModal = false;
        } catch (e) {
            toasts.error((e as Error).message || "Failed to reset AI Coach usage.");
        } finally {
            isResetting = false;
        }
    }
</script>

<div class="flex w-full flex-col gap-6">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div class="flex w-full flex-col gap-1.5 sm:w-64">
            <span class="type-caption text-muted-foreground">Sort by</span>
            <Select
                options={sortOptions}
                bind:value={sortBy}
                placeholder="Sort users..."
            />
        </div>
        {#if !loading && !errorMsg}
            <div class="flex items-center gap-2 self-start sm:self-auto">
                <span class="type-secondary text-muted-foreground">{profiles.length} total</span>
            </div>
        {/if}
    </div>

    <!-- Bulk Action Bar for Admin >= 10 -->
    {#if canResetUsage && profiles.length > 0}
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-container/30 px-4 py-2.5">
            <div class="flex items-center gap-3">
                <label class="flex items-center gap-2 type-caption font-medium text-foreground cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={selectedUserIds.length === profiles.length && profiles.length > 0}
                        onchange={toggleSelectAll}
                        class="size-4 rounded border-border accent-primary cursor-pointer"
                    />
                    <span>
                        {selectedUserIds.length === profiles.length && profiles.length > 0
                            ? "Deselect all"
                            : "Select all"}
                    </span>
                </label>
                {#if selectedUserIds.length > 0}
                    <span class="type-caption text-muted-foreground">
                        ({selectedUserIds.length} selected)
                    </span>
                {/if}
            </div>

            {#if selectedUserIds.length > 0}
                <Button
                    variant="outline"
                    size="sm"
                    onclick={openBulkResetModal}
                    class="gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:border-destructive/40"
                >
                    <Icon name="restart_alt" fontsize="1rem" />
                    Reset AI Coach usage ({selectedUserIds.length})
                </Button>
            {/if}
        </div>
    {/if}

    <!-- Feed / List -->
    {#if loading && profiles.length === 0}
        <div class="flex items-center gap-2 py-16 type-secondary text-muted-foreground">
            <Icon
                name="progress_activity"
                class="animate-spin text-muted-foreground"
                fontsize="1.8rem"
            />
            Loading users…
        </div>
    {:else if errorMsg}
        <div class="border-y border-destructive/30 py-4 type-secondary text-destructive" role="alert">
            {errorMsg}
        </div>
    {:else if profiles.length === 0}
        <div class="border-y border-border/60 py-8">
            <h2 class="type-section-title text-foreground">No users found</h2>
        </div>
    {:else}
        <div class="border-t border-border">
            {#each profiles as p (p.id)}
                {@const isSelected = selectedUserIds.includes(p.id)}
                <div
                    class={cn(
                        "flex items-center gap-3 sm:gap-4 border-b border-border py-4 transition-colors",
                        isSelected && "bg-primary/5",
                    )}
                >
                    {#if canResetUsage}
                        <input
                            type="checkbox"
                            checked={isSelected}
                            onchange={() => toggleUser(p.id)}
                            class="size-4 shrink-0 rounded border-border accent-primary cursor-pointer"
                            aria-label="Select user {p.username || p.id}"
                        />
                    {/if}

                    <div
                        class="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-container type-body font-medium text-foreground"
                    >
                        {p.username
                            ? p.username.charAt(0).toUpperCase()
                            : "?"}
                    </div>

                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="type-body font-medium text-foreground truncate">
                                {p.username || "Unknown"}
                            </span>

                            {#if p.admin_rank > 0}
                                <span
                                    class="inline-flex items-center gap-1 type-caption text-primary"
                                >
                                    <Icon
                                        name="shield"
                                        fontsize="0.9rem"
                                        class="align-middle"
                                    />
                                    Admin Lvl {p.admin_rank}
                                </span>
                            {:else}
                                <span
                                    class="inline-flex items-center gap-1 type-caption text-muted-foreground"
                                >
                                    <Icon
                                        name="person"
                                        fontsize="0.9rem"
                                        class="align-middle"
                                    />
                                    User
                                </span>
                            {/if}
                        </div>

                        {#if p.status}
                            <p class="mt-1 truncate type-caption text-muted-foreground">
                                “{p.status}”
                            </p>
                        {:else}
                            <p
                                class="mt-1 type-caption italic text-muted-foreground/60"
                            >
                                No status set
                            </p>
                        {/if}
                    </div>

                    <div class="text-right shrink-0 hidden sm:flex flex-col gap-1">
                        <div>
                            <span class="mr-1 type-caption text-muted-foreground">Joined</span>
                            <span class="type-caption text-foreground">{formatDate(p.created_at)}</span>
                        </div>
                        <div>
                            <span class="mr-1 type-caption text-muted-foreground">Active</span>
                            <span class="type-caption text-foreground">{p.last_active_at ? formatDate(p.last_active_at) : 'Never'}</span>
                        </div>
                    </div>

                    <div class="flex shrink-0 flex-col gap-0.5 text-right sm:hidden">
                        <span class="type-caption text-muted-foreground">J: {formatDate(p.created_at).split(",")[0]}</span>
                        <span class="type-caption text-muted-foreground/80">A: {p.last_active_at ? formatDate(p.last_active_at).split(",")[0] : 'Never'}</span>
                    </div>

                    {#if canResetUsage}
                        <div class="shrink-0 pl-1">
                            <Button
                                variant="ghost"
                                size="sm"
                                onclick={() => openSingleResetModal(p)}
                                title="Reset AI Coach usage"
                                aria-label="Reset AI Coach usage for {p.username || p.id}"
                                class="size-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            >
                                <Icon name="restart_alt" fontsize="1.1rem" />
                            </Button>
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}
</div>

<!-- Reset Confirmation Modal -->
<Modal
    bind:open={showResetModal}
    title={resetScope === "single" && userToReset
        ? `Reset AI Coach Usage for @${userToReset.username || userToReset.id.slice(0, 8)}`
        : `Reset AI Coach Usage for ${selectedUserIds.length} Users`}
    description="This will clear spent credits and reserved turns for the selected account(s)."
    size="md"
>
    <div class="space-y-3 py-2">
        <div class="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-foreground">
            <div class="flex items-center gap-2 font-medium text-destructive">
                <Icon name="warning" fontsize="1.1rem" />
                <span>Confirm Quota Reset</span>
            </div>
            <p class="mt-1 text-xs text-muted-foreground">
                {#if resetScope === "single" && userToReset}
                    Hosted AI Coach turns and token credits for <strong>@{userToReset.username || userToReset.id}</strong>
                    will be reset to zero across all periods. The user will immediately receive a fresh monthly allowance.
                {:else}
                    Hosted AI Coach turns and token credits for <strong>{selectedUserIds.length} selected users</strong>
                    will be reset to zero across all periods.
                {/if}
            </p>
        </div>
    </div>

    {#snippet footer()}
        <Button variant="outline" onclick={() => (showResetModal = false)} disabled={isResetting}>
            Cancel
        </Button>
        <Button variant="destructive" onclick={handleConfirmReset} disabled={isResetting} class="gap-1.5">
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
