<script lang="ts">
    import type { PageData } from "./$types";
    import { onMount } from "svelte";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { toasts } from "$lib/state/toast.svelte";
    import {
        fetchPlayerRating,
        playerRatingIsProvisional,
        type PlayerRating,
    } from "$lib/library";

    let { data }: { data: PageData } = $props();
    let { supabase, user, profile } = $derived(data);

    let rating = $state<PlayerRating | null>(null);
    let loading = $state(true);

    async function loadRating() {
        if (!user) {
            loading = false;
            return;
        }
        loading = true;
        try {
            rating = await fetchPlayerRating(supabase, user.id);
        } catch (e) {
            toasts.error((e as Error).message || "Failed to load your rating.");
        } finally {
            loading = false;
        }
    }

    onMount(loadRating);

    let provisional = $derived(playerRatingIsProvisional(rating));
</script>

<div class="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
    <div class="space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight text-foreground">
            Welcome back{profile?.username ? `, ${profile.username}` : ""}
        </h1>
        <p class="text-sm text-muted-foreground">
            Here's your current skill rating.
        </p>
    </div>

    <!-- Rating card -->
    <div
        class="flex flex-col gap-4 rounded-xl border border-border/60 bg-surface-container-lowest p-5 shadow-xs max-w-full"
    >
        <div class="flex items-center gap-2 text-muted-foreground">
            <Icon name="military_tech" class="text-primary-foreground" />
            <span class="text-xs font-semibold uppercase tracking-wider">
                Skill Rating
            </span>
        </div>

        {#if loading}
            <div
                class="flex items-center gap-2 py-4 text-sm text-muted-foreground"
            >
                <Icon
                    name="progress_activity"
                    class="animate-spin"
                    fontsize="1.2rem"
                />
                Loading your rating…
            </div>
        {:else if rating}
            <div class="flex items-end gap-3">
                <span class="text-5xl font-bold leading-none text-foreground">
                    {Math.round(rating.rating)}
                </span>
                {#if provisional}
                    <span
                        title="Provisional — play more to settle your rating"
                        class="mb-1 inline-flex items-center gap-1 rounded-full bg-surface-container px-2 py-0.5 text-xs font-medium text-muted-foreground"
                    >
                        <Icon name="hourglass_empty" fontsize="0.85rem" />
                        Provisional
                    </span>
                {/if}
            </div>

            <div class="grid grid-cols-2 gap-3 border-t border-border/60 pt-4">
                <div class="flex flex-col gap-0.5">
                    <span class="text-lg font-semibold text-foreground">
                        ±{Math.round(rating.rd)}
                    </span>
                    <span
                        class="text-[10px] uppercase tracking-wider text-muted-foreground"
                    >
                        Uncertainty
                    </span>
                </div>
                <div class="flex flex-col gap-0.5">
                    <span class="text-lg font-semibold text-foreground">
                        {rating.matches.toLocaleString()}
                    </span>
                    <span
                        class="text-[10px] uppercase tracking-wider text-muted-foreground"
                    >
                        Rated Matches
                    </span>
                </div>
            </div>
        {:else}
            <div class="flex flex-col gap-3 py-2">
                <p class="text-sm text-muted-foreground">
                    You don't have a rating yet. Solve some problems in practice
                    to earn one.
                </p>
                <Button href="/practice" class="w-fit">
                    <Icon name="play_arrow" fontsize="1.1rem" />
                    Start practicing
                </Button>
            </div>
        {/if}
    </div>
</div>
