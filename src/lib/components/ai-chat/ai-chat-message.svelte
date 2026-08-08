<script lang="ts" module>
    import type { NormalizedAIMessage } from "$lib/ai/types";

    export interface AIChatMessageProps {
        message: NormalizedAIMessage;
        assistantLabel?: string;
        /**
         * Whether the turn above this one has the same role. A run of assistant
         * turns is one speaker talking, so only the first of a run is attributed —
         * repeating the byline on every turn reads as several different coaches.
         */
        continues?: boolean;
    }
</script>

<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { MathStatement } from "$lib/components/math-statement";
    import { cn } from "$lib/utils";
    import AIChatReasoning from "./ai-chat-reasoning.svelte";

    let {
        message,
        assistantLabel = "Coach",
        continues = false,
    }: AIChatMessageProps = $props();

    let answered = $derived(
        message.parts.some((part) => part.type === "text" && part.text.trim().length > 0),
    );
    // Before the first delta there is nothing to render but the byline, which reads
    // as a turn that arrived empty. The thinking row stands in for the answer until
    // one exists, and is replaced by it rather than pushed along by it.
    let awaitingFirstToken = $derived(
        message.status === "streaming" && !answered && !message.reasoning,
    );
</script>

<article
    class={cn(
        "ai-chat-message flex flex-col text-sm",
        message.role === "user"
            ? "ml-auto max-w-[88%] rounded-2xl rounded-br-sm border border-border/40 bg-surface-container-low px-3.5 py-2 text-foreground"
            : "py-1 text-foreground",
        continues ? "mt-1" : "mt-4 first:mt-0",
    )}
>
    {#if message.role === "assistant" && !continues}
        <div class="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <div class="flex size-4 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon name="auto_awesome" fontsize={12} fill />
            </div>
            <span>{assistantLabel}</span>
        </div>
    {/if}
    {#if message.reasoning}
        <AIChatReasoning trace={message.reasoning} {answered} />
    {/if}
    {#if awaitingFirstToken}
        <div class="flex items-center gap-1 py-1" aria-label="Thinking">
            {#each [0, 1, 2] as dot (dot)}
                <span
                    class="size-1.5 animate-pulse rounded-full bg-muted-foreground/60"
                    style="animation-delay: {dot * 160}ms"
                ></span>
            {/each}
        </div>
    {/if}
    {#each message.parts as part, index (`${part.type}-${index}`)}
        {#if part.type === "text" && part.text.trim().length > 0}
            {#if message.role === "assistant"}
                <MathStatement
                    text={part.text}
                    format="markdown"
                    class="leading-6 text-foreground"
                />
            {:else}
                <p class="whitespace-pre-wrap leading-relaxed text-foreground">{part.text.trim()}</p>
            {/if}
        {:else if part.type === "status"}
            <p class="mt-1.5 text-xs text-muted-foreground">{part.label}</p>
        {:else if part.type === "error"}
            <p
                class="mt-1.5 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
            >
                {part.message}
            </p>
        {:else if part.type === "tool"}
            <div
                class="mt-1.5 flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-surface-container px-3 py-1.5 text-xs text-muted-foreground"
            >
                <span class="truncate">{part.summary}</span>
                <span class="shrink-0 font-medium capitalize">{part.status}</span>
            </div>
        {/if}
    {/each}
    {#if message.status === "streaming" && answered}
        <!-- A caret rather than a dot on its own line: the answer is still being
             written, and the mark belongs at the end of the writing. -->
        <span
            class="ai-chat-caret mt-0.5 inline-block h-4 w-[2px] rounded-full bg-primary align-text-bottom"
            aria-hidden="true"
        ></span>
    {/if}
</article>

<style>
    .ai-chat-message {
        animation: ai-chat-message-in 160ms ease-out both;
    }

    @keyframes ai-chat-message-in {
        from {
            opacity: 0;
            transform: translateY(4px);
        }
        to {
            opacity: 1;
            transform: none;
        }
    }

    .ai-chat-caret {
        animation: ai-chat-caret-blink 1s steps(2, start) infinite;
    }

    @keyframes ai-chat-caret-blink {
        to {
            opacity: 0;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .ai-chat-message,
        .ai-chat-caret {
            animation: none;
        }
    }
</style>
