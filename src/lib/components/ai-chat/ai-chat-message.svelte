<script lang="ts" module>
    import type { NormalizedAIMessage } from "$lib/ai/types";

    export interface AIChatMessageProps {
        message: NormalizedAIMessage;
        assistantLabel?: string;
    }
</script>

<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { MathStatement } from "$lib/components/math-statement";
    import { cn } from "$lib/utils";

    let { message, assistantLabel = "Coach" }: AIChatMessageProps = $props();
</script>

<article
    class={cn(
        "text-sm flex flex-col",
        message.role === "user"
            ? "my-1.5 ml-auto max-w-[88%] rounded-2xl rounded-br-sm border border-border/40 bg-surface-container-low px-3.5 py-2 text-foreground"
            : "my-1 py-1 text-foreground",
    )}
>
    {#if message.role === "assistant"}
        <div class="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <div class="flex size-4 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon name="auto_awesome" fontsize={12} fill />
            </div>
            <span>{assistantLabel}</span>
        </div>
    {/if}
    {#each message.parts as part, index (`${part.type}-${index}`)}
        {#if part.type === "text" && part.text.trim().length > 0}
            {#if message.role === "assistant"}
                <MathStatement
                    text={part.text}
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
    {#if message.status === "streaming"}
        <span
            class="mt-1.5 inline-block size-2 animate-pulse rounded-full bg-primary"
            aria-hidden="true"
        ></span>
    {/if}
</article>
