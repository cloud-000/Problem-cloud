<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Checklist, type ChecklistItem } from "$lib/components/checklist";
    import { Icon } from "$lib/components/icon";
    import { Switch } from "$lib/components/toggle";

    const playgroundSeed: ChecklistItem[] = [
        { id: "solve-5", label: "Solve 5 problems", done: true },
        { id: "practice-settings", label: "Try practice settings", done: false },
        { id: "whiteboard", label: "Use the whiteboard", done: false },
        { id: "coach", label: "Ask Coach", done: false },
        { id: "set-goal", label: "Set a goal", done: false },
    ];

    let playground = $state<ChecklistItem[]>(
        playgroundSeed.map((item) => ({ ...item })),
    );
    let dismissed = $state(false);

    const homeItems: ChecklistItem[] = [
        { id: "solve-5", label: "Solve 5 problems", href: "/practice", done: true },
        {
            id: "practice-settings",
            label: "Try practice settings",
            href: "/practice",
            done: false,
        },
        {
            id: "whiteboard",
            label: "Use the whiteboard",
            href: "/practice",
            done: false,
        },
        { id: "coach", label: "Ask Coach", href: "/practice", done: false },
        { id: "set-goal", label: "Set a goal", href: "/goals?new=1", done: false },
    ];

    const completeItems: ChecklistItem[] = homeItems.map((item) => ({
        ...item,
        done: true,
    }));

    const mixedItems: ChecklistItem[] = [
        { id: "linked", label: "Open row with a destination", href: "/practice", done: false },
        { id: "inert", label: "Open row without a link", done: false },
        { id: "done", label: "Already finished", done: true },
    ];

    function resetPlayground() {
        playground = playgroundSeed.map((item) => ({ ...item }));
        dismissed = false;
    }
</script>

<div class="space-y-8 pb-12">
    <div class="border-b border-border/80 pb-4">
        <h1
            class="flex items-center gap-2 text-3xl font-semibold tracking-tight text-foreground"
        >
            <Icon name="task_alt" fontsize="2rem" class="text-primary-foreground" />
            Checklist Test Bench
        </h1>
        <p class="mt-1 text-sm text-muted-foreground">
            Milestone list with progress, dismiss, and linked or inert open rows.
            The caller owns ranking and persistence.
        </p>
    </div>

    <section
        class="space-y-4 rounded-xl border border-border/80 bg-surface-container-lowest p-5 shadow-xs"
        aria-labelledby="playground-heading"
    >
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
                <h2 id="playground-heading" class="text-lg font-semibold text-foreground">
                    Interactive playground
                </h2>
                <p class="text-sm text-muted-foreground">
                    Toggle items and dismiss the card. Open rows here have no
                    <code class="font-mono text-xs">href</code>, so they stay on this page.
                </p>
            </div>
            <Button variant="outline" size="sm" onclick={resetPlayground}>
                <Icon name="replay" />
                Reset
            </Button>
        </div>

        {#if dismissed}
            <p
                class="rounded-lg border border-dashed border-border bg-surface-container-low px-4 py-6 text-center text-sm text-muted-foreground"
            >
                Card dismissed.
                <button
                    type="button"
                    class="text-foreground underline decoration-border underline-offset-4"
                    onclick={() => (dismissed = false)}
                >
                    Restore
                </button>
            </p>
        {:else}
            <Checklist
                title="Getting started"
                items={playground}
                ondismiss={() => (dismissed = true)}
            />
        {/if}

        <div class="divide-y divide-border/60 rounded-lg border border-border/50">
            {#each playground as item (item.id)}
                <div
                    class="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/10"
                >
                    <span class="text-sm text-foreground">{item.label}</span>
                    <Switch
                        bind:checked={item.done}
                        aria-label={`Mark ${item.label} done`}
                    />
                </div>
            {/each}
        </div>
    </section>

    <section
        class="space-y-4 rounded-xl border border-border/80 bg-surface-container-lowest p-5 shadow-xs"
        aria-labelledby="home-heading"
    >
        <div>
            <h2 id="home-heading" class="text-lg font-semibold text-foreground">
                As on Home
            </h2>
            <p class="text-sm text-muted-foreground">
                Linked open rows go to Practice or a new goal. Done rows are not links.
            </p>
        </div>
        <Checklist title="Getting started" items={homeItems} />
    </section>

    <section
        class="space-y-4 rounded-xl border border-border/80 bg-surface-container-lowest p-5 shadow-xs"
        aria-labelledby="variants-heading"
    >
        <div>
            <h2 id="variants-heading" class="text-lg font-semibold text-foreground">
                Other configurations
            </h2>
            <p class="text-sm text-muted-foreground">
                List only, mixed hrefs, and a completed card.
            </p>
        </div>

        <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div class="space-y-2">
                <p class="text-xs font-semibold uppercase text-muted-foreground">
                    List only
                </p>
                <Checklist items={mixedItems} />
            </div>
            <div class="space-y-2">
                <p class="text-xs font-semibold uppercase text-muted-foreground">
                    Mixed href and inert
                </p>
                <Checklist title="Next steps" items={mixedItems} />
            </div>
            <div class="space-y-2 md:col-span-2">
                <p class="text-xs font-semibold uppercase text-muted-foreground">
                    All complete
                </p>
                <Checklist title="Getting started" items={completeItems} />
            </div>
        </div>
    </section>
</div>
