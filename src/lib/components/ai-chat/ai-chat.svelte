<script lang="ts" module>
    import type { Snippet } from "svelte";
    import type { NormalizedAIMessage } from "$lib/ai/types";
    import type { AIChatController, AIChatQuickAction } from "./types";

    export interface AIChatProps {
        controller: AIChatController;
        assistantLabel?: string;
        conversationLabel?: string;
        placeholder?: string;
        emptyTitle?: string;
        emptyDescription?: string;
        emptyIcon?: string;
        quickActions?: readonly AIChatQuickAction[];
        header?: Snippet;
        leading?: Snippet;
        /** Rendered above the first turn, inside the transcript's scroll rail. */
        transcriptLeading?: Snippet;
        /** Rendered above every turn; see `AIChatMessageListProps.messageBefore`. */
        messageBefore?: Snippet<[NormalizedAIMessage]>;
        class?: string;
    }
</script>

<script lang="ts">
    import { cn } from "$lib/utils";
    import AIChatComposer from "./ai-chat-composer.svelte";
    import AIChatEmptyState from "./ai-chat-empty-state.svelte";
    import AIChatMessageList from "./ai-chat-message-list.svelte";

    let {
        controller,
        assistantLabel = "Assistant",
        conversationLabel = "AI conversation",
        placeholder = "Ask anything…",
        emptyTitle = "How can I help?",
        emptyDescription = "Start a conversation or choose one of the suggestions below.",
        emptyIcon = "auto_awesome",
        quickActions = [],
        header,
        leading,
        transcriptLeading,
        messageBefore,
        class: className,
    }: AIChatProps = $props();

    // Published to descendants as --ai-chat-composer-h so the transcript can
    // reserve exactly as much bottom clearance as the floating composer needs.
    let composerHeight = $state(0);
</script>

<div
    data-slot="ai-chat"
    class={cn("relative flex h-full min-h-0 flex-col bg-background", className)}
    style="--ai-chat-composer-h: {composerHeight}px;"
>
    {@render header?.()}
    {@render leading?.()}
    {#if controller.messages.length === 0}
        <AIChatEmptyState
            {controller}
            title={emptyTitle}
            description={emptyDescription}
            icon={emptyIcon}
            {quickActions}
        />
    {:else}
        <AIChatMessageList
            {controller}
            {assistantLabel}
            {conversationLabel}
            leading={transcriptLeading}
            {messageBefore}
        />
    {/if}
    <div
        bind:clientHeight={composerHeight}
        class="pointer-events-none absolute inset-x-0 bottom-0 z-10"
    >
        <AIChatComposer {controller} {placeholder} {assistantLabel} />
    </div>
    <div class="sr-only" aria-live="polite">
        {controller.liveAnnouncement}
    </div>
</div>
