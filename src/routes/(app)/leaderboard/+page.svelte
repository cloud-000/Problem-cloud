<script lang="ts">
    import type { PageData } from "./$types";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import * as Page from "$lib/components/page";
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
        void loadData();
    });
</script>

<svelte:head>
    <title>Leaderboard · ProblemCloud</title>
</svelte:head>

<Page.Root width="standard">
    <Page.Header
        title="Leaderboard"
        description="See how players compare across graded problems."
    />

    <section aria-label="Ranked players">
        {#if loading && entries.length === 0}
            <div
                class="flex min-h-40 items-center justify-center gap-2 type-secondary text-muted-foreground"
                aria-live="polite"
            >
                <Icon name="progress_activity" class="animate-spin" />
                Loading leaderboard…
            </div>
        {:else if errorMsg}
            <div
                class="flex flex-col gap-4 border-y border-border/60 py-4 sm:flex-row sm:items-center sm:justify-between"
                role="alert"
            >
                <p class="type-secondary text-destructive">{errorMsg}</p>
                <Button variant="outline" onclick={loadData} class="shrink-0">
                    Try again
                </Button>
            </div>
        {:else if entries.length === 0}
            <div class="flex flex-col items-start gap-4 border-y border-border/60 py-8">
                <div>
                    <h2 class="type-section-title text-foreground">No ranked players yet</h2>
                    <p class="mt-1 type-secondary text-muted-foreground">
                        Ratings appear once players start solving graded problems.
                    </p>
                </div>
                <Button href="/practice">Go to practice</Button>
            </div>
        {:else}
            <ol class="border-y border-border/60 divide-y divide-border/60">
                {#each entries as entry, index (entry.user_id)}
                    {@const rank = index + 1}
                    {@const provisional = playerRatingIsProvisional(entry)}
                    {@const isMe = entry.user_id === user?.id}
                    <li
                        class="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-4 sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:gap-x-4 {isMe
                            ? 'bg-primary/5'
                            : ''} {provisional ? 'opacity-60' : ''}"
                    >
                        <span class="type-code text-muted-foreground tabular-nums">
                            {rank}
                        </span>

                        <div class="min-w-0">
                            <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                <span class="type-body truncate font-medium text-foreground">
                                    {entry.username || "Unknown"}
                                </span>
                                {#if isMe}
                                    <span class="type-caption text-primary">You</span>
                                {/if}
                                {#if provisional}
                                    <span class="type-caption text-muted-foreground">Provisional</span>
                                {/if}
                            </div>
                            <p class="mt-0.5 type-secondary text-muted-foreground sm:hidden">
                                ±{Math.round(entry.rd)} uncertainty · {entry.matches}
                                {entry.matches === 1 ? "match" : "matches"}
                            </p>
                        </div>

                        <div class="text-right">
                            <p class="type-code text-foreground tabular-nums">
                                {Math.round(entry.rating)}
                            </p>
                            <p class="mt-0.5 hidden type-caption text-muted-foreground sm:block">
                                ±{Math.round(entry.rd)} uncertainty · {entry.matches}
                                {entry.matches === 1 ? "match" : "matches"}
                            </p>
                        </div>
                    </li>
                {/each}
            </ol>

            {#if entries.length >= limit}
                <div class="flex justify-center pt-2">
                    <Button variant="outline" onclick={() => (limit += 50)}>
                        Load more players
                    </Button>
                </div>
            {/if}
        {/if}
    </section>
</Page.Root>
