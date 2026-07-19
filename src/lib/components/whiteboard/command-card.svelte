<script lang="ts">
    import type { Snippet } from "svelte";
    import { cn } from "$lib/utils.js";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import type { WhiteboardStore } from "$lib/state/whiteboard.svelte";

    let {
        store,
        class: className,
        actions,
        compact = false,
    }: {
        store: WhiteboardStore;
        class?: string;
        actions?: Snippet;
        compact?: boolean;
    } = $props();

    let copied = $state(false);

    async function copyAsy() {
        try {
            await navigator.clipboard.writeText(store.toAsy());
            copied = true;
            setTimeout(() => (copied = false), 1200);
        } catch {
            copied = false;
        }
    }
</script>

<div
    class={cn(
        "flex items-center gap-0.5 rounded-xl border border-border/60 bg-surface-container-lowest/95 p-1 shadow-sm backdrop-blur-(--backdrop-blur)",
        className,
    )}
    role="toolbar"
    aria-label="Whiteboard commands"
>
    <Button variant="ghost" size="icon-sm" title="Undo" disabled={!store.canUndo} onclick={() => store.undo()}>
        <Icon name="undo" />
    </Button>
    <Button variant="ghost" size="icon-sm" title="Redo" disabled={!store.canRedo} onclick={() => store.redo()}>
        <Icon name="redo" />
    </Button>
    <Button variant="ghost" size="icon-sm" title="Delete selection" disabled={store.selection.length === 0} onclick={() => store.deleteSelected()}>
        <Icon name="delete" />
    </Button>
    <Button variant="ghost" size="icon-sm" title="Clear all" onclick={() => store.clearAll()}>
        <Icon name="delete_sweep" />
    </Button>
    {#if !compact}
        <Button variant="ghost" size="icon-sm" title={copied ? "Copied!" : "Copy Asymptote"} onclick={copyAsy}>
            <Icon name={copied ? "check" : "content_copy"} />
        </Button>
    {/if}
    {@render actions?.()}
</div>
