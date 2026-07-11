<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { StatusTag } from "$lib/components/status-tag";
    import { LinkMenu } from "$lib/components/link-menu";
    import { Toggle } from "$lib/components/toggle";
    import { MathStatement } from "$lib/components/math-statement";
    import {
        topicLabel,
        ratingIsProvisional,
        aopsProblemUrl,
        type ProblemRow,
        type ProblemRating,
    } from "$lib/library";
    import { statusFor } from "$lib/progress";
    import { reviewScheduleFor, type Engagement, type Mastery } from "$lib/progress";
    import { ProblemOrganization } from "$lib/components/problem-organization";
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
        promptMastery?: boolean;
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
        promptMastery = false,
        class: className,
    }: Props = $props();

    // Show the raw statement string instead of the rendered math. Debug-only.
    let showRaw = $state(false);

    let topicName = $derived(topicLabel(problem.topic));
    // The signed-in user's interaction state: "solved" | "attempted" | "unseen".
    let status = $derived(statusFor(problem.progress));
    let mastery = $derived<Mastery | null>(problem.progress?.mastery ?? null);
    let engagement = $derived<Engagement | null>(problem.progress?.engagement ?? null);
    let officialSolutionCount = $derived(
        problem.official_solutions?.length ?? 0,
    );
    let problemAnswer = $state<ProblemAnswer | null>(null);

    let aopsProblemHref = $derived(aopsProblemUrl(problem.aops_id));
    let aopsLinks = $derived(
        aopsProblemHref != null
            ? [{ label: "Art of Problem Solving", href: aopsProblemHref }]
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

{#snippet ratingBadge(r: ProblemRating)}
    {@const provisional = ratingIsProvisional(r)}
    <span
        title={provisional
            ? "Provisional rating — few attempts / high uncertainty"
            : `Skill rating from ${r.attempts} rated attempt${r.attempts === 1 ? "" : "s"}`}
        class={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
            provisional
                ? "bg-surface-container text-muted-foreground"
                : "bg-primary/10 text-primary-foreground",
        )}
    >
        <Icon name="speed" fontsize="0.9rem" />
        {provisional ? "~" : ""}{Math.round(r.rating)}
    </span>
{/snippet}

{#snippet detail(
    label: string,
    value: string | number | boolean | null | undefined,
)}
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
            {#if topicName}{@render badge(topicName)}{/if}
            {#if problem.rating}{@render ratingBadge(problem.rating)}{/if}
            {#if problem.verified}{@render badge("verified")}{/if}
            {#if status === "solved"}
                <StatusTag status="solved" size="sm" />
            {:else if status === "attempted"}
                <StatusTag status="attempted" size="sm" />
            {:else if status === "skipped_only"}
                <StatusTag status="skipped" label="Skipped only" size="sm" />
            {/if}
            {#if reviewScheduleFor(problem.progress) === "due"}
                <StatusTag status="review" label="Review due" size="sm" />
            {/if}
        </div>

        <div class="flex shrink-0 items-center justify-center gap-1">
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

            <LinkMenu
                links={aopsLinks}
                label="Open in Art of Problem Solving"
            />
            {#if problem.answer_index === null || problem.answer_index < 0}
                <Icon name="question_mark" class="text-unsure" fontsize="1em" />
            {/if}
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
                        {@render detail(
                            "rating",
                            problem.rating
                                ? `${Math.round(problem.rating.rating)} ±${Math.round(problem.rating.rd)} (${problem.rating.attempts})`
                                : null,
                        )}
                        {@render detail("difficulty", problem.difficulty)}
                        {@render detail("quality", problem.quality)}
                        {@render detail(
                            "computational",
                            problem.is_computational,
                        )}
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

    <ProblemOrganization
        problemId={problem.id}
        {mastery}
        {engagement}
        prompt={promptMastery}
        onchange={(state) => {
            mastery = state.mastery;
            engagement = state.engagement;
        }}
    />

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
            {#each problem.tags ?? [] as tag (tag)}{@render badge(`#${tag}`)}{/each}
            {@render badge(`quality ${problem.quality ?? 0}`)}
            {#if problem.is_computational}{@render badge("computational")}{/if}
        </footer>
    {/if}
</article>
