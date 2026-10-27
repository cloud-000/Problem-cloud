<script lang="ts" module>
    import type { AIChatQuickAction } from "#lib/components/ai-chat/index.js";

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
        /** Space used by context, offers, and the composer, excluding the transcript. */
        chromeHeight?: number;
        class?: string;
        /** Problem statement collapse state in the trainer. */
        statementCollapsed?: boolean;
        onToggleStatement?: () => void;
        onClose?: () => void;
    }
</script>

<script lang="ts">
    import { onMount } from "svelte";
    import { MediaQuery } from "svelte/reactivity";
    import {
        AIChatComposer,
        AIChatEmptyState,
        AIChatMessageList,
        AIChatQuickActions,
    } from "#lib/components/ai-chat/index.js";
    import { Button } from "#lib/components/button/index.js";
    import { Icon } from "#lib/components/icon/index.js";
    import { coach } from "#lib/state/coach.svelte.js";
    import { cn } from "#lib/utils.js";
    import CoachConnectionGate from "./coach-connection-gate.svelte";
    import CoachContextTray from "./coach-context-tray.svelte";
    import CoachConversationList from "./coach-conversation-list.svelte";
    import CoachDebugToggle from "./coach-debug-toggle.svelte";
    import CoachRequestInspector from "./coach-request-inspector.svelte";
    import CoachResumePrompt from "./coach-resume-prompt.svelte";

    let {
        quickActions = [],
        compact = false,
        onQuickAction = (action) => void coach.send(action.prompt),
        composerRef = $bindable(null),
        chromeHeight = $bindable(0),
        class: className,
        statementCollapsed = false,
        onToggleStatement,
        onClose,
    }: CoachInlineProps = $props();

    // Mirrors AIChat: the composer floats over the transcript, and its measured
    // height becomes the transcript's bottom clearance. In compact mode nothing
    // floats — the composer is the last row of an auto-height box — so the
    // measurement is simply unused.
    let composerHeight = $state(0);
    let headerHeight = $state(0);
    const mobileQuery = new MediaQuery("(max-width: 767px)", false);

    $effect(() => {
        chromeHeight = compact || coach.historyViewOpen ? 0 : headerHeight + composerHeight;
    });

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
    style="--ai-chat-composer-h: {compact || coach.historyViewOpen ? 0 : composerHeight}px;"
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
        {#if !compact}
            <div class={cn(rail, "shrink-0")}><CoachContextTray /></div>
        {/if}
        <CoachConnectionGate />
    {:else}
        <div bind:clientHeight={headerHeight} class="shrink-0">
            {#if !compact}
                <!-- Inline Coach toolbar with statement toggle, new conversation, history, and exit -->
                <div class="flex h-11 shrink-0 items-center justify-between border-b border-border/40 px-3 sm:px-4 bg-surface-container/20">
                    <div class="flex items-center gap-2">
                        <div class="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                            <Icon name="auto_awesome" fontsize={15} fill />
                        </div>
                        <span class="text-xs font-semibold tracking-tight text-foreground">Coach</span>
                    </div>

                    <div class="flex items-center gap-1 [&_button]:size-8">
                        {#if onToggleStatement}
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                onclick={onToggleStatement}
                                aria-label={statementCollapsed ? "Show problem statement" : "Collapse problem statement"}
                                title={statementCollapsed ? "Show problem statement" : "Collapse problem statement"}
                            >
                                <Icon name={statementCollapsed ? "visibility" : "visibility_off"} fontsize={16} />
                            </Button>
                        {/if}

                        <Button
                            variant="ghost"
                            size="icon-sm"
                            onclick={() => coach.newConversation()}
                            aria-label="New conversation"
                            title="New conversation"
                            disabled={coach.streaming}
                        >
                            <Icon name="add_comment" fontsize={16} />
                        </Button>

                        {#if coach.historyEnabled}
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                onclick={() => coach.historyViewOpen
                                    ? coach.closeConversationList()
                                    : coach.openConversationList()}
                                aria-label="Conversation history"
                                aria-expanded={coach.historyViewOpen}
                                class={coach.historyViewOpen ? "bg-surface-container text-foreground" : undefined}
                                title="Conversation history"
                            >
                                <Icon name="history" fontsize={16} />
                            </Button>
                        {/if}

                        {#if onClose}
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                onclick={onClose}
                                aria-label="Return to answer mode"
                                title="Return to answer mode"
                            >
                                <Icon name="close" fontsize={16} />
                            </Button>
                        {/if}
                    </div>
                </div>

                <div class={cn(rail, "shrink-0")}>
                    {#if !mobileQuery.current}
                        <CoachContextTray />
                    {/if}
                    <CoachDebugToggle />
                    <CoachRequestInspector />
                </div>
            {/if}
            {#if coach.resumePrompt}
                <!-- Above the transcript, not over it: the choice is which thread to attach
                     to, and the blank Coach behind it is already usable. -->
                <div class={cn(rail, "shrink-0 px-3 pb-1 sm:px-4")}>
                    <CoachResumePrompt />
                </div>
            {/if}
        </div>

        {#if !compact && coach.historyViewOpen}
            <!-- Replaces transcript and composer in trainer inline view when history is open -->
            <div class={cn("min-h-0 flex-1 overflow-hidden", rail)}>
                <CoachConversationList class="h-full min-h-0" />
            </div>
        {:else if !compact && coach.messages.length === 0}
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

        {#if !coach.historyViewOpen}
            <!-- Floating over the transcript when there is one; the box's own last row
                 when there is not. `absolute` would collapse the compact section to
                 nothing, since an out-of-flow child contributes no height. -->
            <div
                bind:clientHeight={composerHeight}
                class={cn(
                    "z-10 mx-auto w-full max-w-[52rem]",
                    compact
                        ? "shrink-0"
                        : "pointer-events-none absolute inset-x-0 bottom-0 bg-background md:bg-transparent",
                    mobileQuery.current && "pb-[calc(0.25rem+var(--safe-area-bottom))]",
                )}
            >
                {#if !mobileQuery.current || coach.messages.length === 0}
                    <AIChatQuickActions
                        actions={quickActions}
                        layout="row"
                        disabled={coach.streaming}
                        class={cn(
                            "pointer-events-auto px-3 sm:px-4",
                            compact ? "pb-0 pt-1" : "pb-1 pt-2",
                        )}
                        onselect={(action) => onQuickAction(action)}
                    />
                {/if}
                <AIChatComposer
                    controller={coach}
                    assistantLabel="Coach"
                    placeholder={mobileQuery.current ? "Ask Coach…" : "Ask Coach about this problem…"}
                    compact={compact || mobileQuery.current}
                    bind:textareaRef={composerRef}
                />
            </div>
        {/if}
        <div class="sr-only" aria-live="polite">
            {coach.liveAnnouncement}
        </div>
    {/if}
</section>
