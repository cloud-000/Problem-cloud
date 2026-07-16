<script lang="ts" module>
    import type { NormalizedAIMessage } from "$lib/ai/types";

    export interface AIChatMessageProps {
        message: NormalizedAIMessage;
        assistantLabel?: string;
    }
</script>

<script lang="ts">
    import { MathStatement } from "$lib/components/math-statement";
    import { cn } from "$lib/utils";

    let { message, assistantLabel = "Assistant" }: AIChatMessageProps = $props();
</script>

<article
    class={cn(
        "flex flex-col py-2 text-sm",
        message.role === "user" &&
            "ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-surface-container-low px-3.5 py-2.5",
    )}
>
    {#if message.role === "assistant"}
        <span
            class="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80"
        >
            {assistantLabel}
        </span>
    {/if}
    {#each message.parts as part, index (`${part.type}-${index}`)}
        {#if part.type === "text"}
            {#if message.role === "assistant"}
                <MathStatement
                    text={part.text}
                    class="whitespace-pre-wrap leading-6 text-foreground"
                />
            {:else}
                <p class="whitespace-pre-wrap leading-6">{part.text}</p>
            {/if}
        {:else if part.type === "status"}
            <p class="mt-2 text-xs text-muted-foreground">{part.label}</p>
        {:else if part.type === "error"}
            <p
                class="mt-2 rounded-lg bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
            >
                {part.message}
            </p>
        {:else if part.type === "tool"}
            <div
                class="mt-2 flex items-center justify-between gap-3 rounded-lg bg-surface-container-low px-2.5 py-2 text-xs text-muted-foreground"
            >
                <span>{part.summary}</span>
                <span class="shrink-0 capitalize">{part.status}</span>
            </div>
        {/if}
    {/each}
    {#if message.status === "streaming"}
        <span
            class="mt-2 inline-block size-1.5 animate-pulse rounded-full bg-primary-foreground"
            aria-hidden="true"
        ></span>
    {/if}
</article>
