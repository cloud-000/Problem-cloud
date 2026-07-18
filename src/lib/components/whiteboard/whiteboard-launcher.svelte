<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { WhiteboardStore } from "$lib/state/whiteboard.svelte";
    import WhiteboardModal from "./whiteboard-modal.svelte";

    let {
        persistKey = "whiteboard:scratch",
        title = "Scratch paper",
        class: className,
    }: {
        /** localStorage key the scratch sketch is saved under and restored from. */
        persistKey?: string;
        title?: string;
        class?: string;
    } = $props();

    let open = $state(false);
    let store = $state<WhiteboardStore | null>(null);

    function launch() {
        const restored = WhiteboardStore.restore(persistKey);
        store = restored ? new WhiteboardStore(restored) : new WhiteboardStore();
        open = true;
    }
</script>

<Button
    variant="default"
    size="icon-lg"
    class={className ?? "fixed bottom-4 right-4 z-40 rounded-full shadow-lg"}
    title={title}
    aria-label={title}
    onclick={launch}
>
    <Icon name="draw" />
</Button>

{#if open && store}
    <WhiteboardModal bind:open {store} {persistKey} {title} />
{/if}
