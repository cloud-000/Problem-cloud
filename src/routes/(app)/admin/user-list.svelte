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

<div class="flex flex-col gap-6 w-full">
    <!-- Filter/Sort Bar -->
    <div
        class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-surface-container-low p-4 rounded-xl border border-border/60"
    >
        <div class="flex flex-col gap-1.5 sm:w-64 w-full">
            <span
                class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
                Sort By
            </span>
            <Select
                options={sortOptions}
                bind:value={sortBy}
                placeholder="Sort users..."
            />
        </div>
        {#if !loading && !errorMsg}
            <div class="flex items-center gap-2 self-start sm:self-auto">
                <span class="text-xs font-medium text-muted-foreground">
                    Total Users:
                </span>
                <span
                    class="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-primary/15 text-primary-foreground text-xs font-semibold border border-primary/20"
                >
                    {profiles.length}
                </span>
            </div>
        {/if}
    </div>

    <!-- Feed / List -->
    {#if loading && profiles.length === 0}
        <div class="flex flex-col items-center justify-center py-16 gap-3">
            <Icon
                name="progress_activity"
                class="animate-spin text-muted-foreground"
                fontsize="1.8rem"
            />
            <p class="text-xs text-muted-foreground">Loading users...</p>
        </div>
    {:else if errorMsg}
        <div
            class="p-4 rounded-lg bg-destructive/10 text-destructive text-sm text-center"
        >
            {errorMsg}
        </div>
    {:else if profiles.length === 0}
        <div
            class="flex flex-col items-center justify-center py-16 gap-3 text-center"
        >
            <div
                class="flex size-12 items-center justify-center rounded-full bg-surface-container text-muted-foreground"
            >
                <Icon name="person_off" fontsize="1.8rem" />
            </div>
            <div>
                <h3 class="text-sm font-semibold">No users found</h3>
            </div>
        </div>
    {:else}
        <div class="flex flex-col gap-3">
            {#each profiles as profile (profile.id)}
                <div
                    class="flex items-center gap-4 p-4 rounded-xl border border-border/60 bg-surface-container-lowest shadow-xs hover:border-primary-foreground/30 transition duration-200"
                >
                    <!-- Avatar icon with initial -->
                    <div
                        class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-foreground font-semibold text-sm border border-primary/20"
                    >
                        {profile.username
                            ? profile.username.charAt(0).toUpperCase()
                            : "?"}
                    </div>

                    <!-- Main Info -->
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="font-semibold text-foreground truncate">
                                {profile.username || "Unknown"}
                            </span>

                            {#if profile.admin_rank > 0}
                                <span
                                    class="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary-foreground text-xs font-semibold px-2 py-0.5 border border-primary/20 leading-none"
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
                                    class="inline-flex items-center gap-1 rounded-full bg-surface-container text-muted-foreground text-xs font-medium px-2 py-0.5 border border-border/40 leading-none"
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
                            <p class="text-xs text-muted-foreground mt-1 truncate">
                                “{profile.status}”
                            </p>
                        {:else}
                            <p
                                class="text-xs text-muted-foreground/60 mt-1 italic"
                            >
                                No status set
                            </p>
                        {/if}
                    </div>

                    <!-- Meta info (joined & active dates) -->
                    <div class="text-right shrink-0 hidden sm:flex flex-col gap-1">
                        <div>
                            <span class="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground mr-1">Joined</span>
                            <span class="text-xs font-medium text-foreground">{formatDate(profile.created_at)}</span>
                        </div>
                        <div>
                            <span class="text-[9px] uppercase font-semibold tracking-wider text-muted-foreground mr-1">Active</span>
                            <span class="text-xs font-medium text-foreground">{profile.last_active_at ? formatDate(profile.last_active_at) : 'Never'}</span>
                        </div>
                    </div>
                    <!-- Small joined/active date for mobile -->
                    <div class="text-right shrink-0 sm:hidden flex flex-col gap-0.5 text-[10px]">
                        <span class="text-muted-foreground">J: {formatDate(profile.created_at).split(",")[0]}</span>
                        <span class="text-muted-foreground/80">A: {profile.last_active_at ? formatDate(profile.last_active_at).split(",")[0] : 'Never'}</span>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>
