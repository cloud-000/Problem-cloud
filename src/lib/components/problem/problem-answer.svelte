<script lang="ts">
    import LaTeX from "$lib/components/LaTeX.svelte";
    import { Icon } from "$lib/components/icon";
    import { Input } from "$lib/components/input";
    import { toasts } from "$lib/state/toast.svelte";
    import { cn } from "$lib/utils";
    import { answersMatch } from "$lib/utils/answer-matcher";

    type Props = {
        choices?: string[] | null;
        answerIndex?: number | null;
        answer?: string;
        selectedChoice?: number | null;
        /** Indices of MCQ choices the user has crossed out (elimination aid). */
        eliminated?: number[];
        showAnswerState?: boolean;
        disabled?: boolean;
        isInstantFeedback?: boolean;
        /** Fired when the user presses Enter in the free-response input. */
        onEnter?: () => void;
    };

    let {
        choices = null,
        answerIndex = null,
        answer = $bindable(""),
        selectedChoice = $bindable<number | null>(null),
        eliminated = $bindable<number[]>([]),
        showAnswerState = false,
        disabled = false,
        isInstantFeedback = false,
        onEnter,
    }: Props = $props();

    const CHOICE_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const FEEDBACK_DURATION = 900;

    let normalizedChoices = $derived(choices ?? []);
    let isMcq = $derived(normalizedChoices.length > 1);
    let canShowAnswerState = $derived(
        showAnswerState && answerIndex != null && answerIndex >= 0,
    );
    let isCorrect = $derived(canShowAnswerState && checkAnswer() === true);
    let feedback = $state<{
        result: boolean | null;
        target: number | "input" | null;
    } | null>(null);
    let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

    let isFocused = $state(false);
    let inputEl = $state<HTMLInputElement | null>(null);
    let showViewMode = $derived(!isFocused && answer.trim() !== "");

    function startEditing() {
        if (disabled) return;
        isFocused = true;
        setTimeout(() => {
            inputEl?.focus();
        }, 0);
    }

    function choose(index: number) {
        if (disabled) return;
        if (selectedChoice === index) {
            selectedChoice = null;
        } else {
            selectedChoice = index;
        }
    }

    function chooseWithFeedback(index: number) {
        if (disabled) return;
        // Clicking a crossed-out choice restores it rather than selecting it, so a
        // user can undo an accidental elimination without committing to the answer.
        if (eliminated.includes(index)) {
            toggleEliminated(index);
            return;
        }
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

    // Toggle a choice's crossed-out state. Eliminating the currently selected
    // choice also clears the selection (a struck answer can't be the submission).
    function toggleEliminated(index: number) {
        if (disabled) return;
        if (eliminated.includes(index)) {
            eliminated = eliminated.filter((i) => i !== index);
        } else {
            eliminated = [...eliminated, index];
            if (selectedChoice === index) selectedChoice = null;
        }
    }

    function handleChoiceContextMenu(event: MouseEvent, index: number) {
        event.preventDefault();
        toggleEliminated(index);
    }

    // Instant feedback fires on *change* (blur / Enter), not on every keystroke,
    // so a half-typed answer isn't graded as you go.
    function triggerOnChange() {
        if (!isInstantFeedback) return;
        queueMicrotask(() => trigger(true));
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            inputEl?.blur();
            return;
        }
        if (event.key !== "Enter" || disabled) return;
        event.preventDefault();
        if (onEnter) {
            onEnter();
        } else if (isInstantFeedback) {
            trigger(true);
        }
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

        const expected = normalizedChoices[answerIndex as number];
        if (expected == null) return null;

        return answersMatch(response, expected);
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
            "grid gap-2.5 rounded-lg",
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
            {@const struck = eliminated.includes(i)}
            <div class="group/choice relative">
                <button
                    type="button"
                    {disabled}
                    aria-pressed={selected}
                    class={cn(
                        "flex min-h-12 w-full items-start gap-3 rounded-lg border border-border/80 bg-background py-3 pr-11 pl-3 text-left text-base shadow-xs transition-[border-color,background-color,box-shadow] duration-150 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60 hover:border-muted-foreground/40 hover:bg-surface-container-low",
                        selected &&
                            "border-primary-foreground/60 bg-primary/10 shadow-[inset_3px_0_0_var(--color-primary-foreground)] hover:border-primary-foreground/70 hover:bg-primary/15",
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
                        struck &&
                            "border-dashed opacity-35 bg-diagonal-stripes grayscale-50 scale-[0.99] hover:translate-y-0 hover:shadow-xs hover:opacity-60 hover:border-primary-foreground/25",
                    )}
                    onclick={() => chooseWithFeedback(i)}
                    oncontextmenu={(e) => handleChoiceContextMenu(e, i)}
                >
                    <span
                        class={cn(
                            "flex size-7 shrink-0 items-center justify-center rounded-md border text-xs font-semibold select-none transition-all duration-150",
                            selected
                                ? "border-primary-foreground bg-primary-foreground text-background"
                                : "border-border/70 bg-surface-container text-muted-foreground",
                            correct && "bg-correct text-on-correct",
                            incorrect && "bg-destructive text-destructive-foreground",
                            feedbackActive &&
                                feedback?.result === true &&
                                "bg-correct text-on-correct",
                            feedbackActive &&
                                feedback?.result === false &&
                                "bg-destructive text-destructive-foreground",
                            struck && "border-border/50 bg-muted/80 text-muted-foreground/60 opacity-40"
                        )}
                    >
                        {CHOICE_LABELS[i] ?? String(i + 1)}
                    </span>
                    <LaTeX class="min-w-0 flex-1">${choice}$</LaTeX>
                    
                    <!-- Interactive strike-through line that animates from left to right -->
                    <div
                        class={cn(
                            "pointer-events-none absolute top-[calc(50%-1px)] right-[44px] left-[50px] z-5 h-[1.5px] origin-left -translate-y-1/2 scale-x-0 bg-muted-foreground/35 transition-transform duration-300 ease-out",
                            struck && "scale-x-100 bg-muted-foreground/30"
                        )}
                    ></div>
                </button>
                <button
                    type="button"
                    {disabled}
                    aria-pressed={struck}
                    aria-label={struck ? "Restore choice" : "Eliminate choice"}
                    title={struck ? "Restore choice" : "Eliminate choice"}
                    class={cn(
                        "absolute top-1/2 right-2 z-10 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md transition-all focus-visible:opacity-100 disabled:pointer-events-none [@media(hover:none)]:opacity-100",
                        struck
                            ? "text-muted-foreground/60 opacity-80 group-hover/choice:opacity-100 group-hover/choice:text-primary-foreground hover:scale-110 hover:bg-primary/20!"
                            : "text-muted-foreground opacity-0 group-hover/choice:opacity-100 hover:bg-muted hover:text-foreground"
                    )}
                    onclick={() => toggleEliminated(i)}
                >
                    <Icon
                        name={struck ? "undo" : "close"}
                        class="size-[1.1em]"
                    />
                </button>
            </div>
        {/each}
    </div>
{:else}
    <div
        class={cn(
            "relative w-full rounded-lg",
            feedback?.target === "input" &&
                feedback.result === true &&
                "ring-3 ring-correct/40",
            feedback?.target === "input" &&
                feedback.result === false &&
                "animate-answer-shake ring-3 ring-destructive/40",
            feedback?.target === "input" &&
                feedback.result === null &&
                "ring-3 ring-unsure/40",
            canShowAnswerState && isCorrect && "ring-3 ring-correct/40",
            canShowAnswerState && !isCorrect && "ring-3 ring-destructive/40",
        )}
    >
        {#if showViewMode}
            <button
                type="button"
                {disabled}
                onclick={startEditing}
                onfocus={startEditing}
                class={cn(
                    "flex h-11 w-full min-w-0 cursor-pointer items-center justify-center rounded-lg border border-input bg-transparent px-3 py-2 text-center text-base text-foreground shadow-xs transition-all hover:bg-muted/10 dark:bg-input/30",
                    canShowAnswerState && isCorrect && "border-correct bg-correct/10",
                    canShowAnswerState && !isCorrect && "border-destructive bg-destructive/10",
                )}
                title="Click or focus to edit answer math"
            >
                <LaTeX class="inline-block">${answer}$</LaTeX>
            </button>
        {:else}
            {#if isFocused && answer.trim()}
                <!-- Floating live rendered preview popover -->
                <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 z-50 pointer-events-none select-none">
                    <div class="relative bg-surface-container-lowest border border-border rounded-lg shadow-lg p-2.5 min-h-8 min-w-[70px] flex items-center justify-center">
                        <LaTeX class="text-center">${answer}$</LaTeX>
                        <!-- Small pointer arrow -->
                        <div class="absolute top-full left-1/2 -translate-x-1/2 -mt-1.5 w-3 h-3 bg-surface-container-lowest border-r border-b border-border rotate-45"></div>
                    </div>
                </div>
            {/if}

            <Input
                bind:ref={inputEl}
                bind:value={answer}
                {disabled}
                placeholder="Answer"
                autocomplete="off"
                spellcheck={false}
                aria-label="Answer"
                onfocus={() => isFocused = true}
                onblur={() => isFocused = false}
                onchange={triggerOnChange}
                onkeydown={handleKeydown}
                class={cn(
                    "h-11 rounded-lg text-center text-base",
                    canShowAnswerState &&
                        isCorrect &&
                        "border-correct bg-correct/10 focus-visible:border-correct focus-visible:ring-correct/50",
                    canShowAnswerState &&
                        !isCorrect &&
                        "border-destructive bg-destructive/10 focus-visible:border-destructive focus-visible:ring-destructive/50",
                )}
            />
        {/if}
    </div>
    {#if canShowAnswerState && !isCorrect}
        <div
            class="mt-2 text-sm text-muted-foreground flex items-center gap-1.5"
        >
            <span>Correct answer:</span>
            <span
                class="font-mono text-foreground font-semibold bg-surface-container px-1.5 py-0.5 rounded border border-border"
            >
                <LaTeX class="inline-block"
                    >${normalizedChoices[answerIndex as number]}$</LaTeX
                >
            </span>
        </div>
    {/if}
{/if}
