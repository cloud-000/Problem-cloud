<script lang="ts">
    import { Modal } from "$lib/components/modal";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import type { WhiteboardStore } from "$lib/state/whiteboard.svelte";
    import Whiteboard from "./whiteboard.svelte";
    import Toolbar from "./toolbar.svelte";
    import { downloadBlob, toPngBlob, toSvgString } from "./export";

    let {
        open = $bindable(false),
        store,
        backgroundSrc,
        persistKey,
        title = "Whiteboard",
        onClose,
    }: {
        open?: boolean;
        store: WhiteboardStore;
        /** Optional image to trace over. */
        backgroundSrc?: string;
        /** When set, the scene autosaves to this localStorage key. */
        persistKey?: string;
        title?: string;
        onClose?: () => void;
    } = $props();

    let surface = $state<SVGSVGElement | null>(null);
    let showBackground = $state(true);

    // Debounced autosave to localStorage (best-effort; off the editing path).
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    $effect(() => {
        if (!persistKey) return;
        // Touch scene so this effect re-runs on every edit.
        void store.scene;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => store.persist(persistKey), 400);
        return () => clearTimeout(saveTimer);
    });

    function close() {
        if (persistKey) store.persist(persistKey);
        open = false;
        onClose?.();
    }

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

<Modal bind:open variant="bare" aria-label={title} onClose={close}>
    <div class="flex h-[100dvh] w-screen flex-col p-3">
        <div class="mb-2 flex items-center justify-between gap-2">
            <span class="text-sm font-semibold text-foreground/90">{title}</span>
            <Button
                variant="ghost"
                size="icon"
                class="bg-surface-container-lowest/90 text-foreground"
                title="Close"
                onclick={close}
            >
                <Icon name="close" />
            </Button>
        </div>

        <Toolbar {store} class="mb-2 self-start">
            {#snippet actions()}
                {#if backgroundSrc}
                    <div class="mx-1 h-6 w-px bg-border/60"></div>
                    <Button
                        variant={showBackground ? "default" : "ghost"}
                        size="icon-sm"
                        title="Toggle trace image"
                        onclick={() => (showBackground = !showBackground)}
                    >
                        <Icon name="image" />
                    </Button>
                {/if}
                <div class="mx-1 h-6 w-px bg-border/60"></div>
                <Button variant="ghost" size="icon-sm" title="Download SVG" onclick={downloadSvg}>
                    <Icon name="download" />
                </Button>
                <Button variant="ghost" size="icon-sm" title="Download PNG" onclick={downloadPng}>
                    <Icon name="image" />
                </Button>
            {/snippet}
        </Toolbar>

        <div class="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60">
            <Whiteboard {store} {backgroundSrc} {showBackground} bind:surface />
        </div>
    </div>
</Modal>
