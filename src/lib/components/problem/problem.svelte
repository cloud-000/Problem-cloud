<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { LinkMenu } from "$lib/components/link-menu";
    import { Toggle } from "$lib/components/toggle";
    import { MathStatement } from "$lib/components/math-statement";
    import { TOPIC_LABELS, type ProblemRow } from "$lib/library";
    import { statusFor } from "$lib/progress";
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
        isInstantFeedback?: boolean;
        /** Enables debugging affordances, e.g. the raw-text statement toggle. */
        debug?: boolean;
        class?: string;
    };

    let {
        problem,
        answer = $bindable(""),
        selectedChoice = $bindable<number | null>(null),
        mode = "practice",
        showAnswerState = false,
        disabled = false,
        isInstantFeedback = false,
        debug = false,
        class: className,
    }: Props = $props();

    // Show the raw statement string instead of the rendered math. Debug-only.
    let showRaw = $state(false);

    let topicLabel = $derived(
        problem.topic ? (TOPIC_LABELS[problem.topic] ?? problem.topic) : null,
    );
    // The signed-in user's interaction state: "solved" | "attempted" | "unseen".
    let status = $derived(statusFor(problem.progress));
    let officialSolutionCount = $derived(
        problem.official_solutions?.length ?? 0,
    );
    let problemAnswer = $state<ProblemAnswer | null>(null);

    let aopsLinks = $derived(
        problem.aops_id != null
            ? [
                  {
                      label: "Art of Problem Solving",
                      href: `https://artofproblemsolving.com/community/h${problem.aops_id}`,
                  },
              ]
            : [],
    );

    export function trigger(useAnimation: boolean): boolean | null {
        return problemAnswer?.trigger(useAnimation) ?? null;
    }
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
            {#if status === "solved"}
                <span
                    class="inline-flex items-center gap-1 rounded-full bg-correct/10 px-2 py-0.5 text-xs font-medium text-correct"
                >
                    <Icon name="check_circle" class="size-[1em]" fill />
                    Solved
                </span>
            {:else if status === "attempted"}
                <span
                    class="inline-flex items-center gap-1 rounded-full bg-surface-container px-2 py-0.5 text-xs font-medium text-unsure"
                >
                    <Icon name="history" class="size-[1em]" />
                    Attempted
                </span>
            {/if}
        </div>

        <div class="flex shrink-0 items-center gap-1">
            {#if debug}
                <Toggle
                    variant="ghost"
                    size="sm"
                    class="px-1.5"
                    bind:pressed={showRaw}
                    aria-label="Toggle raw statement text"
                    title="Toggle raw statement text"
                >
                    <Icon name="code" />
                </Toggle>
            {/if}

            <LinkMenu links={aopsLinks} label="Open in Art of Problem Solving" />

            <div class="group/details relative">
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Problem details"
                    class="peer text-muted-foreground opacity-50 transition-opacity group-hover/details:opacity-100 hover:opacity-100 focus-visible:opacity-100"
                >
                <Icon name="info" />
            </Button>

            <div
                role="tooltip"
                class="pointer-events-none absolute top-7 right-0 z-20 w-80 -translate-y-1 rounded-lg border border-border bg-surface-container-highest p-3 text-xs opacity-0 shadow-lg transition-[opacity,transform] duration-150 ease-out group-hover/details:pointer-events-auto group-hover/details:translate-y-0 group-hover/details:opacity-100 peer-focus-visible:pointer-events-auto peer-focus-visible:translate-y-0 peer-focus-visible:opacity-100"
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
        </div>
    </header>

    {#if debug && showRaw}
        <pre
            class="min-w-0 overflow-x-auto rounded-md bg-surface-container p-2 font-mono text-xs leading-5 whitespace-pre-wrap break-words text-foreground">{problem.statement ??
                ""}</pre>
    {:else}
        <MathStatement
            text={problem.statement ?? ""}
            class="min-w-0 text-sm leading-6"
        />
    {/if}

    <ProblemAnswer
        bind:this={problemAnswer}
        choices={problem.choices}
        answerIndex={problem.answer_index}
        bind:answer
        bind:selectedChoice
        {showAnswerState}
        {disabled}
        {isInstantFeedback}
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
