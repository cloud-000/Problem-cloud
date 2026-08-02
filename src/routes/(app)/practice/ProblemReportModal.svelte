<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
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
    let selectedIndex = $state<number | null>(null);
    let message = $state("");
    let submitting = $state(false);
    let canSubmit = $derived(selectedIndex != null || message.trim().length > 0);

    async function handleSubmit(e: SubmitEvent) {
        e.preventDefault();
        if (!canSubmit || submitting) return;

        submitting = true;
        try {
            await submitProblemReport(supabase, user.id, {
                problemId,
                answerIndex: selectedIndex,
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
        incorrect, you can also suggest the correct choice.
    </p>

    {#if choices.length > 0}
        <fieldset class="space-y-1.5">
            <legend class="mb-1.5 text-xs font-medium text-muted-foreground">
                Suggested answer (optional)
            </legend>
            <button
                type="button"
                aria-pressed={selectedIndex == null}
                onclick={() => (selectedIndex = null)}
                class={cn(
                    "flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition-colors",
                    selectedIndex == null
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border/60 bg-surface-container-low text-muted-foreground hover:bg-surface-container",
                )}
            >
                <span
                    class={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border",
                        selectedIndex == null
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border",
                    )}
                >
                    {#if selectedIndex == null}
                        <Icon name="check" fontsize="0.85em" />
                    {/if}
                </span>
                No answer suggestion
            </button>
            {#each choices as choice, i (i)}
                <button
                    type="button"
                    aria-pressed={selectedIndex === i}
                    onclick={() => (selectedIndex = i)}
                    class={cn(
                        "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                        selectedIndex === i
                            ? "border-primary bg-primary/10"
                            : "border-border/60 bg-surface-container-low hover:bg-surface-container",
                    )}
                >
                    <span
                        class={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                            selectedIndex === i
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border text-muted-foreground",
                        )}
                    >
                        {#if selectedIndex === i}
                            <Icon name="check" fontsize="0.85em" />
                        {:else}
                            {String.fromCharCode(65 + i)}
                        {/if}
                    </span>
                    <MathStatement text={choice} class="min-w-0 text-sm text-foreground" />
                </button>
            {/each}
            {#if emphasizeAnswer}
                <p class="text-[11px] text-muted-foreground">
                    This problem currently has no recorded answer.
                </p>
            {/if}
        </fieldset>
    {/if}

    <div class="space-y-1">
        <label for={`${uid}-message`} class="text-xs font-medium text-muted-foreground">
            Message {selectedIndex == null ? "" : "(optional)"}
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
