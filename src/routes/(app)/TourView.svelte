<script lang="ts">
    import { onMount, tick, untrack } from "svelte";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { TOUR_STEPS, tourHeading } from "$lib/onboarding";
    import { cn } from "$lib/utils";
    import GoalsMock from "./tour/GoalsMock.svelte";
    import LibraryMock from "./tour/LibraryMock.svelte";
    import ProgressMock from "./tour/ProgressMock.svelte";
    import TrainerMock from "./tour/TrainerMock.svelte";

    let {
        initialStep = 0,
        layout = "page",
        username = null,
        onskip,
        onclose,
        onadvance,
        onfinish,
    }: {
        initialStep?: number;
        layout?: "page" | "dialog";
        username?: string | null;
        onskip: () => void;
        onclose: () => void;
        onadvance: (completedIndex: number) => void;
        onfinish: () => void;
    } = $props();

    let step = $state(
        untrack(() => Math.max(0, Math.min(initialStep, TOUR_STEPS.length - 1))),
    );
    let headingEl = $state<HTMLHeadingElement | null>(null);

    let current = $derived(TOUR_STEPS[step] ?? TOUR_STEPS[0]);
    let isFirst = $derived(step === 0);
    let isLast = $derived(step === TOUR_STEPS.length - 1);
    let stepLabel = $derived(`Step ${step + 1} of ${TOUR_STEPS.length}`);
    let heading = $derived(tourHeading(current, username));
    let nextLabel = $derived(isLast ? "Get started" : "Next");

    async function focusHeading() {
        await tick();
        headingEl?.focus();
    }

    onMount(() => {
        void focusHeading();
    });

    async function goNext() {
        onadvance(step);
        if (step < TOUR_STEPS.length - 1) {
            step += 1;
            await focusHeading();
            return;
        }
        onfinish();
    }

    async function goBack() {
        if (step === 0) return;
        step -= 1;
        await focusHeading();
    }
</script>

{#snippet mock()}
    {#if current.id === "library"}
        <LibraryMock />
    {:else if current.id === "goals"}
        <GoalsMock />
    {:else if current.id === "progress"}
        <ProgressMock />
    {:else if current.id === "trainer"}
        <TrainerMock />
    {/if}
{/snippet}

{#snippet tourBody()}
    <div class="flex h-full min-h-0 flex-col gap-4">
        <div class="flex items-start justify-between gap-3">
            <p class="type-caption text-muted-foreground" aria-live="polite">
                {stepLabel}
            </p>
            {#if layout === "page"}
                <Button
                    variant="ghost"
                    size="icon-sm"
                    class="text-muted-foreground"
                    onclick={onclose}
                    aria-label="Close tour"
                >
                    <Icon name="close" />
                </Button>
            {/if}
        </div>

        <div class="flex gap-1.5" role="group" aria-label="Tour progress">
            {#each TOUR_STEPS as item, index (item.id)}
                <span
                    class={cn(
                        "h-1.5 flex-1 rounded-full bg-border",
                        index === step && "bg-foreground",
                        index < step && "bg-foreground/40",
                    )}
                    aria-current={index === step ? "step" : undefined}
                ></span>
            {/each}
        </div>

        <div class={current.id === "hello" ? "flex flex-1 flex-col justify-center" : ""}>
            <h2
                bind:this={headingEl}
                id="tour-step-title"
                tabindex="-1"
                class={[
                    "text-foreground outline-none",
                    current.id === "hello" ? "type-display" : "type-page-title",
                ]}
            >
                {heading}
            </h2>
            <p class="mt-2 type-secondary text-muted-foreground">
                {current.body}
            </p>
        </div>

        {#if current.id !== "hello"}
            <div class="flex min-h-0 flex-1 flex-col">
                {#key current.id}
                    {@render mock()}
                {/key}
            </div>
        {/if}

        <div class={["flex flex-col gap-2", layout === "page" && "md:mt-auto"]}>
            <div class="flex items-center gap-2">
                <Button
                    variant="outline"
                    size="icon"
                    onclick={goBack}
                    disabled={isFirst}
                    aria-label="Back to previous step"
                >
                    <Icon name="arrow_back" />
                </Button>
                <Button class="min-w-0 flex-1" onclick={goNext}>
                    {nextLabel}
                    <Icon name="arrow_forward" />
                </Button>
            </div>
            <div class="flex justify-end">
                <Button
                    variant="ghost"
                    class="text-muted-foreground"
                    onclick={onskip}
                    aria-label="Skip tour"
                >
                    Skip
                </Button>
            </div>
        </div>
    </div>
{/snippet}

<svelte:head>
    {#if layout === "page"}
        <title>Introduction · ProblemCloud</title>
    {/if}
</svelte:head>

{#if layout === "dialog"}
    <div class="flex min-h-[28rem] flex-col md:min-h-[32rem]">
        {@render tourBody()}
    </div>
{:else}
    <div
        class="flex h-full min-h-0 flex-col px-4 py-6 md:items-center md:justify-center md:px-6 md:py-8"
    >
        <section
            class="mx-auto flex min-h-0 w-full max-w-[880px] flex-1 flex-col overflow-hidden bg-transparent md:h-[40rem] md:max-h-full md:flex-none"
            aria-labelledby="tour-step-title"
        >
            {@render tourBody()}
        </section>
    </div>
{/if}
