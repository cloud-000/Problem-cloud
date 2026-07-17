<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { StatusTag } from "$lib/components/status-tag";
    import { Toggle } from "$lib/components/toggle";
    import { MathStatement } from "$lib/components/math-statement";
    import {
        topicLabel,
        ratingIsProvisional,
        aopsProblemUrl,
        aopsCommunityUrl,
        type ProblemRow,
        type ProblemRating,
    } from "$lib/library";
    import { statusFor } from "$lib/progress";
    import {
        reviewScheduleFor,
        type Engagement,
        type Mastery,
        type PersonalProblemState,
    } from "$lib/progress";
    import { ProblemOrganization } from "$lib/components/problem-organization";
    import { cn } from "$lib/utils";
    import ProblemAnswer from "./problem-answer.svelte";

    type ProblemMode = "preview" | "practice" | "review";

    type Props = {
        problem: ProblemRow;
        answer?: string;
        selectedChoice?: number | null;
        eliminated?: number[];
        mastery?: Mastery | null;
        engagement?: Engagement | null;
        mode?: ProblemMode;
        showAnswerState?: boolean;
        disabled?: boolean;
        isInstantFeedback?: boolean;
        /** Enables debugging affordances, e.g. the raw-text statement toggle. */
        debug?: boolean;
        promptMastery?: boolean;
        class?: string;
        /** Fired when the user presses Enter in the free-response input. */
        onEnter?: () => void;
        onOrganizationChange?: (state: PersonalProblemState) => void;
    };

    let {
        problem,
        answer = $bindable(""),
        selectedChoice = $bindable<number | null>(null),
        eliminated = $bindable<number[]>([]),
        mastery: masteryValue,
        engagement: engagementValue,
        mode = "practice",
        showAnswerState = false,
        disabled = false,
        isInstantFeedback = false,
        debug = false,
        promptMastery = false,
        class: className,
        onEnter,
        onOrganizationChange,
    }: Props = $props();

    // Show the raw statement string instead of the rendered math. Debug-only.
    let showRaw = $state(false);
    let topicName = $derived(topicLabel(problem.topic));
    // The signed-in user's interaction state: "solved" | "attempted" | "unseen".
    let status = $derived(statusFor(problem.progress));
    let mastery = $derived<Mastery | null>(
        masteryValue === undefined
            ? (problem.progress?.mastery ?? null)
            : masteryValue,
    );
    let engagement = $derived<Engagement | null>(
        engagementValue === undefined
            ? (problem.progress?.engagement ?? null)
            : engagementValue,
    );
    let officialSolutionCount = $derived(
        problem.official_solutions?.length ?? 0,
    );
    let isMultipleChoice = $derived((problem.choices?.length ?? 0) > 1);
    let problemAnswer = $state<ProblemAnswer | null>(null);

    let aopsProblemHref = $derived(aopsProblemUrl(problem.aops_id));
    let aopsTestHref = $derived(
        aopsCommunityUrl(problem.tests?.aops_category_id),
    );

    export function trigger(useAnimation: boolean): boolean | null {
        return problemAnswer?.trigger(useAnimation) ?? null;
    }
</script>

{#snippet badge(text: string)}
    <span
        class="inline-flex items-center rounded-full border border-border/60 bg-surface-container-lowest px-2 py-0.5 text-xs text-muted-foreground"
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
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
            provisional
                ? "border-border/60 bg-surface-container-lowest text-muted-foreground"
                : "border-primary/20 bg-primary/10 text-primary-foreground",
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
        "relative rounded-xl border border-border/70 bg-surface-container-lowest shadow-xs",
        className,
    )}
>
    <header
        class="flex min-w-0 items-start justify-between gap-3 rounded-t-xl border-b border-border/60 bg-surface-container-low px-3 py-3 sm:px-4"
    >
        <div class="flex min-w-0 items-start gap-3">
            <div
                class="flex size-11 shrink-0 flex-col items-center justify-center rounded-lg border border-border/70 bg-surface-container-lowest shadow-xs"
                aria-label={`Problem ${problem.n + 1}`}
            >
                <span class="text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">No.</span>
                <span class="-mt-0.5 text-base font-semibold tabular-nums text-foreground">{problem.n + 1}</span>
            </div>

            <div class="flex min-w-0 flex-col gap-1.5">
                {#if problem.tests?.name}
                    <div class="flex min-w-0 items-center gap-1.5">
                        {#if aopsTestHref}
                            <Button
                                href={aopsTestHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                variant="link"
                                size="xs"
                                class="h-auto min-w-0 justify-start p-0 text-sm font-semibold text-foreground"
                                title={`Open ${problem.tests.name} on Art of Problem Solving`}
                            >
                                <span class="truncate">{problem.tests.name}</span>
                            </Button>
                        {:else}
                            <span class="min-w-0 truncate text-sm font-semibold text-foreground">{problem.tests.name}</span>
                        {/if}
                        {#if problem.verified}
                            <Icon name="verified" class="shrink-0 text-correct" fontsize="1rem" fill />
                        {/if}
                    </div>
                {:else}
                    <span class="text-sm font-semibold text-foreground">Problem {problem.n + 1}</span>
                {/if}

                <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                    {#if topicName}{@render badge(topicName)}{/if}
                    {#if problem.rating}{@render ratingBadge(problem.rating)}{/if}
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
                    {#if problem.answer_index === null || problem.answer_index < 0}
                        <span class="inline-flex items-center gap-1 rounded-full border border-unsure/25 bg-unsure/10 px-2 py-0.5 text-xs font-medium text-unsure">
                            <Icon name="warning" fontsize="0.85rem" /> Answer unavailable
                        </span>
                    {/if}
                </div>
            </div>
        </div>

        <nav class="flex shrink-0 items-center gap-1" aria-label="Problem actions">
            {#if debug}
                <Toggle
                    variant="ghost"
                    size="sm"
                    class="size-8 px-0"
                    bind:pressed={showRaw}
                    aria-label="Toggle raw statement text"
                    title="Toggle raw statement text"
                >
                    <Icon name="code" />
                </Toggle>
            {/if}

            {#if aopsProblemHref}
                <Button
                    href={aopsProblemHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="ghost"
                    size="sm"
                    class="px-2 text-muted-foreground"
                    aria-label="Open problem discussion on Art of Problem Solving"
                    title="Open problem discussion on Art of Problem Solving"
                >
                    <Icon name="forum" class="size-3.5" />
                    <span class="hidden lg:inline">Discuss</span>
                </Button>
            {/if}

            <details class="group/details relative">
                <summary
                    class="flex size-8 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                    aria-label="Problem details"
                    title="Problem details"
                >
                    <Icon name="info" />
                </summary>
                <div
                    class="absolute top-10 right-0 z-30 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface-container-highest p-3 text-xs shadow-lg"
                >
                    <div class="mb-2 flex items-center gap-1.5 font-semibold text-foreground">
                        <Icon name="database" />
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
                        {@render detail("computational", problem.is_computational)}
                        {@render detail("topic", problem.topic)}
                        {@render detail("tags", problem.tags?.join(", "))}
                        {@render detail("solutions", officialSolutionCount)}
                        {@render detail("built", problem.built_at)}
                        {@render detail("notes", problem.notes)}
                    </div>
                </div>
            </details>
        </nav>
    </header>

    <div class="px-3 py-4 sm:px-5 sm:py-5">
        <div class="mx-auto flex w-full max-w-4xl flex-col gap-5">
            <ProblemOrganization
                problemId={problem.id}
                {mastery}
                {engagement}
                prompt={promptMastery}
                onchange={(state) => {
                    mastery = state.mastery;
                    engagement = state.engagement;
                    onOrganizationChange?.(state);
                }}
            />

            <section aria-label={`Problem ${problem.n + 1} statement`}>
                {#if debug && showRaw}
                    <pre
                        class="min-w-0 overflow-x-auto rounded-lg border border-border/60 bg-surface-container-low p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words text-foreground">{problem.statement ??
                            ""}</pre>
                {:else}
                    <MathStatement
                        text={problem.statement ?? ""}
                        class="min-w-0 text-base leading-7 text-foreground md:text-lg md:leading-8"
                    />
                {/if}
            </section>

            <section class="flex flex-col gap-2.5" aria-label="Your response">
                <div class="flex flex-wrap items-end justify-between gap-x-3 gap-y-1 border-t border-border/60 pt-4">
                    <div>
                        <h3 class="text-sm font-semibold text-foreground">Your answer</h3>
                        <p class="text-xs text-muted-foreground">
                            {isMultipleChoice ? "Choose the best option." : "Enter your response below."}
                        </p>
                    </div>
                    {#if isMultipleChoice && !disabled}
                        <span class="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
                            <Icon name="ink_eraser" fontsize="0.9rem" />
                            Right-click or use × to eliminate
                        </span>
                    {/if}
                </div>

                <ProblemAnswer
                    bind:this={problemAnswer}
                    choices={problem.choices}
                    answerIndex={problem.answer_index}
                    bind:answer
                    bind:selectedChoice
                    bind:eliminated
                    {showAnswerState}
                    {disabled}
                    {isInstantFeedback}
                    {onEnter}
                />
            </section>
        </div>
    </div>

    {#if mode !== "preview" && ((problem.tags?.length ?? 0) > 0 || problem.is_computational)}
        <footer
            class="flex flex-wrap items-center gap-1.5 rounded-b-xl border-t border-border/60 bg-surface-container-low px-3 py-2.5 sm:px-5"
        >
            {#each problem.tags ?? [] as tag (tag)}{@render badge(`#${tag}`)}{/each}
            {#if problem.is_computational}{@render badge("computational")}{/if}
        </footer>
    {/if}
</article>
