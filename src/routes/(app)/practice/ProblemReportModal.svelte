<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Input } from "$lib/components/input";
    import { MathStatement } from "$lib/components/math-statement";
    import { submitProblemReport } from "$lib/feedback";
    import { modal } from "$lib/state/modal.svelte";
    import { toasts } from "$lib/state/toast.svelte";
    import type { Database } from "$lib/types/database.types";
    import { cn } from "$lib/utils";
    import type { SupabaseClient, User } from "@supabase/supabase-js";

    interface Props {
        supabase: SupabaseClient<Database>;
        user: User;
        problemId: number;
        choices: string[];
        emphasizeAnswer?: boolean;
    }

    let {
        supabase,
        user,
        problemId,
        choices,
        emphasizeAnswer = false,
    }: Props = $props();

    const uid = $props.id();
    let answerSelection = $state<number | "custom" | null>(null);
    let answerText = $state("");
    let message = $state("");
    let submitting = $state(false);
    let selectedIndex = $derived(
        typeof answerSelection === "number" ? answerSelection : null,
    );
    let customAnswer = $derived(
        answerSelection === "custom" ? answerText.trim() : "",
    );
    let canSubmit = $derived(
        selectedIndex != null || customAnswer.length > 0 || message.trim().length > 0,
    );

    async function handleSubmit(e: SubmitEvent) {
        e.preventDefault();
        if (!canSubmit || submitting) return;

        submitting = true;
        try {
            await submitProblemReport(supabase, user.id, {
                problemId,
                answerIndex: selectedIndex,
                answerText: customAnswer,
                message,
            });
            toasts.success("Thanks — your report was sent for review.");
            modal.close();
        } catch (error) {
            toasts.error(
                error instanceof Error && error.message
                    ? error.message
                    : "Couldn't submit — please try again.",
            );
        } finally {
            submitting = false;
        }
    }
</script>

<form onsubmit={handleSubmit} class="space-y-4">
    <p class="text-xs text-muted-foreground">
        Report anything wrong with this problem. If its answer is missing or
        incorrect, you can also suggest the correct answer.
    </p>

    <fieldset class="space-y-1.5">
        <legend class="mb-1.5 text-xs font-medium text-muted-foreground">
            Suggested answer (optional)
        </legend>
        <button
            type="button"
            aria-pressed={answerSelection == null}
            onclick={() => (answerSelection = null)}
            class={cn(
                "flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition-colors",
                answerSelection == null
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border/60 bg-surface-container-low text-muted-foreground hover:bg-surface-container",
            )}
        >
            <span
                class={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border",
                    answerSelection == null
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border",
                )}
            >
                {#if answerSelection == null}
                    <Icon name="check" fontsize="0.85em" />
                {/if}
            </span>
            No answer suggestion
        </button>
        {#each choices as choice, i (i)}
            <button
                type="button"
                aria-pressed={answerSelection === i}
                onclick={() => (answerSelection = i)}
                class={cn(
                    "flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition-colors",
                    answerSelection === i
                        ? "border-primary bg-primary/10"
                        : "border-border/60 bg-surface-container-low hover:bg-surface-container",
                )}
            >
                <span
                    class={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                        answerSelection === i
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-muted-foreground",
                    )}
                >
                    {#if answerSelection === i}
                        <Icon name="check" fontsize="0.85em" />
                    {:else}
                        {String.fromCharCode(65 + i)}
                    {/if}
                </span>
                <MathStatement text={choice} class="min-w-0 text-sm text-foreground" />
            </button>
        {/each}
        <label
            for={`${uid}-answer-text`}
            class={cn(
                "flex w-full cursor-text items-center gap-3 rounded-lg border p-3 text-left text-sm transition-[color,background-color,border-color,box-shadow] focus-within:ring-2 focus-within:ring-primary/20",
                answerSelection === "custom"
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border/60 bg-surface-container-low text-muted-foreground hover:bg-surface-container",
            )}
        >
            <span
                class={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border",
                    answerSelection === "custom"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border",
                )}
            >
                {#if answerSelection === "custom"}
                    <Icon name="check" fontsize="0.85em" />
                {/if}
            </span>
            <Input
                id={`${uid}-answer-text`}
                bind:value={answerText}
                disabled={submitting}
                onfocus={() => (answerSelection = "custom")}
                aria-label="Proposed custom answer"
                placeholder="Custom answer…"
                autocomplete="off"
                class="h-7 border-0 bg-transparent px-0 py-0 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
            />
        </label>
        {#if emphasizeAnswer}
            <p class="text-[11px] text-muted-foreground">
                This problem currently has no recorded answer.
            </p>
        {/if}
    </fieldset>

    <div class="space-y-1">
        <label for={`${uid}-message`} class="text-xs font-medium text-muted-foreground">
            Message {selectedIndex == null && customAnswer.length === 0 ? "" : "(optional)"}
        </label>
        <textarea
            id={`${uid}-message`}
            bind:value={message}
            rows={4}
            disabled={submitting}
            placeholder="Explain what looks wrong or add supporting steps…"
            class="w-full resize-y rounded-lg border border-border/60 bg-surface-container-low p-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none disabled:opacity-50"
        ></textarea>
    </div>

    <div class="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onclick={() => modal.close()}>
            Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit || submitting}>
            {#if submitting}
                <Icon name="progress_activity" class="animate-spin" fontsize="1.1rem" />
                Sending…
            {:else}
                <Icon name="send" fontsize="1.1rem" />
                Send report
            {/if}
        </Button>
    </div>
</form>
