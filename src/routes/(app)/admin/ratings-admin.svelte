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

<section class="flex max-w-2xl flex-col gap-6" aria-labelledby="ratings-heading">
        <div>
            <h2 id="ratings-heading" class="type-section-title text-foreground">Skill ratings</h2>
            <p class="mt-1 type-secondary text-muted-foreground">
                Rebuild every player and problem rating from the submissions log.
                Ratings update live per submission — this replay exists as a
                repair path, and to re-grade history after tuning the model
                parameters.
            </p>
        </div>

        <div class="flex flex-col gap-4 border-y border-border py-4">
            <div
                class="flex items-start gap-2.5 type-secondary text-muted-foreground"
            >
                <Icon
                    name="info"
                    fontsize="1.1rem"
                    class="mt-px shrink-0 text-muted-foreground"
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
                class="w-full sm:w-auto"
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
            <div class="flex flex-col gap-3">
                <span class="type-caption text-muted-foreground">Last rebuild</span>
                <div class="grid grid-cols-2 border-y border-border sm:grid-cols-3">
                    {#each stats as stat (stat.label)}
                        <div
                            class="flex flex-col gap-0.5 py-4 pr-4 even:border-l even:border-border even:pl-4 sm:border-l sm:border-border sm:px-4 sm:first:border-l-0 sm:first:pl-0"
                        >
                            <span class="type-code text-foreground">
                                {stat.value.toLocaleString()}
                            </span>
                            <span class="type-caption text-muted-foreground">
                                {stat.label}
                            </span>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}
</section>
