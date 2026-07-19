<script lang="ts">
    import type { WhiteboardStore } from "$lib/state/whiteboard.svelte";
    import CompactControls from "./compact-controls.svelte";
    import PropertyCard from "./property-card.svelte";
    import Whiteboard from "./whiteboard.svelte";

    let {
        store,
        persistKey,
    }: {
        store: WhiteboardStore;
        persistKey?: string;
    } = $props();

    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    $effect(() => {
        if (!persistKey) return;
        void store.scene;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => store.persist(persistKey), 400);
        return () => {
            clearTimeout(saveTimer);
            store.persist(persistKey);
        };
    });
</script>

<div class="relative h-full min-h-0 overflow-hidden bg-background">
    <Whiteboard {store} shortcutsAlwaysActive />
    <CompactControls {store} showProperties={false} class="absolute left-2 right-2 top-2 z-20" />
    <PropertyCard {store} class="absolute right-2 top-16 z-20" />
</div>
