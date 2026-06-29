<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { MathStatement } from "$lib/components/math-statement";
    import { modal } from "$lib/state/modal.svelte";
    import { toasts } from "$lib/state/toast.svelte";
    import type { Database } from "$lib/types/database.types";
    import { cn } from "$lib/utils";
    import type { SupabaseClient, User } from "@supabase/supabase-js";

    let {
        supabase,
        user,
        problemId,
        choices,
    }: {
        supabase: SupabaseClient<Database>;
        user: User;
        problemId: number;
        choices: string[];
    } = $props();

    let selectedIndex = $state<number | null>(null);
    let steps = $state("");
    let submitting = $state(false);

    async function handleSubmit(e: SubmitEvent) {
        e.preventDefault();
        if (selectedIndex == null) {
            toasts.error("Pick which choice is the correct answer.");
            return;
        }
        submitting = true;
        const { error } = await supabase.from("user_submitted_feedback").insert({
            user_id: user.id,
            problem_id: problemId,
            type: "answer_suggestion",
            answer_index: selectedIndex,
            steps: steps.trim() || null,
        });
        submitting = false;
        if (error) {
            toasts.error("Couldn't submit — please try again.");
            return;
        }
        toasts.success("Thanks — submitted for review.");
        modal.close();
    }
</script>

<form onsubmit={handleSubmit} class="space-y-4">
    <p class="text-xs text-muted-foreground">
        This problem has no recorded answer. Pick the choice you believe is
        correct and optionally share your steps — it'll be sent in for review.
    </p>

    <fieldset class="space-y-1.5">
        <legend class="mb-1.5 text-xs font-medium text-muted-foreground">
            Correct answer
        </legend>
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
                <MathStatement
                    text={choice}
                    class="min-w-0 text-sm text-foreground"
                />
            </button>
        {/each}
    </fieldset>

    <div class="space-y-1">
        <label for="steps" class="text-xs font-medium text-muted-foreground">
            Steps (optional)
        </label>
        <textarea
            id="steps"
            bind:value={steps}
            rows={4}
            placeholder="Outline how you got the answer…"
            class="w-full resize-y rounded-lg border border-border/60 bg-surface-container-low p-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none"
        ></textarea>
    </div>

    <div class="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onclick={() => modal.close()}>
            Cancel
        </Button>
        <Button type="submit" disabled={selectedIndex == null || submitting}>
            Submit
        </Button>
    </div>
</form>
