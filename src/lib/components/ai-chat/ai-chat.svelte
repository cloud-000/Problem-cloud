<script lang="ts" module>
    import type { Snippet } from "svelte";
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
        class: className,
    }: AIChatProps = $props();
</script>

<div
    data-slot="ai-chat"
    class={cn("flex h-full min-h-0 flex-col bg-background", className)}
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
        />
    {/if}
    <AIChatComposer {controller} {placeholder} {assistantLabel} />
    <div class="sr-only" aria-live="polite">
        {controller.liveAnnouncement}
    </div>
</div>
