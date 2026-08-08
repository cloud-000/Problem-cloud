<script lang="ts">
    import LaTeX from "$lib/components/LaTeX.svelte";
    import { Icon } from "$lib/components/icon";
    import { HiddenText } from "$lib/components/hidden-text";
    import { Input } from "$lib/components/input";
    import { StatusTag } from "$lib/components/status-tag";
    import { toasts } from "$lib/state/toast.svelte";
    import { cn, isMultipleChoice } from "$lib/utils";
    import { answersMatch } from "$lib/utils/answer-matcher";
    import {
        hasComparableAnswer,
        inputModeFor,
        resolveResponseKind,
        type AnswerStatus,
        type ResponseKind,
    } from "$lib/problem-response";

    type Props = {
        choices?: string[] | null;
        answerIndex?: number | null;
        responseKind?: ResponseKind | string | null;
        answerStatus?: AnswerStatus | string | null;
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
        responseKind = null,
        answerStatus = null,
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
    let responseMode = $derived(
        inputModeFor(
            resolveResponseKind({
                response_kind: responseKind,
                choices: normalizedChoices,
            }),
        ),
    );
    let isMcq = $derived(
        responseMode === "choice" && isMultipleChoice(normalizedChoices),
    );
    let canShowAnswerState = $derived(
        showAnswerState &&
            hasComparableAnswer({
                answer_status: answerStatus,
                choices: normalizedChoices,
                answer_index: answerIndex,
            }),
    );
    let answerResult = $derived(
        canShowAnswerState ? checkAnswer() : null,
    );
    let hasOutcome = $derived(answerResult !== null);
    let isCorrect = $derived(answerResult === true);
    let answerBlocked = $state(true);
    // The student's outcome is never secret. Only the canonical answer stays
    // behind the disclosure after an incorrect submission.
    let correctAnswerVisible = $derived(
        hasOutcome && (isCorrect || !answerBlocked),
    );
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

{#if responseMode === "unsupported"}
    <div
        class="flex min-h-24 w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-surface-container-low p-4 text-center"
        role="status"
    >
        <span class="text-sm font-medium text-foreground">Response not supported yet</span>
        <span class="max-w-md text-xs text-muted-foreground">
            This problem remains part of the test, but this response type cannot be captured here yet.
        </span>
    </div>
{:else if responseMode === "choice"}
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
            {@const correct = correctAnswerVisible && answerIndex === i}
            {@const incorrect =
                hasOutcome && selected && answerIndex !== i}
            {@const feedbackActive = feedback?.target === i}
            {@const struck = eliminated.includes(i)}
            <div class="group/choice relative">
                <button
                    type="button"
                    {disabled}
                    aria-pressed={selected}
                    class={cn(
                        "flex min-h-10 w-full items-start gap-2.5 rounded-md border border-border bg-background py-2.5 pr-10 pl-3 text-left text-base shadow-xs transition-all duration-200 ease-in-out outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 hover:-translate-y-0.5 hover:shadow-md hover:bg-muted/30 hover:border-muted-foreground/30 active:scale-[0.98]",
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
                        struck &&
                            "border-dashed opacity-35 bg-diagonal-stripes grayscale-50 scale-[0.99] hover:translate-y-0 hover:shadow-xs hover:opacity-60 hover:border-primary-foreground/25",
                    )}
                    onclick={() => chooseWithFeedback(i)}
                    oncontextmenu={(e) => handleChoiceContextMenu(e, i)}
                >
                    <span
                        class={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold select-none transition-all duration-200",
                            selected
                                ? "bg-primary-foreground text-background"
                                : "bg-surface-container text-muted-foreground/80",
                            correct && "bg-correct text-on-correct",
                            incorrect && "bg-destructive text-destructive-foreground",
                            feedbackActive &&
                                feedback?.result === true &&
                                "bg-correct text-on-correct",
                            feedbackActive &&
                                feedback?.result === false &&
                                "bg-destructive text-destructive-foreground",
                            struck && "opacity-30 bg-muted/80 text-muted-foreground/60 scale-95"
                        )}
                    >
                        {CHOICE_LABELS[i] ?? String(i + 1)}
                    </span>
                    <LaTeX class="min-w-0 flex-1">${choice}$</LaTeX>
                    
                    <!-- Interactive strike-through line that animates from left to right -->
                    <div
                        class={cn(
                            "absolute left-[46px] right-[44px] top-[calc(50%-1px)] z-5 h-[1.5px] bg-muted-foreground/35 -translate-y-1/2 pointer-events-none transition-transform duration-300 ease-out origin-left scale-x-0",
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
                        "absolute top-1/2 right-1.5 z-10 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md transition-all focus-visible:opacity-100 disabled:pointer-events-none [@media(hover:none)]:opacity-100",
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
    {#if hasOutcome}
        <div class="mt-2 flex flex-wrap items-center gap-2">
            <StatusTag
                size="sm"
                status={isCorrect ? "correct" : "incorrect"}
            />
            {#if !isCorrect}
                <HiddenText bind:blocked={answerBlocked}>
                    <span class="text-sm text-muted-foreground">
                        Correct answer highlighted above
                    </span>
                </HiddenText>
            {/if}
        </div>
    {/if}
{:else if responseMode === "long-text"}
    <textarea
        bind:value={answer}
        {disabled}
        rows={8}
        placeholder="Write your proof…"
        aria-label="Proof response"
        class="min-h-44 w-full resize-y rounded-lg border border-input bg-transparent p-3 font-mono text-sm leading-6 text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-input/30"
    ></textarea>
    <p class="text-xs text-muted-foreground">
        Proofs are saved as submitted work and are not graded yet.
    </p>
{:else}
    <div
        class={cn(
            "w-full rounded-md relative",
            feedback?.target === "input" &&
                feedback.result === true &&
                "ring-3 ring-correct/40",
            feedback?.target === "input" &&
                feedback.result === false &&
                "animate-answer-shake ring-3 ring-destructive/40",
            feedback?.target === "input" &&
                feedback.result === null &&
                "ring-3 ring-unsure/40",
            hasOutcome && isCorrect && "ring-3 ring-correct/40",
            hasOutcome && !isCorrect && "ring-3 ring-destructive/40",
        )}
    >
        {#if showViewMode}
            <button
                type="button"
                {disabled}
                onclick={startEditing}
                onfocus={startEditing}
                class={cn(
                    "dark:bg-input/30 border-input h-9 rounded-md border bg-transparent px-2.5 py-1 text-base shadow-xs w-full min-w-0 text-center flex items-center justify-center cursor-pointer transition-all hover:bg-muted/10 md:text-sm text-foreground",
                    hasOutcome && isCorrect && "border-correct bg-correct/10",
                    hasOutcome && !isCorrect && "border-destructive bg-destructive/10",
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
                    "text-center",
                    hasOutcome &&
                        isCorrect &&
                        "border-correct bg-correct/10 focus-visible:border-correct focus-visible:ring-correct/50",
                    hasOutcome &&
                        !isCorrect &&
                        "border-destructive bg-destructive/10 focus-visible:border-destructive focus-visible:ring-destructive/50",
                )}
            />
        {/if}
    </div>
    {#if hasOutcome}
        <div class="mt-2 flex flex-wrap items-center gap-2">
            <StatusTag
                size="sm"
                status={isCorrect ? "correct" : "incorrect"}
            />
            {#if !isCorrect}
                <HiddenText bind:blocked={answerBlocked}>
                    <span class="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <span>Correct answer:</span>
                        <span
                            class="rounded border border-border bg-surface-container px-1.5 py-0.5 font-mono font-semibold text-foreground"
                        >
                            <LaTeX class="inline-block"
                                >${normalizedChoices[answerIndex as number]}$</LaTeX
                            >
                        </span>
                    </span>
                </HiddenText>
            {/if}
        </div>
    {/if}
{/if}
