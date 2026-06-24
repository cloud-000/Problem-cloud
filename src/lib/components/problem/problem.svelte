<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { MathStatement } from "$lib/components/math-statement";
    import { TOPIC_LABELS, type ProblemRow } from "$lib/library";
    import { cn } from "$lib/utils";
    import ProblemAnswer from "./problem-answer.svelte";

    type ProblemMode = "preview" | "practice" | "review";

    type Props = {
        problem: ProblemRow;
        answer?: string;
        selectedChoice?: number | null;
        mode?: ProblemMode;
        showAnswerState?: boolean;
        disabled?: boolean;
        class?: string;
    };

    let {
        problem,
        answer = $bindable(""),
        selectedChoice = $bindable<number | null>(null),
        mode = "practice",
        showAnswerState = false,
        disabled = false,
        class: className,
    }: Props = $props();

    let topicLabel = $derived(
        problem.topic ? (TOPIC_LABELS[problem.topic] ?? problem.topic) : null,
    );
    let officialSolutionCount = $derived(
        problem.official_solutions?.length ?? 0,
    );
</script>

{#snippet badge(text: string)}
    <span
        class="inline-flex items-center rounded-full bg-surface-container px-2 py-0.5 text-xs text-muted-foreground"
    >
        {text}
    </span>
{/snippet}

{#snippet detail(label: string, value: string | number | boolean | null | undefined)}
    {#if value !== null && value !== undefined && value !== ""}
        <div class="grid grid-cols-[6rem_1fr] gap-2">
            <span class="text-muted-foreground">{label}</span>
            <span class="min-w-0 break-words font-mono text-foreground">
                {String(value)}
            </span>
        </div>
    {/if}
{/snippet}

<article
    class={cn(
        "relative flex flex-col gap-3 rounded-lg border border-border bg-surface-container-low p-3",
        className,
    )}
>
    <header class="flex min-w-0 items-start justify-between gap-3">
        <div class="flex min-w-0 flex-wrap items-center gap-1.5">
            <span class="font-medium text-muted-foreground">
                #{problem.n + 1}
            </span>
            {#if problem.tests?.name}{@render badge(problem.tests.name)}{/if}
            {#if topicLabel}{@render badge(topicLabel)}{/if}
            {#if problem.verified}{@render badge("verified")}{/if}
        </div>

        <div class="group/details relative shrink-0">
            <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Problem details"
                class="peer"
            >
                <Icon name="info" />
            </Button>

            <div
                role="tooltip"
                class="absolute top-7 right-0 z-20 hidden w-80 rounded-lg border border-border bg-surface-container-highest p-3 text-xs shadow-lg group-hover/details:block peer-focus-visible:block peer-focus:block"
            >
                <div class="mb-2 flex items-center gap-1.5 font-medium">
                    <Icon name="bug_report" />
                    <span>Problem details</span>
                </div>
                <div class="flex flex-col gap-1.5">
                    {@render detail("id", problem.id)}
                    {@render detail("test id", problem.test_id)}
                    {@render detail("number", problem.n)}
                    {@render detail("answer", problem.answer_index)}
                    {@render detail("verified", problem.verified)}
                    {@render detail("difficulty", problem.difficulty)}
                    {@render detail("quality", problem.quality)}
                    {@render detail("computational", problem.is_computational)}
                    {@render detail("topic", problem.topic)}
                    {@render detail("tags", problem.tags?.join(", "))}
                    {@render detail("solutions", officialSolutionCount)}
                    {@render detail("built", problem.built_at)}
                    {@render detail("notes", problem.notes)}
                </div>
            </div>
        </div>
    </header>

    <MathStatement
        text={problem.statement ?? ""}
        class="min-w-0 text-sm leading-6"
    />

    <ProblemAnswer
        choices={problem.choices}
        answerIndex={problem.answer_index}
        bind:answer
        bind:selectedChoice
        {showAnswerState}
        {disabled}
    />

    {#if mode !== "preview"}
        <footer class="flex flex-wrap items-center gap-1.5">
            {#each problem.tags ?? [] as tag}{@render badge(`#${tag}`)}{/each}
            {@render badge(`difficulty ${problem.difficulty ?? 0}`)}
            {@render badge(`quality ${problem.quality ?? 0}`)}
            {#if problem.is_computational}{@render badge("computational")}{/if}
        </footer>
    {/if}
</article>
