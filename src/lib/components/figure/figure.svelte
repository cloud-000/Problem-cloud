<script lang="ts">
    import { untrack } from "svelte";
    import { scale } from "svelte/transition";
    import { cubicOut } from "svelte/easing";
    import { browser } from "$app/environment";
    import { cn } from "$lib/utils.js";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Modal } from "$lib/components/modal";
    import { Theme } from "$lib/utils/Theme.svelte";

    let {
        imageSrc,
        alt = "Image",
        code = "",
        autoInvert = true,
        class: className,
    }: {
        imageSrc: string;
        alt?: string;
        code?: string;
        autoInvert?: boolean;
        class?: string;
    } = $props();

    let view = $state<"image" | "code">("image");
    let expanded = $state(false);

    function annotationKey(source: string): string {
        // Keep data/blob URLs out of the localStorage key while making the
        // persisted scene stable across mounts for the same trainer image.
        let hash = 2166136261;
        for (let index = 0; index < source.length; index += 1) {
            hash ^= source.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return `figure:annotations:${(hash >>> 0).toString(36)}:${source.length}`;
    }

    // MathStatement keys image segments, so a changed source remounts Figure.
    const persistKey = annotationKey(untrack(() => imageSrc));
    let lightboxScale = $state(40);
    let lightboxPanX = $state(0);
    let lightboxPanY = $state(0);
    let saveTimer: ReturnType<typeof setTimeout> | undefined;

    /**
     * The whiteboard drags in the sketch engine and constraint solver — ~180 KB
     * that a Figure only needs once someone actually annotates. Because Figure
     * is reachable from the app shell (MathStatement -> the Coach panel), a
     * static import put all of it in the initial bundle of every route. Keep
     * these imports dynamic.
     */
    type WhiteboardView = typeof import("$lib/components/whiteboard");
    type WhiteboardState = typeof import("$lib/state/whiteboard.svelte");

    let wb = $state<WhiteboardView | null>(null);
    let board = $state<InstanceType<WhiteboardState["WhiteboardStore"]> | null>(null);
    let loading: Promise<void> | null = null;

    function loadWhiteboard(): Promise<void> {
        loading ??= (async () => {
            const [components, state] = await Promise.all([
                import("$lib/components/whiteboard"),
                import("$lib/state/whiteboard.svelte"),
            ]);
            const { WhiteboardStore } = state;
            board = new WhiteboardStore(WhiteboardStore.restore(persistKey) ?? undefined);
            wb = components;
        })();
        return loading;
    }

    /**
     * Whether this figure has annotations worth rendering under the thumbnail.
     * Read straight off the raw payload: asking the store would mean loading the
     * very module we are deferring. `items` is the document's element list, and
     * the persisted shape is a plain `WhiteboardDocument` (see persistence.ts).
     */
    function hasStoredAnnotations(): boolean {
        if (!browser) return false;
        try {
            const raw = localStorage.getItem(persistKey);
            if (!raw) return false;
            return (JSON.parse(raw) as { items?: unknown[] }).items?.length ? true : false;
        } catch {
            return false;
        }
    }

    // An already-annotated figure has to show its annotations without a click,
    // so it pays for the module after hydration — off the critical path, and
    // only on pages that actually have one.
    $effect(() => {
        if (hasStoredAnnotations()) void loadWhiteboard();
    });

    $effect(() => {
        const store = board;
        if (!store) return;
        void store.document;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => store.persist(persistKey), 400);
        return () => {
            clearTimeout(saveTimer);
            store.persist(persistKey);
        };
    });

    function openLightbox() {
        lightboxScale = 40;
        lightboxPanX = 0;
        lightboxPanY = 0;
        // Open now, draw when the engine lands — a first click should not wait
        // on a network fetch to show the enlarged image.
        expanded = true;
        void loadWhiteboard().then(() => board?.setTool("pen"));
    }

    function closeLightbox() {
        expanded = false;
    }

    // State to track user's manual override of the theme's default inversion.
    // If null, it defaults to auto-inverting in dark mode — right for line-art
    // diagrams on white, but callers pass autoInvert={false} for real photos
    // that should never invert unless the user asks.
    let userInverted = $state<boolean | null>(null);
    let inverted = $derived(userInverted ?? (autoInvert && Theme.isDark));

    // Luminance-only inversion: flips black<->white backgrounds while keeping
    // colored strokes roughly true. Applied to the <img> only.
    const INVERT_STYLE = "filter: invert(1) hue-rotate(180deg)";
</script>

<div class={cn("group relative my-3", className)}>
    {#if view === "image"}
        <button
            type="button"
            class="block w-full cursor-zoom-in"
            title="Click to expand"
            onclick={openLightbox}
        >
            <span class="relative mx-auto block w-fit max-w-full">
                <img
                    src={imageSrc}
                    {alt}
                    style={inverted ? INVERT_STYLE : ""}
                    class="block max-h-[300px] max-w-full rounded-lg object-contain select-none"
                />
                {#if wb && board && board.scene.elements.length > 0}
                    {@const Whiteboard = wb.Whiteboard}
                    <span class="pointer-events-none absolute inset-0" inert>
                        <Whiteboard
                            store={board}
                            showGrid={false}
                            transparent
                            navigation={false}
                            class="absolute inset-0"
                        />
                    </span>
                {/if}
            </span>
        </button>
    {:else}
        <pre
            class="block font-mono text-sm leading-relaxed p-4 rounded-lg bg-surface-container-low/50 border border-border/60 overflow-x-auto text-foreground max-h-[250px]"><code
                >{code}</code
            ></pre>
    {/if}

    <!-- Hover toolbar -->
    <div
        class="absolute right-2 top-2 flex gap-1 rounded-lg border border-border/60 bg-surface-container-lowest/90 p-1 opacity-0 shadow-xs backdrop-blur-(--backdrop-blur) transition-opacity group-hover:opacity-100 focus-within:opacity-100"
    >
        {#if code}
            <Button
                variant="ghost"
                size="icon-xs"
                title={view === "image" ? "Show code" : "Show image"}
                onclick={() => (view = view === "image" ? "code" : "image")}
            >
                <Icon name={view === "image" ? "code" : "image"} />
            </Button>
        {/if}
        {#if view === "image"}
            <Button
                variant="ghost"
                size="icon-xs"
                title={inverted ? "Light" : "Dark"}
                onclick={() => (userInverted = !inverted)}
            >
                <Icon name="invert_colors" fill={inverted} />
            </Button>
            <Button
                variant="ghost"
                size="icon-xs"
                title="Expand"
                onclick={openLightbox}
            >
                <Icon name="open_in_full" />
            </Button>
        {/if}
    </div>
</div>

<!-- Fullscreen lightbox: a chromeless (bare) Modal that owns the backdrop,
     Escape handling, scroll-lock, and backdrop-click close. -->
<Modal
    bind:open={expanded}
    variant="bare"
    class="p-0"
    aria-label="Annotate expanded image"
>
    <div class="relative h-full w-full overflow-hidden">
        <div
            class="pointer-events-none absolute inset-0 flex items-center justify-center"
            transition:scale={{ duration: 150, start: 0.95, easing: cubicOut }}
        >
            <img
                src={imageSrc}
                {alt}
                style={`${inverted ? `${INVERT_STYLE};` : ""} transform: translate(${lightboxPanX}px, ${lightboxPanY}px) scale(${lightboxScale / 40});`}
                class="block max-h-full max-w-full rounded-lg object-contain select-none"
            />
        </div>

        {#if wb && board}
            {@const Whiteboard = wb.Whiteboard}
            {@const CompactControls = wb.WhiteboardCompactControls}
            <Whiteboard
                store={board}
                showGrid={false}
                transparent
                navigation
                minimumZoom={50}
                resetViewportControl
                bind:scale={lightboxScale}
                bind:panX={lightboxPanX}
                bind:panY={lightboxPanY}
                class="absolute inset-0"
            />

            <CompactControls
                store={board}
                class="absolute left-1/2 top-3 z-10 max-w-[calc(100%-6rem)] -translate-x-1/2 sm:top-4"
            />
        {/if}
    </div>
    <Button
        variant="ghost"
        size="icon"
        class="absolute right-3 top-3 z-20 bg-surface-container-lowest/90 text-foreground sm:right-4 sm:top-4"
        title="Close"
        onclick={closeLightbox}
    >
        <Icon name="close" />
    </Button>
</Modal>
