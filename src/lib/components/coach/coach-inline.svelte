<script lang="ts" module>
    import type { AIChatQuickAction } from "$lib/components/ai-chat";

    export interface CoachInlineProps {
        quickActions?: readonly AIChatQuickAction[];
        /**
         * Render as a composer box roughly the size of the answer box it replaced,
         * with no transcript. This is what the trainer shows before the thread has
         * anything in it: entering Coach mode then costs a box-for-box swap instead
         * of collapsing the statement into a shelf to make room for an empty
         * transcript. The surface expands when the conversation earns the space.
         */
        compact?: boolean;
        /**
         * What a quick-action press *means*, for a surface whose actions carry state.
         * Defaults to sending the action's prompt, which is what a press means
         * everywhere else. The trainer overrides it because its hint chip is a rung of
         * a ladder it tracks: sending the prompt alone left the level untouched, so the
         * chip re-offered the same rung under a label promising the next one.
         */
        onQuickAction?: (action: AIChatQuickAction) => void;
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
    import { coach } from "$lib/state/coach.svelte";
    import { cn } from "$lib/utils";
    import CoachConnectionGate from "./coach-connection-gate.svelte";
    import CoachContextTray from "./coach-context-tray.svelte";
    import CoachDebugToggle from "./coach-debug-toggle.svelte";
    import CoachRequestInspector from "./coach-request-inspector.svelte";
    import CoachResumePrompt from "./coach-resume-prompt.svelte";

    let {
        quickActions = [],
        compact = false,
        onQuickAction = (action) => void coach.send(action.prompt),
        composerRef = $bindable(null),
        class: className,
    }: CoachInlineProps = $props();

    // Mirrors AIChat: the composer floats over the transcript, and its measured
    // height becomes the transcript's bottom clearance. In compact mode nothing
    // floats — the composer is the last row of an auto-height box — so the
    // measurement is simply unused.
    let composerHeight = $state(0);

    // The section runs full-bleed so the transcript's scrollbar sits on the
    // trainer's outer edge (aligned with the statement shelf above); the
    // readable column is a rail *inside* each row instead.
    const rail = "mx-auto w-full max-w-[52rem]";

    onMount(() => {
        void coach.initialize();
    });
</script>

<section
    data-slot="coach-inline"
    data-compact={compact ? "" : undefined}
    class={cn(
        "relative flex min-h-0 flex-col bg-transparent",
        compact ? "h-auto" : "h-full",
        className,
    )}
    style="--ai-chat-composer-h: {compact ? 0 : composerHeight}px;"
    aria-label="Coach mode"
>
    {#if coach.loading && !coach.initialized}
        <div
            class={cn(
                "flex items-center justify-center text-xs text-muted-foreground",
                compact ? "min-h-24" : "flex-1",
            )}
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
            <CoachRequestInspector />
        </div>
        {#if coach.resumePrompt}
            <!-- Above the transcript, not over it: the choice is which thread to attach
                 to, and the blank Coach behind it is already usable. -->
            <div class={cn(rail, "shrink-0 px-3 pb-1 sm:px-4")}>
                <CoachResumePrompt />
            </div>
        {/if}
        <!-- Compact mode renders neither transcript nor empty state: the composer
             and its hint chips already say what this box is for, and a full-height
             welcome panel is exactly the relayout compact mode exists to avoid. -->
        {#if !compact && coach.messages.length === 0}
            <AIChatEmptyState
                controller={coach}
                title="Work through this problem"
                description="Ask for a small hint, check an approach, or talk through the ideas without leaving the problem."
                quickActions={[]}
            />
        {:else if !compact}
            <AIChatMessageList
                controller={coach}
                assistantLabel="Coach"
                conversationLabel="Coach conversation"
                class="[scrollbar-gutter:stable_both-edges]"
                contentClass={rail}
            />
        {/if}
        <!-- Floating over the transcript when there is one; the box's own last row
             when there is not. `absolute` would collapse the compact section to
             nothing, since an out-of-flow child contributes no height. -->
        <div
            bind:clientHeight={composerHeight}
            class={cn(
                "z-10 mx-auto w-full max-w-[52rem]",
                compact
                    ? "shrink-0"
                    : "pointer-events-none absolute inset-x-0 bottom-0",
            )}
        >
            <AIChatQuickActions
                actions={quickActions}
                layout="row"
                disabled={coach.streaming}
                class="pointer-events-auto px-3 pb-1 pt-2 sm:px-4"
                onselect={(action) => onQuickAction(action)}
            />
            <AIChatComposer
                controller={coach}
                assistantLabel="Coach"
                placeholder="Ask Coach about this problem…"
                {compact}
                bind:textareaRef={composerRef}
            />
        </div>
        <div class="sr-only" aria-live="polite">
            {coach.liveAnnouncement}
        </div>
    {/if}
</section>
