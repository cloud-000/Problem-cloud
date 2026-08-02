<script lang="ts">
    import { Button } from "$lib/components/button";
    import { HiddenText } from "$lib/components/hidden-text";
    import { Icon } from "$lib/components/icon";

    let blocked = $state(true);
</script>

<div class="space-y-8 pb-12">
    <div class="border-b border-border/80 pb-4">
        <h1
            class="flex items-center gap-2 text-3xl font-semibold tracking-tight text-foreground"
        >
            <Icon name="visibility" fontsize="2rem" class="text-primary-foreground" />
            Hidden Text Feature Test
        </h1>
        <p class="mt-1 text-sm text-muted-foreground">
            Verify the click-to-reveal control, bindable state, and inline answer layout.
        </p>
    </div>

    <section
        class="space-y-4 rounded-xl border border-border/80 bg-surface-container-lowest p-5 shadow-xs"
        aria-labelledby="bound-state-heading"
    >
        <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
                <h2 id="bound-state-heading" class="text-lg font-semibold text-foreground">
                    Bound state
                </h2>
                <p class="text-sm text-muted-foreground">
                    Reveal the answer, then reset it externally to confirm two-way binding.
                </p>
            </div>
            <Button variant="outline" size="sm" onclick={() => (blocked = true)}>
                <Icon name="replay" />
                Reset reveal
            </Button>
        </div>

        <div
            class="flex flex-wrap items-center gap-3 rounded-lg border border-border/50 bg-surface-container-low p-4"
        >
            <span class="text-sm text-muted-foreground">Correct answer:</span>
            <HiddenText bind:blocked>
                <span class="rounded border border-border bg-surface-container-lowest px-1.5 py-0.5 font-mono font-semibold text-foreground">
                    $42$
                </span>
            </HiddenText>
            <span class="ml-auto font-mono text-xs text-muted-foreground">
                blocked: {blocked}
            </span>
        </div>
    </section>

    <section
        class="space-y-4 rounded-xl border border-border/80 bg-surface-container-lowest p-5 shadow-xs"
        aria-labelledby="examples-heading"
    >
        <div>
            <h2 id="examples-heading" class="text-lg font-semibold text-foreground">
                Default and custom labels
            </h2>
            <p class="text-sm text-muted-foreground">
                Each disclosure owns its state unless a parent binds it.
            </p>
        </div>

        <div class="space-y-3 text-sm">
            <p class="flex flex-wrap items-center gap-2">
                <span class="text-muted-foreground">Official answer:</span>
                <HiddenText>
                    <strong class="font-mono text-foreground">\(\frac{7}{3}\)</strong>
                </HiddenText>
            </p>
            <p class="flex flex-wrap items-center gap-2">
                <span class="text-muted-foreground">Hint:</span>
                <HiddenText revealLabel="Show hint">
                    <span class="text-foreground">Factor the expression before expanding.</span>
                </HiddenText>
            </p>
        </div>
    </section>
</div>
