<script lang="ts" module>
    export interface CoachRequestInspectorProps {
        class?: string;
    }
</script>

<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { buildSystemMessage } from "$lib/ai/prompt";
    import type { AIProviderMessage } from "$lib/ai/types";
    import { coach } from "$lib/state/coach.svelte";
    import { settings } from "$lib/state/settings.svelte";
    import { cn } from "$lib/utils";

    let { class: className }: CoachRequestInspectorProps = $props();

    let expanded = $state(true);
    let copied = $state(false);
    let snapshot = $derived(coach.lastRequestSnapshot);
    let snapshotSource = $derived(coach.lastRequestSnapshotSource);
    let visible = $derived(settings.debugMode && settings.showModelRequest);
    let previewMessages = $derived<AIProviderMessage[]>([
        {
            role: "system",
            content: buildSystemMessage(coach.activeContextSnapshot.policy),
        },
    ]);
    let messages = $derived(snapshot?.messages ?? previewMessages);

    function snapshotText(): string {
        return messages
            .map((message, index) => `[${index}] ${message.role}\n${message.content}`)
            .join("\n\n");
    }

    async function copy() {
        try {
            await navigator.clipboard.writeText(snapshotText());
            copied = true;
            setTimeout(() => (copied = false), 2000);
        } catch (error) {
            console.error("Failed to copy model request:", error);
        }
    }
</script>

{#if visible}
    <section
        data-slot="coach-request-inspector"
        class={cn(
            "shrink-0 border-b border-dashed border-border/50 bg-surface-container-lowest",
            className,
        )}
        aria-label="Model messages"
    >
        <div class="flex min-h-9 items-center gap-2 px-3 py-1.5 sm:px-4">
            <button
                type="button"
                class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                onclick={() => (expanded = !expanded)}
                aria-expanded={expanded}
            >
                <Icon name="data_object" fontsize={13} class="shrink-0 text-muted-foreground" />
                <span class="shrink-0 font-mono text-[11px] font-medium text-foreground">
                    Model messages
                </span>
                {#if snapshot}
                    <span class="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
                        {snapshotSource === "reconstructed" ? "reconstructed" : "exact"} last request
                        · {snapshot.model} · {messages.length} messages
                    </span>
                {:else}
                    <span class="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
                        next request preview · system message
                    </span>
                {/if}
                <Icon
                    name={expanded ? "expand_less" : "expand_more"}
                    fontsize={14}
                    class="ml-auto shrink-0 text-muted-foreground"
                />
            </button>
            <button
                type="button"
                onclick={copy}
                title="Copy displayed model messages"
                aria-label="Copy displayed model messages"
                class="flex shrink-0 cursor-pointer items-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
                <Icon
                    name={copied ? "check" : "content_copy"}
                    fontsize={13}
                    class={copied ? "text-correct" : undefined}
                />
            </button>
        </div>

        {#if expanded}
            <div class="max-h-[28rem] space-y-2 overflow-y-auto border-t border-border/40 px-3 py-2 sm:px-4">
                <p class="font-mono text-[10px] text-muted-foreground">
                    {snapshotSource === "captured"
                        ? "Exact last request captured at the provider boundary · runtime only · not saved"
                        : snapshotSource === "reconstructed"
                          ? "Reconstructed from stored turn references and live facts · may differ from the original request"
                          : "System message for the next request · send a message to capture application context and history"}
                </p>
                {#each messages as message, index (`${snapshot?.requestId ?? "preview"}:${index}`)}
                    <article class="overflow-hidden rounded-lg border border-border/60 bg-background">
                        <div class="flex items-center gap-2 border-b border-border/40 px-2.5 py-1">
                            <span class="font-mono text-[10px] text-muted-foreground">{index}</span>
                            <span class="font-mono text-[11px] font-medium text-foreground">
                                {message.role}
                            </span>
                        </div>
                        <pre
                            class="max-h-72 overflow-auto whitespace-pre-wrap px-2.5 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">{message.content}</pre>
                    </article>
                {/each}
            </div>
        {/if}
    </section>
{/if}
