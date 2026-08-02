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
        promptPresentation = "transient",
        suggestedMastery = null,
        onchange,
        class: className,
    }: {
        problemId: number;
        mastery?: Mastery | null;
        engagement?: Engagement | null;
        prompt?: boolean;
        /** Keep the prompt visible after a choice instead of switching to the compact editor. */
        promptPresentation?: "persistent" | "transient";
        /** Optional recommendation to emphasize without saving it for the user. */
        suggestedMastery?: Mastery | null;
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
    const familiarityLabelId = $props.id();
    let showPrompt = $derived(
        promptPresentation === "persistent" || (prompt && !localMastery),
    );

    let supabase = $derived(
        page.data.supabase as SupabaseClient<Database> | undefined,
    );
    let canEdit = $derived(Boolean(page.data.user && supabase));

    function emit(resolvedProblemId = problemId) {
        onchange?.({
            problem_id: resolvedProblemId,
            mastery: localMastery,
            engagement: localEngagement,
        });
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
            onchange?.(state);
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
            onchange?.(state);
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

{#snippet planOptions()}
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
{/snippet}

{#if canEdit}
    <div
        class={cn(
            "flex min-h-10 flex-wrap items-center gap-1.5",
            showPrompt && "w-full",
            className,
        )}
    >
        {#if showPrompt}
            <section
                class="flex w-full flex-col gap-1.5 border-t border-border/60 pt-3 sm:flex-row sm:items-center sm:justify-between"
                aria-labelledby={familiarityLabelId}
            >
                <div class="flex items-center gap-1">
                    <p id={familiarityLabelId} class="type-caption text-muted-foreground">
                        How familiar?
                    </p>
                    {#if promptPresentation === "persistent"}
                        <details class="group/organize relative">
                            <summary class="flex size-10 cursor-pointer list-none items-center justify-center rounded-full text-muted-foreground hover:bg-surface-container hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-label="Set future plan" title="Set future plan">
                                <Icon name="tune" />
                            </summary>
                            <div class="absolute left-0 bottom-full z-40 mb-1 w-64 rounded-lg border border-border/70 bg-surface-container-lowest p-3 text-foreground shadow-lg">
                                {@render planOptions()}
                            </div>
                        </details>
                    {/if}
                </div>
                <div class="isolate grid h-8 w-full grid-cols-3 overflow-hidden rounded-full border border-border/60 bg-surface-container sm:w-[23rem]">
                    {#each masteryChoices as choice (choice.value)}
                        <Button
                            variant={choice.value === localMastery
                                ? "primary"
                                : "ghost"}
                            size="sm"
                            class={cn(
                                "h-8 w-full rounded-none border-0 px-1.5 text-xs shadow-none first:rounded-l-full last:rounded-r-full hover:shadow-none",
                                !localMastery &&
                                    choice.value === suggestedMastery &&
                                    "bg-surface-container-high text-foreground",
                            )}
                            disabled={saving != null}
                            aria-pressed={localMastery === choice.value}
                            aria-label={choice.value === suggestedMastery
                                ? `${choice.label}${localMastery ? "" : " (recommended)"}`
                                : choice.label}
                            onclick={() => chooseMastery(choice.value)}
                        >
                            {choice.label}
                        </Button>
                    {/each}
                </div>
            </section>
        {:else}
            <details class="group/organize relative">
                <summary class="flex size-7 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-surface-container hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-label="Set mastery and plan">
                    <Icon name="tune" />
                </summary>
                <div class="absolute left-0 bottom-full z-40 mb-1 w-64 space-y-3 rounded-lg border border-border/70 bg-surface-container-lowest p-3 text-foreground shadow-lg">
                    <fieldset class="space-y-1.5" disabled={saving != null}>
                        <legend class="text-xs font-semibold text-muted-foreground">Mastery</legend>
                        <div class="grid grid-cols-2 gap-1">
                            <button type="button" class={cn("rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-container", !localMastery && "bg-surface-container font-medium")} onclick={() => chooseMastery(null)}>Unassessed</button>
                            {#each masteryChoices as choice (choice.value)}
                                <button type="button" class={cn("rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-container", localMastery === choice.value && "bg-surface-container font-medium")} onclick={() => chooseMastery(choice.value)}>{choice.label}</button>
                            {/each}
                        </div>
                    </fieldset>
                    {@render planOptions()}
                </div>
            </details>
            <span class={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", masteryClass(localMastery))}>
                {localMastery ? MASTERY_LABELS[localMastery] : "Unassessed"}
            </span>
            {#if localEngagement}
                <span class="inline-flex items-center gap-1 rounded-full border border-border/60 bg-surface-container px-2 py-0.5 text-xs text-muted-foreground">
                    <Icon name={engagementChoices.find((item) => item.value === localEngagement)?.icon ?? "bookmark"} fontsize="0.85rem" />
                    {ENGAGEMENT_LABELS[localEngagement]}
                </span>
            {/if}
        {/if}
    </div>
{/if}
