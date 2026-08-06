<script lang="ts" module>
    import type { AIChatQuickAction } from "$lib/components/ai-chat";

    export interface CoachInlineProps {
        quickActions?: readonly AIChatQuickAction[];
        composerRef?: HTMLTextAreaElement | null;
        class?: string;
    }
</script>

<script lang="ts">
    import { onMount } from "svelte";
    import {
        AIChatComposer,
        AIChatEmptyState,
        AIChatMessageList,
        AIChatQuickActions,
    } from "$lib/components/ai-chat";
    import type { NormalizedAIMessage } from "$lib/ai/types";
    import { coach } from "$lib/state/coach.svelte";
    import { settings } from "$lib/state/settings.svelte";
    import { cn } from "$lib/utils";
    import CoachConnectionGate from "./coach-connection-gate.svelte";
    import CoachContextTray from "./coach-context-tray.svelte";
    import CoachDebugToggle from "./coach-debug-toggle.svelte";
    import CoachSystemRow from "./coach-system-row.svelte";
    import CoachResumePrompt from "./coach-resume-prompt.svelte";

    let {
        quickActions = [],
        composerRef = $bindable(null),
        class: className,
    }: CoachInlineProps = $props();

    // Mirrors AIChat: the composer floats over the transcript, and its measured
    // height becomes the transcript's bottom clearance.
    let composerHeight = $state(0);

    // The section runs full-bleed so the transcript's scrollbar sits on the
    // trainer's outer edge (aligned with the statement shelf above); the
    // readable column is a rail *inside* each row instead.
    const rail = "mx-auto w-full max-w-[52rem]";

    let showSystem = $derived(settings.debugMode && settings.showSystemPrompts);

    onMount(() => {
        void coach.initialize();
    });
</script>

<section
    data-slot="coach-inline"
    class={cn(
        "relative flex h-full min-h-0 flex-col bg-transparent",
        className,
    )}
    style="--ai-chat-composer-h: {composerHeight}px;"
    aria-label="Coach mode"
>
    {#if coach.loading && !coach.initialized}
        <div
            class="flex flex-1 items-center justify-center text-xs text-muted-foreground"
            aria-live="polite"
        >
            Loading Coach…
        </div>
    {:else if !coach.bootstrap || coach.connectionBlocked}
        <div class={cn(rail, "shrink-0")}><CoachContextTray /></div>
        <CoachConnectionGate />
    {:else}
        <div class={cn(rail, "shrink-0")}>
            <CoachContextTray />
            <CoachDebugToggle />
        </div>
        {#if coach.resumePrompt}
            <!-- Above the transcript, not over it: the choice is which thread to attach
                 to, and the blank Coach behind it is already usable. -->
            <div class={cn(rail, "shrink-0 px-3 pb-1 sm:px-4")}>
                <CoachResumePrompt />
            </div>
        {/if}
        {#if showSystem && coach.messages.length === 0}
            <!-- No turns to interleave with yet, and messages[0] is exactly what you
                 want to read before asking the first question. -->
            <div class={cn(rail, "min-h-0 shrink overflow-y-auto px-3 sm:px-4")}>
                <CoachSystemRow />
            </div>
        {/if}
        {#if coach.messages.length === 0}
            <AIChatEmptyState
                controller={coach}
                title="Work through this problem"
                description="Ask for a small hint, check an approach, or talk through the ideas without leaving the problem."
                quickActions={[]}
            />
        {:else}
            <AIChatMessageList
                controller={coach}
                assistantLabel="Coach"
                conversationLabel="Coach conversation"
                class="[scrollbar-gutter:stable_both-edges]"
                contentClass={rail}
                leading={showSystem ? systemMessage : undefined}
                messageBefore={showSystem ? turnContext : undefined}
            />
        {/if}
        <div
            bind:clientHeight={composerHeight}
            class="pointer-events-none absolute inset-x-0 bottom-0 z-10 mx-auto max-w-[52rem]"
        >
            <AIChatQuickActions
                actions={quickActions}
                layout="row"
                disabled={coach.streaming}
                class="pointer-events-auto px-3 pb-1 pt-2 sm:px-4"
                onselect={(action) => coach.send(action.prompt)}
            />
            <AIChatComposer
                controller={coach}
                assistantLabel="Coach"
                placeholder="Ask Coach about this problem…"
                bind:textareaRef={composerRef}
            />
        </div>
        <div class="sr-only" aria-live="polite">
            {coach.liveAnnouncement}
        </div>
    {/if}
</section>

<!-- Interleaved at the positions they occupy in the request: the system message is
     always messages[0], and a past turn's facts are prefixed into that turn's own user
     message rather than sent as a second system message. -->
{#snippet systemMessage()}
    <CoachSystemRow />
{/snippet}

{#snippet turnContext(message: NormalizedAIMessage)}
    {#if message.role === "user"}
        <CoachSystemRow messageId={message.id} />
    {/if}
{/snippet}
