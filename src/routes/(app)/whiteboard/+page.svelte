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

    const PERSIST_KEY = "whiteboard:page";

    // Restore the last session (browser-only; returns null during SSR).
    const restored = WhiteboardStore.restore(PERSIST_KEY);
    const store = restored ? new WhiteboardStore(restored) : new WhiteboardStore();

    let surface = $state<HTMLCanvasElement | null>(null);

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

<div class="relative h-full min-h-0 overflow-hidden">
    <Whiteboard {store} shortcutsAlwaysActive bind:surface />
    <WhiteboardCompactControls {store} class="absolute left-3 right-3 top-3 z-10 md:hidden" />
    <WhiteboardToolbar {store} orientation="vertical" class="absolute left-3 top-3 z-10 hidden md:flex" />
    <WhiteboardPropertyCard {store} class="absolute left-14 top-3 z-10 hidden md:block" />
    <WhiteboardCommandCard {store} class="absolute right-3 top-3 z-10 hidden md:flex">
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
