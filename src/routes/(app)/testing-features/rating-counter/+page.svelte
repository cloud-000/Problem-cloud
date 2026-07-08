<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { Button } from "$lib/components/button";
    import { RatingCounter } from "$lib/components/rating-counter";

    let rating = $state(1500);
    let customInput = $state("1500");

    function adjust(amount: number) {
        rating += amount;
    }

    function setCustom() {
        const val = parseFloat(customInput);
        if (!isNaN(val)) {
            rating = val;
        }
    }

    function randomize() {
        const delta = Math.floor(Math.random() * 50) - 25; // -25 to +25
        rating += delta === 0 ? 10 : delta;
    }
</script>

<div class="space-y-8">
    <div class="border-b border-border/80 pb-4 space-y-2">
        <h1 class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Icon name="countertops" fontsize="2rem" class="text-primary-foreground" />
            Rating Counter
        </h1>
        <p class="text-sm text-muted-foreground">
            Numerical Glicko rating counter with animated rolling transitions and RPG-style popup change indicators.
        </p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <!-- Playground -->
        <div class="border border-border/80 rounded-xl p-6 bg-surface-container-lowest shadow-xs space-y-6">
            <h2 class="text-lg font-semibold text-foreground">Playground</h2>
            
            <div class="flex flex-col items-center justify-center py-10 bg-surface-container-low rounded-lg relative overflow-hidden">
                <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Live Counter</span>
                <RatingCounter value={rating} class="text-4xl text-foreground font-bold" />
            </div>

            <!-- Controls -->
            <div class="space-y-4">
                <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">Simulate Outcome</span>
                <div class="flex flex-wrap gap-2">
                    <Button variant="outline" class="text-correct border-correct/30 hover:bg-correct/10" onclick={() => adjust(12.5)}>+12.5 (Win)</Button>
                    <Button variant="outline" class="text-correct border-correct/30 hover:bg-correct/10" onclick={() => adjust(24.2)}>+24.2 (Big Win)</Button>
                    <Button variant="outline" class="text-destructive border-destructive/30 hover:bg-destructive/10" onclick={() => adjust(-8.4)}>-8.4 (Loss)</Button>
                    <Button variant="outline" class="text-destructive border-destructive/30 hover:bg-destructive/10" onclick={() => adjust(-18.6)}>-18.6 (Big Loss)</Button>
                </div>

                <div class="flex gap-2">
                    <Button variant="secondary" onclick={randomize}>Random Shift</Button>
                    <Button variant="outline" onclick={() => rating = 1500}>Reset to 1500</Button>
                </div>
            </div>
        </div>

        <!-- Custom Input -->
        <div class="border border-border/80 rounded-xl p-6 bg-surface-container-lowest shadow-xs space-y-6">
            <h2 class="text-lg font-semibold text-foreground">Set Value</h2>
            <div class="flex gap-2">
                <input
                    type="number"
                    bind:value={customInput}
                    class="bg-surface-container border border-border rounded-md px-3 py-1.5 font-mono text-sm focus:outline-none focus:border-primary flex-1"
                />
                <Button variant="default" onclick={setCustom}>Apply Value</Button>
            </div>
            <div class="text-sm text-muted-foreground space-y-2">
                <p><strong>Animation Rules:</strong></p>
                <ul class="list-disc pl-5 space-y-1">
                    <li>Entering a larger value causes the counter to count up and shows a green floating popup.</li>
                    <li>Entering a smaller value causes the counter to count down and shows a red floating popup.</li>
                    <li>Value updates are tweened using a cubicOut easing over 1 second.</li>
                </ul>
            </div>
        </div>
    </div>
</div>
