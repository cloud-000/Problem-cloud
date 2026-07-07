<script lang="ts">
    import type { SupabaseClient } from "@supabase/supabase-js";
    import type { Database } from "$lib/types/database.types";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { toasts } from "$lib/state/toast.svelte";
    import { recomputeRatings, type RecomputeRatingsResult } from "$lib/admin";

    let { supabase }: { supabase: SupabaseClient<Database> } = $props();

    let running = $state(false);
    let lastResult = $state<RecomputeRatingsResult | null>(null);

    async function handleRecompute() {
        if (running) return;
        running = true;
        try {
            const result = await recomputeRatings(supabase);
            lastResult = result;
            toasts.success(
                `Rebuilt ${result.problems} problem and ${result.players} player ratings from ${result.matches} matches.`,
            );
        } catch (e) {
            toasts.error((e as Error).message || "Failed to recompute ratings.");
        } finally {
            running = false;
        }
    }

    const stats = $derived(
        lastResult
            ? [
                  { label: "Players", value: lastResult.players },
                  { label: "Problems", value: lastResult.problems },
                  { label: "Matches", value: lastResult.matches },
              ]
            : [],
    );
</script>

<div class="flex flex-col gap-6 w-full">
    <div
        class="flex flex-col gap-5 p-5 rounded-xl border border-border/60 bg-surface-container-lowest shadow-xs max-w-2xl"
    >
        <div class="border-b border-border/60 pb-3">
            <h2
                class="text-lg font-semibold text-foreground flex items-center gap-2"
            >
                <Icon name="leaderboard" class="text-primary-foreground" />
                Skill Ratings
            </h2>
            <p class="text-xs text-muted-foreground mt-0.5">
                Rebuild every player and problem rating from the submissions log.
                Ratings update live per submission — this replay exists as a
                repair path, and to re-grade history after tuning the model
                parameters.
            </p>
        </div>

        <div class="flex flex-col gap-3">
            <div
                class="flex items-start gap-2.5 rounded-lg border border-border/50 bg-surface-container-low p-3 text-xs text-muted-foreground"
            >
                <Icon
                    name="info"
                    fontsize="1.1rem"
                    class="mt-px shrink-0 text-primary-foreground"
                />
                <span>
                    This is a full, deterministic rebuild that replays all graded
                    submissions. It is safe to re-run at any time. Cost grows with
                    the number of submissions, so it may take a moment on large
                    datasets.
                </span>
            </div>

            <Button
                onclick={handleRecompute}
                disabled={running}
                class="w-full sm:w-auto flex items-center justify-center gap-2 font-semibold shadow-xs"
            >
                {#if running}
                    <Icon
                        name="progress_activity"
                        class="animate-spin"
                        fontsize="1.1rem"
                    />
                    Recomputing…
                {:else}
                    <Icon name="refresh" fontsize="1.1rem" />
                    Recompute Ratings
                {/if}
            </Button>
        </div>

        {#if lastResult}
            <div class="flex flex-col gap-2 border-t border-border/60 pt-4">
                <span
                    class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                    Last rebuild
                </span>
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {#each stats as stat (stat.label)}
                        <div
                            class="flex flex-col gap-0.5 rounded-lg border border-border/60 bg-surface-container-low p-3"
                        >
                            <span class="text-lg font-semibold text-foreground">
                                {stat.value.toLocaleString()}
                            </span>
                            <span class="text-[10px] uppercase tracking-wider text-muted-foreground">
                                {stat.label}
                            </span>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}
    </div>
</div>
