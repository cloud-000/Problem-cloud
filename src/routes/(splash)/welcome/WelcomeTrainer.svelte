<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { MathStatement } from "$lib/components/math-statement";
    import { ProblemAnswer } from "$lib/components/problem";
    import LaTeX from "$lib/components/LaTeX.svelte";
    import { cn, formatProblemText, isMultipleChoice } from "$lib/utils";
    import { answersMatch } from "$lib/utils/answer-matcher";
    import { prefersReducedMotion } from "svelte/motion";
    import { fade } from "svelte/transition";
    import {
        welcomeProblemSource,
        type WelcomeProblem,
    } from "./welcome-trainer";

    /**
     * A self-contained trainer sit for the public splash. Chrome, answer
     * capture, and the Answer / Coach split follow the real practice view;
     * the problems are live catalog rows so a visitor can try a real contest
     * question without an account. Next always advances — same as the
     * trainer's primary action after a grade, and the skip-forward control
     * before one. Coach here is a product demo (hints, not answers) and
     * does not call a model.
     */
    let { problems }: { problems: WelcomeProblem[] } = $props();

    const coach = {
        prompt: "Where do I start?",
        reply: "Name the quantity the problem is asking for, then look at what you are given. I will hint at the next step — I will not give the answer.",
    };

    let index = $state(0);
    let answer = $state("");
    let selectedChoice = $state<number | null>(null);
    let eliminated = $state<number[]>([]);
    let submitted = $state(false);
    let empty = $state(false);
    let coachMode = $state(false);

    let problem = $derived.by(() => {
        const next = problems[index] ?? problems[0];
        if (!next) throw new Error("Welcome trainer is missing its problem set.");
        return next;
    });
    let mcq = $derived(isMultipleChoice(problem.choices));
    let source = $derived(welcomeProblemSource(problem));
    let motion = $derived(prefersReducedMotion.current ? 0 : 1);
    let many = $derived(problems.length > 1);

    let correct = $derived.by(() => {
        if (!submitted) return null;
        if (mcq) return selectedChoice === problem.answer_index;
        const expected =
            problem.answer_index != null
                ? problem.choices?.[problem.answer_index]
                : null;
        if (expected == null) return null;
        return answersMatch(answer, expected);
    });

    let hasResponse = $derived(mcq ? selectedChoice != null : answer.trim() !== "");

    function resetFor(nextIndex: number) {
        index = problems.length === 0 ? 0 : (nextIndex + problems.length) % problems.length;
        answer = "";
        selectedChoice = null;
        eliminated = [];
        submitted = false;
        empty = false;
        coachMode = false;
    }

    function submit() {
        if (!hasResponse) {
            empty = true;
            coachMode = false;
            return;
        }
        empty = false;
        submitted = true;
        coachMode = false;
    }

    function next() {
        resetFor(index + 1);
    }

    function back() {
        resetFor(index - 1);
    }
</script>

<div
    class="border-border bg-background flex h-[22rem] min-w-0 flex-col overflow-hidden rounded-xl border sm:h-[26rem]"
>
    <div class="flex min-h-0 flex-1 flex-col">
        {#key problem.id}
            <div
                class="flex h-full min-h-0 flex-col"
                in:fade={{ duration: 140 * motion }}
            >
                <div class="border-border/60 w-full shrink-0 border-b">
                    <div class="flex min-h-11 items-center justify-between gap-4 px-4 py-2 sm:px-5">
                        <p
                            class="type-caption text-muted-foreground min-w-0 truncate"
                            title={source}
                        >
                            {source}
                        </p>
                        {#if many}
                            <span class="type-caption text-muted-foreground tabular-nums">
                                {index + 1}/{problems.length}
                            </span>
                        {/if}
                    </div>
                </div>

                <div
                    class="flex min-h-0 flex-1 flex-col items-center gap-5 overflow-y-auto overscroll-y-contain px-4 py-4 sm:px-6"
                >
                    <div class="my-auto flex min-h-fit w-full flex-none items-start justify-center">
                        <MathStatement
                            text={formatProblemText(problem.statement, mcq)}
                            class="type-problem text-foreground w-full max-w-[48rem] py-4 text-left font-serif"
                        />
                    </div>

                    {#if coachMode}
                        <div class="flex w-full max-w-[48rem] flex-col gap-3">
                            <p class="type-caption text-muted-foreground">Coach</p>
                            <div
                                class="bg-muted/60 text-foreground ml-auto max-w-[85%] rounded-lg px-3 py-2 text-sm"
                            >
                                {coach.prompt}
                            </div>
                            <div
                                class="border-border max-w-[92%] rounded-lg border px-3 py-2 text-sm"
                            >
                                <LaTeX class="font-serif text-foreground">
                                    {coach.reply}
                                </LaTeX>
                            </div>
                        </div>
                    {:else}
                        <div class="flex w-full max-w-[48rem] flex-col gap-1.5">
                            <ProblemAnswer
                                choices={problem.choices}
                                answerIndex={problem.answer_index}
                                responseKind={problem.response_kind}
                                answerStatus={problem.answer_status}
                                bind:answer
                                bind:selectedChoice
                                bind:eliminated
                                showAnswerState={submitted}
                                disabled={submitted}
                                onEnter={submitted ? next : submit}
                            />
                        </div>
                    {/if}
                </div>
            </div>
        {/key}
    </div>

    <footer
        class="border-border/60 grid min-h-14 w-full shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-t bg-background px-3 py-2"
    >
        <div class="flex min-w-0 items-center gap-1 justify-self-start">
            {#if many}
                <Button
                    variant="ghost"
                    disabled={index === 0}
                    onclick={back}
                    aria-label="Previous problem"
                    class="text-muted-foreground hover:text-foreground h-auto px-2 py-1.5 text-xs font-normal disabled:opacity-30 [&_svg]:size-3.5"
                >
                    <Icon name="arrow_back" />
                </Button>
                {#if !submitted}
                    <Button
                        variant="ghost"
                        onclick={next}
                        aria-label="Next problem"
                        class="text-muted-foreground hover:text-foreground h-auto px-2 py-1.5 text-xs font-normal [&_svg]:size-3.5"
                    >
                        <Icon name="skip_next" />
                    </Button>
                {/if}
            {/if}
        </div>

        {#if !submitted}
            <Button
                variant="outline"
                aria-pressed={coachMode}
                onclick={() => (coachMode = !coachMode)}
                class="h-9 justify-self-center gap-0.5 rounded-lg p-1 text-[11px] font-semibold"
            >
                <span
                    class={cn(
                        "rounded-md px-2 py-1 transition-colors",
                        !coachMode && "bg-primary text-primary-foreground shadow-sm",
                    )}
                >
                    Answer
                </span>
                <span
                    class={cn(
                        "rounded-md px-2 py-1 transition-colors",
                        coachMode && "bg-muted text-foreground",
                    )}
                >
                    Coach
                </span>
            </Button>
        {/if}

        <div class="col-start-3 flex min-w-0 items-center gap-2 justify-self-end">
            {#if submitted}
                <span
                    class={cn(
                        "type-caption",
                        correct === true && "text-correct",
                        correct === false && "text-destructive",
                    )}
                >
                    {correct === true ? "Correct" : "Incorrect"}
                </span>
                <Button
                    variant="primary"
                    onclick={next}
                    class="h-9 gap-1.5 rounded-lg px-4 text-xs font-semibold"
                >
                    Next
                    <Icon name="arrow_forward" />
                </Button>
            {:else}
                {#if empty}
                    <span class="type-caption text-muted-foreground">Enter an answer first</span>
                {/if}
                <Button
                    variant="primary"
                    onclick={submit}
                    class="h-9 rounded-lg px-4 text-xs font-semibold"
                >
                    Submit
                </Button>
            {/if}
        </div>
    </footer>
</div>
