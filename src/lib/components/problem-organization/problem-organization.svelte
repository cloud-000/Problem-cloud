<script lang="ts">
    import { page } from "$app/state";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import {
        ENGAGEMENT_LABELS,
        MASTERY_LABELS,
        setProblemEngagement,
        setProblemMastery,
        type Engagement,
        type Mastery,
        type PersonalProblemState,
    } from "$lib/progress";
    import { toasts } from "$lib/state/toast.svelte";
    import type { Database } from "$lib/types/database.types";
    import { cn } from "$lib/utils";
    import type { SupabaseClient } from "@supabase/supabase-js";

    let {
        problemId,
        mastery = null,
        engagement = null,
        prompt = false,
        onchange,
        class: className,
    }: {
        problemId: number;
        mastery?: Mastery | null;
        engagement?: Engagement | null;
        prompt?: boolean;
        onchange?: (state: PersonalProblemState) => void;
        class?: string;
    } = $props();

    const masteryChoices: { value: Mastery; label: string }[] = [
        { value: "needs_work", label: "Needs work" },
        { value: "learning", label: "Learning" },
        { value: "confident", label: "Confident" },
    ];
    const engagementChoices: { value: Engagement; label: string; icon: string }[] = [
        { value: "working", label: "Working on", icon: "construction" },
        { value: "revisit", label: "Revisit", icon: "replay" },
        { value: "later", label: "Later", icon: "schedule" },
        { value: "ignored", label: "Ignored", icon: "visibility_off" },
    ];

    let localMastery = $derived<Mastery | null>(mastery);
    let localEngagement = $derived<Engagement | null>(engagement);
    let saving = $state<"mastery" | "engagement" | null>(null);

    let supabase = $derived(
        page.data.supabase as SupabaseClient<Database> | undefined,
    );
    let canEdit = $derived(Boolean(page.data.user && supabase));

    function emit() {
        onchange?.({ problem_id: problemId, mastery: localMastery, engagement: localEngagement });
    }

    async function chooseMastery(value: Mastery | null) {
        if (!supabase || !canEdit || saving) return;
        const previous = localMastery;
        localMastery = value;
        saving = "mastery";
        emit();
        try {
            const state = await setProblemMastery(supabase, problemId, value);
            localMastery = state.mastery;
            localEngagement = state.engagement;
            emit();
        } catch (error) {
            localMastery = previous;
            emit();
            toasts.error((error as Error).message || "Failed to update mastery");
        } finally {
            saving = null;
        }
    }

    async function chooseEngagement(value: Engagement | null) {
        if (!supabase || !canEdit || saving) return;
        const previous = localEngagement;
        localEngagement = value;
        saving = "engagement";
        emit();
        try {
            const state = await setProblemEngagement(supabase, problemId, value);
            localMastery = state.mastery;
            localEngagement = state.engagement;
            emit();
        } catch (error) {
            localEngagement = previous;
            emit();
            toasts.error((error as Error).message || "Failed to update plan");
        } finally {
            saving = null;
        }
    }

    function masteryClass(value: Mastery | null) {
        if (value === "confident") return "border-correct/25 bg-correct/10 text-correct";
        if (value === "learning") return "border-unsure/25 bg-unsure/10 text-unsure";
        if (value === "needs_work") return "border-destructive/25 bg-destructive/10 text-destructive";
        return "border-border/60 bg-surface-container text-muted-foreground";
    }
</script>

{#if canEdit}
    <div class={cn("flex flex-wrap items-center gap-1.5", className)}>
        {#if prompt && !localMastery}
            <div class="flex w-full flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 p-2.5">
                <span class="mr-auto text-xs font-medium">How well do you know this?</span>
                {#each masteryChoices as choice (choice.value)}
                    <Button variant="outline" size="sm" disabled={saving != null} onclick={() => chooseMastery(choice.value)}>
                        {choice.label}
                    </Button>
                {/each}
            </div>
        {:else}
            <span class={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", masteryClass(localMastery))}>
                {localMastery ? MASTERY_LABELS[localMastery] : "Unassessed"}
            </span>
            {#if localEngagement}
                <span class="inline-flex items-center gap-1 rounded-full border border-border/60 bg-surface-container px-2 py-0.5 text-xs text-muted-foreground">
                    <Icon name={engagementChoices.find((item) => item.value === localEngagement)?.icon ?? "bookmark"} fontsize="0.85rem" />
                    {ENGAGEMENT_LABELS[localEngagement]}
                </span>
            {/if}
            <details class="group/organize relative">
                <summary class="flex size-7 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-surface-container hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-label="Set mastery and plan">
                    <Icon name={saving ? "progress_activity" : "tune"} class={saving ? "animate-spin" : undefined} />
                </summary>
                <div class="absolute right-0 z-40 mt-1 w-64 space-y-3 rounded-lg border border-border/70 bg-popover p-3 text-popover-foreground shadow-lg">
                    <fieldset class="space-y-1.5" disabled={saving != null}>
                        <legend class="text-xs font-semibold text-muted-foreground">Mastery</legend>
                        <div class="grid grid-cols-2 gap-1">
                            <button type="button" class={cn("rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-container", !localMastery && "bg-surface-container font-medium")} onclick={() => chooseMastery(null)}>Unassessed</button>
                            {#each masteryChoices as choice (choice.value)}
                                <button type="button" class={cn("rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-container", localMastery === choice.value && "bg-surface-container font-medium")} onclick={() => chooseMastery(choice.value)}>{choice.label}</button>
                            {/each}
                        </div>
                    </fieldset>
                    <fieldset class="space-y-1.5" disabled={saving != null}>
                        <legend class="text-xs font-semibold text-muted-foreground">Plan</legend>
                        <div class="grid grid-cols-2 gap-1">
                            <button type="button" class={cn("rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-container", !localEngagement && "bg-surface-container font-medium")} onclick={() => chooseEngagement(null)}>No plan</button>
                            {#each engagementChoices as choice (choice.value)}
                                <button type="button" class={cn("flex items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-container", localEngagement === choice.value && "bg-surface-container font-medium")} onclick={() => chooseEngagement(choice.value)}>
                                    <Icon name={choice.icon} fontsize="0.85rem" /> {choice.label}
                                </button>
                            {/each}
                        </div>
                    </fieldset>
                </div>
            </details>
        {/if}
    </div>
{/if}
