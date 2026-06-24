<script lang="ts">
    import LaTeX from "$lib/components/LaTeX.svelte";
    import { Input } from "$lib/components/input";
    import { cn } from "$lib/utils";

    type Props = {
        choices?: string[] | null;
        answerIndex?: number | null;
        answer?: string;
        selectedChoice?: number | null;
        showAnswerState?: boolean;
        disabled?: boolean;
    };

    let {
        choices = null,
        answerIndex = null,
        answer = $bindable(""),
        selectedChoice = $bindable<number | null>(null),
        showAnswerState = false,
        disabled = false,
    }: Props = $props();

    const CHOICE_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    let normalizedChoices = $derived(choices ?? []);
    let isMcq = $derived(normalizedChoices.length > 0);
    let canShowAnswerState = $derived(
        showAnswerState && answerIndex != null && answerIndex >= 0,
    );

    function choose(index: number) {
        if (disabled) return;
        selectedChoice = index;
    }
</script>

{#if isMcq}
    <div class="grid gap-2">
        {#each normalizedChoices as choice, i (i)}
            {@const selected = selectedChoice === i}
            {@const correct = canShowAnswerState && answerIndex === i}
            {@const incorrect =
                canShowAnswerState && selected && answerIndex !== i}
            <button
                type="button"
                {disabled}
                aria-pressed={selected}
                class={cn(
                    "flex min-h-10 w-full items-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-sm shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
                    selected && "border-primary bg-primary/30",
                    correct && "border-tertiary bg-tertiary/10",
                    incorrect && "border-destructive bg-destructive/10",
                )}
                onclick={() => choose(i)}
            >
                <span class="shrink-0 font-medium text-muted-foreground">
                    {CHOICE_LABELS[i] ?? String(i + 1)}.
                </span>
                <LaTeX class="min-w-0 flex-1">${choice}$</LaTeX>
            </button>
        {/each}
    </div>
{:else}
    <div class="max-w-sm">
        <Input
            bind:value={answer}
            {disabled}
            placeholder="Answer"
            autocomplete="off"
            spellcheck={false}
            aria-label="Answer"
        />
    </div>
{/if}
