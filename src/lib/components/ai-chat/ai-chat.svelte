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
        /** The composer's textarea, for surfaces that focus it (the Coach chord). */
        composerRef?: HTMLTextAreaElement | null;
        class?: string;
        /** Class for the transcript's scroll container (e.g. `scrollbar-gutter`). */
        transcriptClass?: string;
        /**
         * Class for the measured rail *inside* the scroll container. A wide surface
         * constrains message width here rather than on the root, so the scrollbar
         * stays on the chat's outer edge instead of floating mid-page.
         */
        contentClass?: string;
        /** Class for the floating composer's wrapper, so it can share that rail. */
        composerClass?: string;
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
        composerRef = $bindable(null),
        class: className,
        transcriptClass,
        contentClass,
        composerClass,
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
            class={transcriptClass}
            {contentClass}
        />
    {/if}
    <div
        bind:clientHeight={composerHeight}
        class={cn("pointer-events-none absolute inset-x-0 bottom-0 z-10", composerClass)}
    >
        <AIChatComposer {controller} {placeholder} {assistantLabel} bind:textareaRef={composerRef} />
    </div>
    <div class="sr-only" aria-live="polite">
        {controller.liveAnnouncement}
    </div>
</div>
