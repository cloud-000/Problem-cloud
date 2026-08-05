<script lang="ts" module>
    import type { AIChatController } from "./types";

    export interface AIChatMessageListProps {
        controller: AIChatController;
        assistantLabel?: string;
        conversationLabel?: string;
        class?: string;
        /** Class for the measured content rail inside the scroll container.
         *  Use it to constrain message width while the scrollbar stays on the
         *  outer edge of the surface. */
        contentClass?: string;
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
        contentClass,
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
    class={cn("min-h-0 flex-1 overflow-y-auto px-3 pt-3 sm:px-4", className)}
    aria-label={conversationLabel}
>
    <!-- Clearance for a composer floating over the transcript. It lives on the
         measured content (not the scroll container) so a growing composer
         re-triggers the stick-to-bottom effect. -->
    <div
        bind:offsetHeight={contentHeight}
        class={contentClass}
        style="padding-bottom: var(--ai-chat-composer-h, 0.75rem);"
    >
        {#each controller.messages as message (message.id)}
            <AIChatMessage {message} {assistantLabel} />
        {/each}
    </div>
</div>
