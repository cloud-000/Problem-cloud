<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { MathStatement } from "$lib/components/math-statement";
    import { ProblemAnswer } from "$lib/components/problem";
    import LaTeX from "$lib/components/LaTeX.svelte";
    import { cn, isMultipleChoice } from "$lib/utils";
    import { answersMatch } from "$lib/utils/answer-matcher";
    import { prefersReducedMotion } from "svelte/motion";
    import { fade } from "svelte/transition";

    /**
     * A self-contained trainer mock for the public splash. Chrome, answer
     * capture, and the Answer / Coach split follow the real practice view;
     * the problems are short samples so a visitor can sit one without an
     * account. Next always advances — same as the trainer's primary action
     * after a grade, and the skip-forward control before one.
     */
    type Sample = {
        id: string;
        source: string;
        statement: string;
        choices: string[];
        answerIndex: number;
        coach: { prompt: string; reply: string };
    };

    const samples: Sample[] = [
        {
            id: "algebra",
            source: "Sample · Algebra",
            statement:
                "Find the sum of all real solutions to the equation $x^2 - 5x + 6 = 0$.",
            choices: ["5"],
            answerIndex: 0,
            coach: {
                prompt: "Where do I start?",
                reply: "Once the leading coefficient is $1$, Vieta puts the sum of roots in the coefficient of $x$. You do not have to find the roots first.",
            },
        },
        {
            id: "combinatorics",
            source: "Sample · Combinatorics",
            statement:
                "A committee of $3$ people is chosen from a group of $5$. How many different committees are possible?",
            choices: ["10"],
            answerIndex: 0,
            coach: {
                prompt: "Does order matter here?",
                reply: "The same three people are one committee no matter who is listed first. That is a combination, not a permutation.",
            },
        },
        {
            id: "amc",
            source: "Sample · AMC 10",
            statement:
                "A fair six-sided die is rolled twice. What is the probability that the two rolls show different faces?",
            choices: [
                "\\dfrac{1}{6}",
                "\\dfrac{5}{6}",
                "\\dfrac{1}{2}",
                "\\dfrac{2}{3}",
                "\\dfrac{4}{5}",
            ],
            answerIndex: 1,
            coach: {
                prompt: "Should I count ordered pairs?",
                reply: "Yes — $6 \\times 6$ equally likely outcomes. It is often easier to count the cases where the faces match, then take the complement.",
            },
        },
        {
            id: "geometry",
            source: "Sample · Geometry",
            statement:
                "A right triangle has legs of length $5$ and $12$. What is the length of its hypotenuse?",
            choices: ["13"],
            answerIndex: 0,
            coach: {
                prompt: "Is this a triangle I should recognize?",
                reply: "Compute $5^2 + 12^2$ and see whether the sum is a square you already know. Several contest triangles are worth memorizing.",
            },
        },
        {
            id: "number-theory",
            source: "Sample · Number theory",
            statement:
                "What is the remainder when $2^{100}$ is divided by $3$?",
            choices: ["1"],
            answerIndex: 0,
            coach: {
                prompt: "The exponent is huge. What shrinks it?",
                reply: "Work modulo $3$. Notice $2 \\equiv -1$, so the power becomes a sign that depends only on whether the exponent is even.",
            },
        },
    ];

    let index = $state(0);
    let answer = $state("");
    let selectedChoice = $state<number | null>(null);
    let eliminated = $state<number[]>([]);
    let submitted = $state(false);
    let empty = $state(false);
    let coachMode = $state(false);

    let sample = $derived.by(() => {
        const next = samples[index] ?? samples[0];
        if (!next) throw new Error("Welcome trainer is missing its sample set.");
        return next;
    });
    let mcq = $derived(isMultipleChoice(sample.choices));
    let motion = $derived(prefersReducedMotion.current ? 0 : 1);

    let correct = $derived.by(() => {
        if (!submitted) return null;
        if (mcq) return selectedChoice === sample.answerIndex;
        const expected = sample.choices[sample.answerIndex];
        if (expected == null) return null;
        return answersMatch(answer, expected);
    });

    let hasResponse = $derived(mcq ? selectedChoice != null : answer.trim() !== "");

    function resetFor(nextIndex: number) {
        index = (nextIndex + samples.length) % samples.length;
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
        {#key sample.id}
            <div
                class="flex h-full min-h-0 flex-col"
                in:fade={{ duration: 140 * motion }}
            >
                <div class="border-border/60 w-full shrink-0 border-b">
                    <div class="flex min-h-11 items-center justify-between gap-4 px-4 py-2 sm:px-5">
                        <p
                            class="type-caption text-muted-foreground min-w-0 truncate"
                            title={sample.source}
                        >
                            {sample.source}
                        </p>
                        <span class="type-caption text-outline-variant tabular-nums">
                            {index + 1}/{samples.length}
                        </span>
                    </div>
                </div>

                <div
                    class="flex min-h-0 flex-1 flex-col items-center gap-5 overflow-y-auto overscroll-y-contain px-4 py-4 sm:px-6"
                >
                    <div class="my-auto flex min-h-fit w-full flex-none items-start justify-center">
                        <MathStatement
                            text={sample.statement}
                            class="type-problem text-foreground w-full max-w-[48rem] py-4 text-left font-serif"
                        />
                    </div>

                    {#if coachMode}
                        <div class="flex w-full max-w-[48rem] flex-col gap-3">
                            <p class="type-caption text-muted-foreground">Coach</p>
                            <div
                                class="bg-muted/60 text-foreground ml-auto max-w-[85%] rounded-lg px-3 py-2 text-sm"
                            >
                                {sample.coach.prompt}
                            </div>
                            <div
                                class="border-border max-w-[92%] rounded-lg border px-3 py-2 text-sm"
                            >
                                <LaTeX class="font-serif text-foreground">
                                    {sample.coach.reply}
                                </LaTeX>
                            </div>
                        </div>
                    {:else}
                        <div class="flex w-full max-w-[48rem] flex-col gap-1.5">
                            <ProblemAnswer
                                choices={sample.choices}
                                answerIndex={sample.answerIndex}
                                answerStatus="known"
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
        </div>

        {#if !submitted}
            <Button
                variant="outline"
                aria-pressed={coachMode}
                aria-label={coachMode ? "Switch to answer mode" : "Switch to Coach mode"}
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
