<script lang="ts">
    import type { WhiteboardStore } from "$lib/state/whiteboard.svelte";
    import { acknowledgeWhiteboardPersist } from "$lib/onboarding";
    import CompactControls from "./compact-controls.svelte";
    import Whiteboard from "./whiteboard.svelte";

    let {
        store,
        persistKey,
    }: {
        store: WhiteboardStore;
        persistKey?: string;
    } = $props();

    function persist() {
        if (!persistKey) return;
        store.persist(persistKey);
        acknowledgeWhiteboardPersist(persistKey, store.document.items.length);
    }

    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    $effect(() => {
        if (!persistKey) return;
        void store.document;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(persist, 400);
        return () => {
            clearTimeout(saveTimer);
            persist();
        };
    });
</script>

<div class="relative h-full min-h-0 overflow-hidden bg-background">
    <Whiteboard {store} shortcutsAlwaysActive />
    <CompactControls {store} class="absolute left-2 right-2 top-2 z-20" />
</div>
