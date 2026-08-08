<script lang="ts" module>
    import type { AIChatController } from "./types";

    export interface AIChatComposerProps {
        controller: AIChatController;
        placeholder?: string;
        assistantLabel?: string;
        /**
         * Collapse the card to a single row — textarea, model picker, and send
         * on one line — instead of a textarea above its own toolbar. For a
         * composer standing in for a control the size of a text input, where the
         * full card is four times the height of what it replaced and the
         * difference lands as a layout jump. It still grows with the draft; only
         * the resting height changes.
         */
        compact?: boolean;
        textareaRef?: HTMLTextAreaElement | null;
        class?: string;
    }
</script>

<script lang="ts">
    import type { Attachment } from "svelte/attachments";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { cn } from "$lib/utils";
    import AIChatModelPicker from "./ai-chat-model-picker.svelte";

    const MAX_HEIGHT = 160;

    let {
        controller,
        placeholder = "Ask anything…",
        assistantLabel = "Assistant",
        compact = false,
        textareaRef = $bindable(null),
        class: className,
    }: AIChatComposerProps = $props();

    function fitToContent(node: HTMLTextAreaElement) {
        // At zero content width even the placeholder wraps to about one
        // character per line, so scrollHeight overshoots and pins the box at
        // max height. That is the state on mount inside a panel whose reveal
        // transition animates width up from 0 — `trackWidth` re-measures as
        // soon as real width lands.
        if (node.clientWidth === 0) return;
        node.style.height = "auto";
        const nextHeight = Math.min(node.scrollHeight, MAX_HEIGHT);
        node.style.height = `${nextHeight}px`;
        node.style.overflowY = node.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
    }

    // Reads no reactive state, so it sets up once per mount rather than being
    // rebuilt on every keystroke. Width changes (panel reveal, panel drag,
    // viewport resize) re-wrap the draft; height changes are ignored, since
    // `fitToContent` writes height itself and would otherwise feed itself.
    const trackWidth: Attachment<HTMLTextAreaElement> = (node) => {
        let width = node.clientWidth;
        const observer = new ResizeObserver(() => {
            if (node.clientWidth === width) return;
            width = node.clientWidth;
            fitToContent(node);
        });
        observer.observe(node);
        fitToContent(node);
        return () => observer.disconnect();
    };

    // Re-runs on every draft change, covering programmatic ones like `send()`
    // clearing the draft, which raise no DOM event. Nothing to tear down, so
    // the per-keystroke re-run costs only the measurement.
    const trackDraft: Attachment<HTMLTextAreaElement> = (node) => {
        void controller.draft;
        fitToContent(node);
    };

    function keydown(event: KeyboardEvent) {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            void controller.send();
        }
    }
</script>

<!-- The wrapper's padding is click-through so a composer floating over the
     transcript never eats scroll gestures around its edges; the card and the
     error banner opt back in. -->
<div
    class={cn(
        "pointer-events-none shrink-0 bg-transparent px-3",
        compact ? "pb-2 pt-1" : "pb-3 pt-2",
        className,
    )}
>
    {#if controller.error}
        <div
            class="pointer-events-auto mb-2 flex items-start justify-between gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive"
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
    <!-- Compact keeps every control, on one line instead of two: the picker and
         send move up beside the textarea rather than onto a toolbar of their own.
         `items-end` so they stay pinned to the last line as the draft grows. -->
    <div
        class={cn(
            "pointer-events-auto overflow-visible border border-border/50 bg-surface-container-lowest shadow-xs transition-colors focus-within:border-border/80 focus-within:shadow-md",
            compact ? "flex items-end gap-1 rounded-xl p-1" : "rounded-2xl",
        )}
    >
        <textarea
            bind:this={textareaRef}
            bind:value={controller.draft}
            rows="1"
            class={cn(
                "block max-h-40 resize-none border-0 bg-transparent text-sm leading-5 shadow-none outline-none ring-0 placeholder:text-muted-foreground focus:border-0 focus:ring-0",
                compact
                    ? "min-h-8 w-full min-w-0 flex-1 px-2 py-1.5"
                    : "min-h-12 w-full px-3.5 pb-1 pt-3",
            )}
            {placeholder}
            aria-label={`Message ${assistantLabel}`}
            onkeydown={keydown}
            {@attach trackWidth}
            {@attach trackDraft}
        ></textarea>
        {#if compact}
            <AIChatModelPicker {controller} compact />
            {@render sendButton()}
        {:else}
            <div class="flex items-center justify-between gap-2 px-2.5 pb-2 pt-1">
                <AIChatModelPicker {controller} />
                {@render sendButton()}
            </div>
        {/if}
    </div>
</div>

{#snippet sendButton()}
    <Button
        variant="primary"
        size="icon-sm"
        class="shrink-0 rounded-full shadow-none transition-transform enabled:hover:scale-105"
        onclick={() =>
            controller.streaming ? controller.stop() : controller.send()}
        disabled={!controller.streaming && !controller.draft.trim()}
        aria-label={controller.streaming ? "Stop response" : "Send message"}
    >
        <Icon
            name={controller.streaming ? "stop" : "arrow_upward"}
            fontsize={16}
            fill
        />
    </Button>
{/snippet}
