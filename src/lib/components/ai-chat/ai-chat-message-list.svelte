<script lang="ts" module>
    import type { AIChatController } from "./types";

    export interface AIChatMessageListProps {
        controller: AIChatController;
        assistantLabel?: string;
        conversationLabel?: string;
        class?: string;
    }
</script>

<script lang="ts">
    import AIChatMessage from "./ai-chat-message.svelte";
    import { cn } from "$lib/utils";

    let {
        controller,
        assistantLabel = "Assistant",
        conversationLabel = "AI conversation",
        class: className,
    }: AIChatMessageListProps = $props();
    let container = $state<HTMLDivElement | null>(null);
    let contentHeight = $state(0);

    $effect(() => {
        contentHeight;
        if (!container) return;
        const frame = requestAnimationFrame(() => {
            if (container) container.scrollTop = container.scrollHeight;
        });
        return () => cancelAnimationFrame(frame);
    });
</script>

<div
    bind:this={container}
    class={cn("min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4", className)}
    aria-label={conversationLabel}
>
    <div bind:offsetHeight={contentHeight}>
        {#each controller.messages as message (message.id)}
            <AIChatMessage {message} {assistantLabel} />
        {/each}
    </div>
</div>
