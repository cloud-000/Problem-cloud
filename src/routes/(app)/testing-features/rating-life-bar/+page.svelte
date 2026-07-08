<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { Button } from "$lib/components/button";
    import { RatingLifeBar } from "$lib/components/rating-life-bar";
    import { RatingCounter } from "$lib/components/rating-counter";
    import { untrack } from "svelte";
    import { glickoMatchPreview, type PlayerRating, type ProblemRating } from "$lib/library";

    // Setup initial mock states
    let initialRating = $state(1550);
    let playerRating = $state<PlayerRating>({
        rating: untrack(() => initialRating),
        rd: 80,
        matches: 10,
        last_match_at: new Date().toISOString()
    });

    let problemRating = $state<ProblemRating>({
        rating: 1500,
        rd: 120,
        attempts: 12
    });

    // Dynamic derivation of bounds
    const tierSize = 100;
    let lower = $derived(Math.floor(playerRating.rating / tierSize) * tierSize);
    let upper = $derived(lower + tierSize);

    let preview = $derived(glickoMatchPreview(playerRating, problemRating));

    function simulateCorrect() {
        const gain = preview.deltaWin;
        playerRating = {
            ...playerRating,
            rating: playerRating.rating + gain
        };
    }

    function simulateIncorrect() {
        const loss = preview.deltaLoss; // already negative
        playerRating = {
            ...playerRating,
            rating: playerRating.rating + loss
        };
    }

    function reset() {
        playerRating = {
            ...playerRating,
            rating: initialRating
        };
    }
</script>

<div class="space-y-8">
    <div class="border-b border-border/80 pb-4 space-y-2">
        <h1 class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Icon name="bar_chart" fontsize="2rem" class="text-primary-foreground" />
            Rating Life Bar
        </h1>
        <p class="text-sm text-muted-foreground">
            Dark Souls-style rating bar visualizing progress in the 200-point tier boundaries. It animates rating changes dynamically.
        </p>
    </div>

    <!-- Playground Box -->
    <div class="border border-border/80 rounded-xl p-6 bg-surface-container-lowest shadow-xs space-y-6">
        <h2 class="text-lg font-semibold text-foreground">Playground</h2>

        <!-- Interactive Header Segment -->
        <div class="bg-surface-container-low border border-border/60 p-4 rounded-xl flex items-center gap-3">
            <RatingCounter value={playerRating.rating} class="shrink-0 font-medium text-foreground text-sm" />
            <span class="tabular-nums text-[10px] opacity-60 shrink-0">{lower}</span>
            <RatingLifeBar
                {playerRating}
                {tierSize}
            />
            <span class="tabular-nums text-[10px] opacity-60 shrink-0">{upper}</span>
        </div>

        <!-- Simulation Actions -->
        <div class="flex flex-col gap-6 pt-4 border-t border-border/40">
            <div class="space-y-4">
                <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">Dynamic Glicko Match Simulation (Repeatable)</span>
                <div class="flex flex-wrap gap-2">
                    <Button variant="default" class="bg-correct text-on-correct border-correct/30 hover:bg-correct/80" onclick={simulateCorrect}>
                        Correct (+{preview.deltaWin.toFixed(1)})
                    </Button>
                    <Button variant="default" class="bg-destructive text-on-destructive border-destructive/30 hover:bg-destructive/80" onclick={simulateIncorrect}>
                        Incorrect ({preview.deltaLoss.toFixed(1)})
                    </Button>
                </div>
            </div>

            <div class="space-y-4">
                <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">Manual Adjustments</span>
                <div class="flex flex-wrap gap-2">
                    <Button variant="outline" class="text-correct border-correct/30 hover:bg-correct/10" onclick={() => playerRating.rating += 15}>+15 Rating</Button>
                    <Button variant="outline" class="text-correct border-correct/30 hover:bg-correct/10" onclick={() => playerRating.rating += 50}>+50 Rating (Level Up)</Button>
                    <Button variant="outline" class="text-destructive border-destructive/30 hover:bg-destructive/10" onclick={() => playerRating.rating -= 15}>-15 Rating</Button>
                    <Button variant="outline" class="text-destructive border-destructive/30 hover:bg-destructive/10" onclick={() => playerRating.rating -= 50}>-50 Rating (Level Down)</Button>
                    <Button variant="outline" onclick={reset}>
                        Reset to Seed
                    </Button>
                </div>
            </div>

            <div class="space-y-4">
                <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">Adjust Seed Ratings</span>
                <div class="grid grid-cols-2 gap-4">
                    <div class="flex flex-col gap-1">
                        <label class="text-[10px] text-muted-foreground font-mono">
                            Player Rating
                            <input
                                type="number"
                                bind:value={initialRating}
                                class="bg-surface-container border border-border rounded-md px-2 py-1 font-mono text-xs focus:outline-none focus:border-primary w-full mt-1"
                                oninput={reset}
                            />
                        </label>
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-[10px] text-muted-foreground font-mono">
                            Problem Rating
                            <input
                                type="number"
                                bind:value={problemRating.rating}
                                class="bg-surface-container border border-border rounded-md px-2 py-1 font-mono text-xs focus:outline-none focus:border-primary w-full mt-1"
                            />
                        </label>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
