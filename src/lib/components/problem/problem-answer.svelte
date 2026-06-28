<script lang="ts">
    import LaTeX from "$lib/components/LaTeX.svelte";
    import { Input } from "$lib/components/input";
    import { toasts } from "$lib/state/toast.svelte";
    import { cn } from "$lib/utils";

    type Props = {
        choices?: string[] | null;
        answerIndex?: number | null;
        answer?: string;
        selectedChoice?: number | null;
        showAnswerState?: boolean;
        disabled?: boolean;
        isInstantFeedback?: boolean;
    };

    let {
        choices = null,
        answerIndex = null,
        answer = $bindable(""),
        selectedChoice = $bindable<number | null>(null),
        showAnswerState = false,
        disabled = false,
        isInstantFeedback = false,
    }: Props = $props();

    const CHOICE_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const FEEDBACK_DURATION = 900;

    let normalizedChoices = $derived(choices ?? []);
    let isMcq = $derived(normalizedChoices.length > 0);
    let canShowAnswerState = $derived(
        showAnswerState && answerIndex != null && answerIndex >= 0,
    );
    let feedback = $state<{
        result: boolean | null;
        target: number | "input" | null;
    } | null>(null);
    let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

    function choose(index: number) {
        if (disabled) return;
        if (selectedChoice === index) {
            selectedChoice = null;
        } else {
            selectedChoice = index;
        }
    }

    function chooseWithFeedback(index: number) {
        const isDeselect = selectedChoice === index;
        choose(index);
        if (isInstantFeedback) {
            if (isDeselect) {
                clearFeedbackTimer();
                feedback = null;
            } else {
                trigger(true);
            }
        }
    }

    function triggerAfterInput() {
        if (!isInstantFeedback) return;
        queueMicrotask(() => trigger(true));
    }

    function clearFeedbackTimer() {
        if (!feedbackTimer) return;
        clearTimeout(feedbackTimer);
        feedbackTimer = null;
    }

    function validAnswerIndex() {
        return (
            answerIndex != null &&
            answerIndex >= 0 &&
            answerIndex < normalizedChoices.length
        );
    }

    function checkAnswer(): boolean | null {
        if (!validAnswerIndex()) return null;

        if (isMcq) {
            if (selectedChoice == null) return null;
            return selectedChoice === answerIndex;
        }

        const response = answer.trim();
        if (!response) return null;

        return response === normalizedChoices[answerIndex as number]?.trim();
    }

    function feedbackMessage(result: boolean | null) {
        if (result !== null) return null;
        if (!validAnswerIndex()) return "Answer unavailable.";
        if (isMcq && selectedChoice == null) return "Choose an answer first.";
        return "Enter an answer first.";
    }

    function playFeedback(result: boolean | null) {
        clearFeedbackTimer();
        feedback = {
            result,
            target: isMcq ? selectedChoice : "input",
        };

        const message = feedbackMessage(result);
        if (message) toasts.warning(message, { duration: FEEDBACK_DURATION });

        feedbackTimer = setTimeout(() => {
            feedback = null;
            feedbackTimer = null;
        }, FEEDBACK_DURATION);
    }

    export function trigger(useAnimation: boolean): boolean | null {
        const result = checkAnswer();
        if (useAnimation) playFeedback(result);
        return result;
    }
</script>

{#if isMcq}
    <div
        class={cn(
            "grid gap-2 rounded-md",
            feedback?.result === null &&
                feedback.target == null &&
                "bg-unsure/10 ring-2 ring-unsure/40",
        )}
    >
        {#each normalizedChoices as choice, i (i)}
            {@const selected = selectedChoice === i}
            {@const correct = canShowAnswerState && answerIndex === i}
            {@const incorrect =
                canShowAnswerState && selected && answerIndex !== i}
            {@const feedbackActive = feedback?.target === i}
            <button
                type="button"
                {disabled}
                aria-pressed={selected}
                class={cn(
                    "flex min-h-10 w-full items-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-base shadow-xs transition-all duration-200 ease-in-out outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 hover:-translate-y-0.5 hover:shadow-md hover:bg-muted/30 hover:border-muted-foreground/30 active:scale-[0.98]",
                    selected &&
                        "border-primary bg-primary/30 hover:bg-primary/40 hover:border-primary-foreground/40",
                    correct && "border-correct bg-correct/10",
                    incorrect && "border-destructive bg-destructive/10",
                    feedbackActive &&
                        feedback?.result === true &&
                        "border-correct bg-correct/10",
                    feedbackActive &&
                        feedback?.result === false &&
                        "border-destructive bg-destructive/10 animate-answer-shake",
                    feedbackActive &&
                        feedback?.result === null &&
                        "border-unsure bg-unsure/10",
                )}
                onclick={() => chooseWithFeedback(i)}
            >
                <span
                    class="shrink-0 font-medium text-muted-foreground opacity-60 select-none"
                >
                    {CHOICE_LABELS[i] ?? String(i + 1)}
                </span>
                <LaTeX class="min-w-0 flex-1">${choice}$</LaTeX>
            </button>
        {/each}
    </div>
{:else}
    <div
        class={cn(
            "max-w-sm rounded-md",
            feedback?.target === "input" &&
                feedback.result === true &&
                "ring-3 ring-correct/40",
            feedback?.target === "input" &&
                feedback.result === false &&
                "animate-answer-shake ring-3 ring-destructive/40",
            feedback?.target === "input" &&
                feedback.result === null &&
                "ring-3 ring-unsure/40",
        )}
    >
        <Input
            bind:value={answer}
            {disabled}
            placeholder="Answer"
            autocomplete="off"
            spellcheck={false}
            aria-label="Answer"
            oninput={triggerAfterInput}
        />
    </div>
{/if}
