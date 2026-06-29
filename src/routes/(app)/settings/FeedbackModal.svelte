<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { modal } from "$lib/state/modal.svelte";
    import { toasts } from "$lib/state/toast.svelte";
    import type { Database } from "$lib/types/database.types";
    import type { GeneralFeedbackType } from "$lib/admin";
    import { cn } from "$lib/utils";
    import type { SupabaseClient, User } from "@supabase/supabase-js";

    let {
        supabase,
        user,
    }: {
        supabase: SupabaseClient<Database>;
        user: User;
    } = $props();

    const categories: {
        value: GeneralFeedbackType;
        label: string;
        icon: string;
        description: string;
    }[] = [
        {
            value: "bug_report",
            label: "Bug",
            icon: "bug_report",
            description: "Something is broken or behaving unexpectedly.",
        },
        {
            value: "feature_suggestion",
            label: "Feature",
            icon: "lightbulb",
            description: "An idea or improvement you'd like to see.",
        },
        {
            value: "general",
            label: "General",
            icon: "chat",
            description: "Any other comment or feedback.",
        },
    ];

    let category = $state<GeneralFeedbackType>("bug_report");
    let message = $state("");
    let submitting = $state(false);

    async function handleSubmit(e: SubmitEvent) {
        e.preventDefault();
        if (!message.trim()) {
            toasts.error("Please write a message before submitting.");
            return;
        }
        submitting = true;
        const { error } = await supabase
            .from("user_submitted_feedback")
            .insert({
                user_id: user.id,
                type: category,
                message: message.trim(),
                problem_id: null,
            });
        submitting = false;
        if (error) {
            toasts.error("Couldn't submit — please try again.");
            return;
        }
        toasts.success("Thanks — your feedback has been sent.");
        modal.close();
    }

    let activeCategory = $derived(
        categories.find((c) => c.value === category) ?? categories[0],
    );
</script>

<form onsubmit={handleSubmit} class="space-y-4">
    <p class="text-xs text-muted-foreground">
        Spotted a bug or have an idea? Let us know — it goes straight to the
        team for review.
    </p>

    <fieldset class="space-y-2">
        <legend class="mb-1.5 text-xs font-medium text-muted-foreground">
            Category
        </legend>
        <div class="grid grid-cols-3 gap-2">
            {#each categories as option (option.value)}
                {@const isActive = category === option.value}
                <button
                    type="button"
                    aria-pressed={isActive}
                    onclick={() => (category = option.value)}
                    class={cn(
                        "flex flex-col items-center justify-center gap-1 rounded-lg border p-3 text-sm font-medium transition-colors outline-none select-none cursor-pointer",
                        isActive
                            ? "border-primary bg-primary/10 text-foreground font-semibold"
                            : "border-border/60 bg-surface-container-low text-muted-foreground hover:bg-surface-container",
                    )}
                >
                    <Icon name={option.icon} fontsize="1.3rem" />
                    {option.label}
                </button>
            {/each}
        </div>
        <p class="text-[11px] text-muted-foreground">
            {activeCategory.description}
        </p>
    </fieldset>

    <div class="space-y-1">
        <label for="feedback-message" class="text-xs font-medium text-muted-foreground">
            Message
        </label>
        <textarea
            id="feedback-message"
            bind:value={message}
            rows={5}
            disabled={submitting}
            placeholder="Describe it in as much detail as you like…"
            class="w-full resize-y rounded-lg border border-border/60 bg-surface-container-low p-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none disabled:opacity-50"
        ></textarea>
    </div>

    <div class="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onclick={() => modal.close()}>
            Cancel
        </Button>
        <Button type="submit" disabled={!message.trim() || submitting}>
            {#if submitting}
                <Icon name="progress_activity" class="animate-spin" fontsize="1.1rem" />
                Sending…
            {:else}
                <Icon name="send" fontsize="1.1rem" />
                Send feedback
            {/if}
        </Button>
    </div>
</form>
