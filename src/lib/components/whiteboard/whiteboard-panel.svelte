<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import type { WhiteboardStore } from "$lib/state/whiteboard.svelte";
    import Toolbar from "./toolbar.svelte";
    import Whiteboard from "./whiteboard.svelte";

    let {
        store,
        persistKey,
        title = "Scratch paper",
        onClose,
    }: {
        store: WhiteboardStore;
        persistKey?: string;
        title?: string;
        onClose?: () => void;
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

<div class="flex h-full min-h-0 flex-col bg-background">
    <div class="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div class="min-w-0">
            <h2 class="truncate text-sm font-semibold">{title}</h2>
            <p class="text-[11px] text-muted-foreground">Scroll to move · pinch or wheel to zoom</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close scratch paper" onclick={onClose}>
            <Icon name="close" />
        </Button>
    </div>
    <div class="shrink-0 border-b border-border/60 p-2">
        <Toolbar {store} compact class="border-0 bg-transparent p-0 shadow-none" />
    </div>
    <div class="min-h-0 flex-1">
        <Whiteboard {store} />
    </div>
</div>
