<script lang="ts" module>
    import type { Snippet } from "svelte";
    import type { NormalizedAIMessage } from "$lib/ai/types";
    import type { AIChatController } from "./types";

    export interface AIChatMessageListProps {
        controller: AIChatController;
        assistantLabel?: string;
        conversationLabel?: string;
        /** Rendered above the first turn, inside the scrolled content rail. Together
         *  with `messageBefore` this is the seam a specialization interleaves its own
         *  rows into the transcript through, at the positions they occupy in the request
         *  (the Coach renders the system message here). */
        leading?: Snippet;
        /** Rendered as a sibling above each turn. Render nothing to skip a message. */
        messageBefore?: Snippet<[NormalizedAIMessage]>;
        class?: string;
        /** Class for the measured content rail inside the scroll container.
         *  Use it to constrain message width while the scrollbar stays on the
         *  outer edge of the surface. */
        contentClass?: string;
    }
</script>

<script lang="ts">
    import AIChatMessage from "./ai-chat-message.svelte";
    import { Icon } from "$lib/components/icon";
    import { cn } from "$lib/utils";

    let {
        controller,
        assistantLabel = "Assistant",
        conversationLabel = "AI conversation",
        leading,
        messageBefore,
        class: className,
        contentClass,
    }: AIChatMessageListProps = $props();
    let container = $state<HTMLDivElement | null>(null);
    let contentHeight = $state(0);

    /** How close to the bottom still counts as "following along". */
    const STICK_THRESHOLD = 64;

    // Following the stream is a *state the reader is in*, not something the
    // transcript does unconditionally. Scrolling up to re-read an earlier hint used
    // to be undone by the very next token, which made a streaming answer impossible
    // to read back while it was still arriving.
    let following = $state(true);

    function distanceFromBottom(node: HTMLElement) {
        return node.scrollHeight - node.scrollTop - node.clientHeight;
    }

    function scrollToBottom(behavior: ScrollBehavior = "auto") {
        if (!container) return;
        container.scrollTo({ top: container.scrollHeight, behavior });
        following = true;
    }

    function onscroll() {
        if (!container) return;
        following = distanceFromBottom(container) <= STICK_THRESHOLD;
    }

    // A turn the reader just sent always pulls them back down — they are the one who
    // caused it, so it is not an interruption. Assistant deltas do not, which is what
    // leaves an unfollowed reader where they were.
    let lastUserMessageId = $derived(
        controller.messages.findLast((message) => message.role === "user")?.id ?? null,
    );
    $effect(() => {
        void lastUserMessageId;
        following = true;
    });

    $effect(() => {
        contentHeight;
        if (!container || !following) return;
        const frame = requestAnimationFrame(() => {
            if (container && following) container.scrollTop = container.scrollHeight;
        });
        return () => cancelAnimationFrame(frame);
    });
</script>

<!-- The wrapper exists only so the jump-to-latest pill can be positioned against
     the transcript's viewport; anything absolute *inside* the scroll container
     scrolls away with the content. `class` still belongs to the scroll container,
     which is what callers style. -->
<div class="relative flex min-h-0 flex-1 flex-col">
    <div
        bind:this={container}
        {onscroll}
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
            {@render leading?.()}
            {#each controller.messages as message, index (message.id)}
                {@render messageBefore?.(message)}
                <AIChatMessage
                    {message}
                    {assistantLabel}
                    continues={controller.messages[index - 1]?.role === message.role}
                />
            {/each}
        </div>
    </div>

    {#if !following && controller.messages.length > 0}
        <button
            type="button"
            class="absolute left-1/2 z-20 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-border/60 bg-surface-container-lowest text-muted-foreground shadow-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
            style="bottom: calc(var(--ai-chat-composer-h, 0px) + 0.5rem);"
            aria-label="Jump to latest"
            onclick={() => scrollToBottom("smooth")}
        >
            <Icon name="keyboard_arrow_down" fontsize={20} />
        </button>
    {/if}
</div>
