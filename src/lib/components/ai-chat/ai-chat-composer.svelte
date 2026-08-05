<script lang="ts" module>
    import type { AIChatController } from "./types";

    export interface AIChatComposerProps {
        controller: AIChatController;
        placeholder?: string;
        assistantLabel?: string;
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
        "pointer-events-none shrink-0 bg-transparent px-3 pb-3 pt-2",
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
    <div
        class="pointer-events-auto overflow-visible rounded-2xl border border-border/50 bg-surface-container-lowest shadow-xs transition-colors focus-within:border-border/80 focus-within:shadow-md"
    >
        <textarea
            bind:this={textareaRef}
            bind:value={controller.draft}
            rows="1"
            class="block max-h-40 min-h-12 w-full resize-none border-0 bg-transparent px-3.5 pb-1 pt-3 text-sm leading-5 shadow-none outline-none ring-0 placeholder:text-muted-foreground focus:border-0 focus:ring-0"
            {placeholder}
            aria-label={`Message ${assistantLabel}`}
            onkeydown={keydown}
            {@attach trackWidth}
            {@attach trackDraft}
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
