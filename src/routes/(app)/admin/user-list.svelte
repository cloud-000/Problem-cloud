<script lang="ts">
    import type { SupabaseClient } from "@supabase/supabase-js";
    import type { Database } from "$lib/types/database.types";
    import { Icon } from "$lib/components/icon";
    import { Select } from "$lib/components/select";
    import { fetchProfiles, type ProfilesSortOption } from "$lib/admin";

    let { supabase }: { supabase: SupabaseClient<Database> } = $props();

    let sortBy = $state<ProfilesSortOption>("newest");
    let profiles = $state<any[]>([]);
    let loading = $state(true);
    let errorMsg = $state<string | null>(null);

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
</script>

<div class="flex w-full flex-col gap-8">
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
            {#each profiles as profile (profile.id)}
                <div
                    class="flex items-center gap-4 border-b border-border py-4"
                >
                    <div
                        class="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-container type-body font-medium text-foreground"
                    >
                        {profile.username
                            ? profile.username.charAt(0).toUpperCase()
                            : "?"}
                    </div>

                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="type-body font-medium text-foreground truncate">
                                {profile.username || "Unknown"}
                            </span>

                            {#if profile.admin_rank > 0}
                                <span
                                    class="inline-flex items-center gap-1 type-caption text-primary"
                                >
                                    <Icon
                                        name="shield"
                                        fontsize="0.9rem"
                                        class="align-middle"
                                    />
                                    Admin Lvl {profile.admin_rank}
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

                        {#if profile.status}
                            <p class="mt-1 truncate type-caption text-muted-foreground">
                                “{profile.status}”
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
                            <span class="type-caption text-foreground">{formatDate(profile.created_at)}</span>
                        </div>
                        <div>
                            <span class="mr-1 type-caption text-muted-foreground">Active</span>
                            <span class="type-caption text-foreground">{profile.last_active_at ? formatDate(profile.last_active_at) : 'Never'}</span>
                        </div>
                    </div>
                    <div class="flex shrink-0 flex-col gap-0.5 text-right sm:hidden">
                        <span class="type-caption text-muted-foreground">J: {formatDate(profile.created_at).split(",")[0]}</span>
                        <span class="type-caption text-muted-foreground/80">A: {profile.last_active_at ? formatDate(profile.last_active_at).split(",")[0] : 'Never'}</span>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>
