<script lang="ts" module>
    import type { AIChatController } from "./types";

    export interface AIChatComposerProps {
        controller: AIChatController;
        placeholder?: string;
        assistantLabel?: string;
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
    }: AIChatComposerProps = $props();
    let textarea = $state<HTMLTextAreaElement | null>(null);

    function resizeTextarea() {
        if (!textarea) return;
        textarea.style.height = "auto";
        const nextHeight = Math.min(textarea.scrollHeight, 160);
        textarea.style.height = `${nextHeight}px`;
        textarea.style.overflowY = textarea.scrollHeight > 160 ? "auto" : "hidden";
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
                    class="shrink-0 font-semibold hover:underline"
                    type="button"
                    onclick={() => controller.retry()}
                >
                    Retry
                </button>
            {/if}
        </div>
    {/if}
    <div
        class="overflow-visible rounded-2xl bg-surface-container-low/80 shadow-sm transition-[background-color,box-shadow] focus-within:bg-surface-container focus-within:shadow-md"
    >
        <textarea
            bind:this={textarea}
            bind:value={controller.draft}
            rows="1"
            class="block max-h-40 min-h-12 w-full resize-none border-0 bg-transparent px-3.5 pb-1 pt-3 text-sm leading-5 shadow-none outline-none ring-0 placeholder:text-muted-foreground focus:border-0 focus:ring-0"
            {placeholder}
            aria-label={`Message ${assistantLabel}`}
            oninput={resizeTextarea}
            onkeydown={keydown}
        ></textarea>
        <div class="flex min-h-10 items-center gap-2 px-2 pb-2 pt-1">
            <AIChatModelPicker {controller} />
            <span
                class="ml-auto whitespace-nowrap text-[10px] text-muted-foreground/70"
            >
                Enter ↵ · Shift+Enter newline
            </span>
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
                    fill
                />
            </Button>
        </div>
    </div>
</div>
