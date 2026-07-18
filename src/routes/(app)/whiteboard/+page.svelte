<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import {
        Whiteboard,
        WhiteboardToolbar,
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
        void store.scene;
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

<div class="flex h-full flex-col gap-2 p-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
            <h1 class="text-lg font-semibold">Whiteboard</h1>
            <p class="text-sm text-muted-foreground">
                Sketch freely — draw shapes and export to Asymptote, SVG, or PNG. Your board is saved automatically.
            </p>
        </div>
    </div>

    <div class="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60">
        <Whiteboard {store} bind:surface />
        <WhiteboardToolbar {store} class="absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)]">
            {#snippet actions()}
                <div class="mx-1 h-6 w-px bg-border/60"></div>
                <Button variant="ghost" size="icon-sm" title="Download SVG" onclick={downloadSvg}>
                    <Icon name="download" />
                </Button>
                <Button variant="ghost" size="icon-sm" title="Download PNG" onclick={downloadPng}>
                    <Icon name="image" />
                </Button>
            {/snippet}
        </WhiteboardToolbar>
    </div>
</div>
