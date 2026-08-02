<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import {
        Whiteboard,
        WhiteboardToolbar,
        WhiteboardPropertyCard,
        WhiteboardCommandCard,
        WhiteboardCompactControls,
        downloadBlob,
        toPngBlob,
        toSvgString,
    } from "$lib/components/whiteboard";
    import { WhiteboardStore } from "$lib/state/whiteboard.svelte";
    import { hasWhiteboardInspector } from "$lib/components/whiteboard/control-policy";

    const PERSIST_KEY = "whiteboard:page";

    // Restore the last session (browser-only; returns null during SSR).
    const restored = WhiteboardStore.restore(PERSIST_KEY);
    const store = restored ? new WhiteboardStore(restored) : new WhiteboardStore();

    let surface = $state<HTMLCanvasElement | null>(null);
    let propertiesOpen = $state(false);
    const propertiesAvailable = $derived(hasWhiteboardInspector(store));
    const visiblePropertiesOpen = $derived(propertiesOpen && propertiesAvailable);

    function closeProperties() {
        store.commitPropertyEdit();
        propertiesOpen = false;
    }

    function toggleProperties() {
        if (visiblePropertiesOpen) closeProperties();
        else propertiesOpen = true;
    }

    // Debounced autosave, off the editing path (best-effort).
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    $effect(() => {
        void store.document;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => store.persist(PERSIST_KEY), 400);
        return () => clearTimeout(saveTimer);
    });

    function downloadSvg() {
        if (!surface) return;
        downloadBlob(new Blob([toSvgString(surface)], { type: "image/svg+xml" }), "sketch.svg");
    }

    async function downloadPng() {
        if (!surface) return;
        try {
            downloadBlob(await toPngBlob(surface), "sketch.png");
        } catch {
            // export is best-effort
        }
    }
</script>

<svelte:head>
    <title>Whiteboard · ProblemCloud</title>
</svelte:head>

<div class="flex h-full min-h-0 overflow-hidden bg-surface-container-lowest">
    <div class="relative min-w-0 flex-1 overflow-hidden">
        <Whiteboard {store} shortcutsAlwaysActive bind:surface />
        <WhiteboardCompactControls
            {store}
            class="absolute left-2 right-2 top-[max(0.5rem,env(safe-area-inset-top))] z-20 md:hidden"
        />
        <WhiteboardToolbar
            {store}
            orientation="vertical"
            propertiesOpen={visiblePropertiesOpen}
            onProperties={toggleProperties}
            class="absolute left-3 top-1/2 z-20 hidden -translate-y-1/2 md:flex"
        />
        <WhiteboardCommandCard {store} class="absolute right-3 top-3 z-20 hidden md:flex">
            {#snippet actions()}
                <Button variant="ghost" size="icon-sm" title="Download SVG" onclick={downloadSvg}>
                    <Icon name="download" />
                </Button>
                <Button variant="ghost" size="icon-sm" title="Download PNG" onclick={downloadPng}>
                    <Icon name="image" />
                </Button>
            {/snippet}
        </WhiteboardCommandCard>
    </div>
    {#if visiblePropertiesOpen}
        <WhiteboardPropertyCard
            {store}
            docked
            onClose={closeProperties}
            class="hidden w-64 shrink-0 md:flex"
        />
    {/if}
</div>
