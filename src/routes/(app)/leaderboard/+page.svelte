<script lang="ts">
    import type { PageData } from "./$types";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { fetchLeaderboard, type LeaderboardEntry } from "$lib/leaderboard";
    import { playerRatingIsProvisional } from "$lib/library";

    let { data }: { data: PageData } = $props();
    let { supabase, user } = $derived(data);

    let limit = $state(50);
    let entries = $state<LeaderboardEntry[]>([]);
    let loading = $state(true);
    let errorMsg = $state<string | null>(null);

    async function loadData() {
        loading = true;
        try {
            entries = await fetchLeaderboard(supabase, limit);
            errorMsg = null;
        } catch (e) {
            errorMsg = (e as Error).message || "Failed to load leaderboard";
        } finally {
            loading = false;
        }
    }

    $effect(() => {
        loadData();
    });

    // Medal glyph + tint for the podium (ranks 1–3); null otherwise.
    function medal(rank: number): { color: string } | null {
        if (rank === 1) return { color: "text-[#d4af37]" };
        if (rank === 2) return { color: "text-[#9ca3af]" };
        if (rank === 3) return { color: "text-[#b87333]" };
        return null;
    }
</script>

<div class="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
    <!-- Header -->
    <div class="border-b border-border/80 pb-4 space-y-1">
        <h1
            class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2"
        >
            <Icon
                name="leaderboard"
                fontsize="2rem"
                class="text-primary-foreground"
            />
            Leaderboard
        </h1>

    </div>

    {#if loading && entries.length === 0}
        <div class="flex flex-col items-center justify-center py-16 gap-3">
            <Icon
                name="progress_activity"
                class="animate-spin text-muted-foreground"
                fontsize="1.8rem"
            />
            <p class="text-xs text-muted-foreground">Loading leaderboard...</p>
        </div>
    {:else if errorMsg}
        <div
            class="p-4 rounded-lg bg-destructive/10 text-destructive text-sm text-center"
        >
            {errorMsg}
        </div>
    {:else if entries.length === 0}
        <div
            class="flex flex-col items-center justify-center py-16 gap-3 text-center"
        >
            <div
                class="flex size-12 items-center justify-center rounded-full bg-surface-container text-muted-foreground"
            >
                <Icon name="leaderboard" fontsize="1.8rem" />
            </div>
            <div>
                <h3 class="text-sm font-semibold">No ranked players yet</h3>
                <p class="text-xs text-muted-foreground mt-0.5">
                    Ratings appear once players start solving graded problems.
                </p>
            </div>
            <Button size="sm" href="/practice" class="mt-1">Go Practice</Button>
        </div>
    {:else}
        <div class="flex flex-col gap-2">
            {#each entries as e, i (e.user_id)}
                {@const rank = i + 1}
                {@const provisional = playerRatingIsProvisional(e)}
                {@const isMe = e.user_id === user?.id}
                {@const m = medal(rank)}
                <div
                    class="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border bg-surface-container-lowest shadow-xs transition duration-200 {isMe
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border/60 hover:border-primary-foreground/30'} {provisional
                        ? 'opacity-60'
                        : ''}"
                >
                    <!-- Rank -->
                    <div
                        class="w-8 shrink-0 flex items-center justify-center font-mono font-bold text-muted-foreground"
                    >
                        {#if m}
                            <Icon
                                name="military_tech"
                                fontsize="1.5rem"
                                fill
                                class={m.color}
                            />
                        {:else}
                            {rank}
                        {/if}
                    </div>

                    <!-- Avatar -->
                    <div
                        class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-foreground font-semibold text-sm border border-primary/20"
                    >
                        {e.username ? e.username.charAt(0).toUpperCase() : "?"}
                    </div>

                    <!-- Name -->
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="font-semibold text-foreground truncate">
                                {e.username || "Unknown"}
                            </span>
                            {#if isMe}
                                <span
                                    class="inline-flex items-center rounded-full bg-primary/15 text-primary-foreground text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 border border-primary/20 leading-none"
                                >
                                    You
                                </span>
                            {/if}
                            {#if provisional}
                                <span
                                    class="inline-flex items-center rounded-full bg-surface-container text-muted-foreground text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 border border-border/40 leading-none"
                                >
                                    Provisional
                                </span>
                            {/if}
                        </div>
                    </div>

                    <!-- Rating + meta -->
                    <div class="flex items-baseline gap-3 shrink-0">
                        <span
                            class="text-lg sm:text-xl font-bold text-foreground font-mono"
                        >
                            {Math.round(e.rating)}
                        </span>
                        <div
                            class="hidden sm:flex flex-col text-right leading-tight"
                        >
                            <span class="text-xs text-muted-foreground font-mono">
                                ±{Math.round(e.rd)}
                            </span>
                            <span class="text-[10px] text-muted-foreground">
                                {e.matches}
                                {e.matches === 1 ? "match" : "matches"}
                            </span>
                        </div>
                    </div>
                </div>
            {/each}

            <!-- Load More -->
            {#if entries.length >= limit}
                <div class="flex justify-center pt-2">
                    <Button
                        variant="outline"
                        onclick={() => (limit += 50)}
                        class="text-xs font-semibold px-6 py-2 shadow-xs"
                    >
                        Load More Players
                    </Button>
                </div>
            {/if}
        </div>
    {/if}
</div>
