<script lang="ts" module>
    import type { AIChatController } from "./types";

    export interface AIChatComposerProps {
        controller: AIChatController;
        placeholder?: string;
        assistantLabel?: string;
        textareaRef?: HTMLTextAreaElement | null;
    }
</script>

<script lang="ts">
    import { tick } from "svelte";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import AIChatModelPicker from "./ai-chat-model-picker.svelte";

    let {
        controller,
        placeholder = "Ask anything…",
        assistantLabel = "Assistant",
        textareaRef = $bindable(null),
    }: AIChatComposerProps = $props();

    function resizeTextarea() {
        if (!textareaRef) return;
        textareaRef.style.height = "auto";
        const nextHeight = Math.min(textareaRef.scrollHeight, 160);
        textareaRef.style.height = `${nextHeight}px`;
        textareaRef.style.overflowY = textareaRef.scrollHeight > 160 ? "auto" : "hidden";
    }

    $effect(() => {
        controller.draft;
        void tick().then(resizeTextarea);
    });

    function keydown(event: KeyboardEvent) {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            void controller.send();
        }
    }
</script>

<div class="shrink-0 bg-transparent px-3 pb-3 pt-2">
    {#if controller.error}
        <div
            class="mb-2 flex items-start justify-between gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
            <span>{controller.error.message}</span>
            {#if controller.error.retryable}
                <button
                    class="shrink-0 font-medium hover:underline"
                    type="button"
                    onclick={() => controller.retry()}
                >
                    Retry
                </button>
            {/if}
        </div>
    {/if}
    <div
        class="overflow-visible rounded-2xl border border-border/50 bg-surface-container-lowest shadow-xs transition-colors focus-within:border-border/80 focus-within:shadow-md"
    >
        <textarea
            bind:this={textareaRef}
            bind:value={controller.draft}
            rows="1"
            class="block max-h-40 min-h-12 w-full resize-none border-0 bg-transparent px-3.5 pb-1 pt-3 text-sm leading-5 shadow-none outline-none ring-0 placeholder:text-muted-foreground focus:border-0 focus:ring-0"
            {placeholder}
            aria-label={`Message ${assistantLabel}`}
            oninput={resizeTextarea}
            onkeydown={keydown}
        ></textarea>
        <div class="flex items-center justify-between gap-2 px-2.5 pb-2 pt-1">
            <AIChatModelPicker {controller} />
            <Button
                variant="primary"
                size="icon-sm"
                class="rounded-full shadow-none transition-transform enabled:hover:scale-105"
                onclick={() =>
                    controller.streaming ? controller.stop() : controller.send()}
                disabled={!controller.streaming && !controller.draft.trim()}
                aria-label={controller.streaming
                    ? "Stop response"
                    : "Send message"}
            >
                <Icon
                    name={controller.streaming ? "stop" : "arrow_upward"}
                    fontsize={16}
                    fill
                />
            </Button>
        </div>
    </div>
</div>
