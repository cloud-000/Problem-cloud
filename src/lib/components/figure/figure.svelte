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
    // An error stays visible until a load succeeds or the source changes.
    let imageFailed = $derived.by(() => {
        void imageSrc;
        return false;
    });
    let retrying = $derived.by(() => {
        void imageSrc;
        return false;
    });
    let retryAttempt = $state(0);
    let externalImage = $derived.by(() => {
        try {
            const source = imageSrc.startsWith("/_offline/media?")
                ? new URLSearchParams(imageSrc.split("?")[1]).get("url")
                : imageSrc;
            if (!source) return null;
            const url = new URL(source);
            if (url.protocol !== "https:" && url.protocol !== "http:") return null;
            return {
                href: url.href,
                label: url.hostname === "artofproblemsolving.com" ||
                    url.hostname.endsWith(".artofproblemsolving.com")
                    ? "Open image on AoPS"
                    : "Open image",
            };
        } catch {
            return null;
        }
    });

    let naturalWidth = $state(0);
    let naturalHeight = $state(0);
    let thumbImgEl = $state<HTMLImageElement | null>(null);
    let thumbWidth = $state(0);
    let thumbHeight = $state(0);
    let lightboxWidth = $state(0);
    let lightboxHeight = $state(0);

    function updateNaturalDimensions(img: HTMLImageElement | null) {
        if (!img) return;
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            naturalWidth = img.naturalWidth;
            naturalHeight = img.naturalHeight;
        }
    }

    $effect(() => {
        if (thumbImgEl) {
            updateNaturalDimensions(thumbImgEl);
        }
    });

    $effect(() => {
        void imageSrc;
        naturalWidth = 0;
        naturalHeight = 0;
    });

    function handleImageError(event: Event & { currentTarget: Element }) {
        if (event.currentTarget.getAttribute("src") !== imageSrc) return;
        imageFailed = true;
        retrying = false;
        expanded = false;
    }

    function handleImageLoad(event: Event & { currentTarget: Element }) {
        if (event.currentTarget.getAttribute("src") !== imageSrc) return;
        imageFailed = false;
        retrying = false;
        updateNaturalDimensions(event.currentTarget as HTMLImageElement);
    }

    function retryImage() {
        // Recreate the image without removing the fallback while it loads.
        retrying = true;
        retryAttempt += 1;
    }

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

    let thumbnailScale = $derived.by(() => {
        if (naturalWidth > 0 && thumbWidth > 0) {
            return 40 * (thumbWidth / naturalWidth);
        }
        return 40;
    });

    let lightboxBaseScale = $derived.by(() => {
        if (naturalWidth <= 0 || naturalHeight <= 0) return 40;
        const availableW = lightboxWidth > 0 ? lightboxWidth : (browser ? window.innerWidth : 800);
        const availableH = lightboxHeight > 0 ? lightboxHeight : (browser ? window.innerHeight : 600);
        const fitScale = Math.min(1, availableW / naturalWidth, availableH / naturalHeight);
        return 40 * fitScale;
    });

    let lightboxScale = $state(40);
    let lightboxPanX = $state(0);
    let lightboxPanY = $state(0);
    let prevLightboxBaseScale = $state(40);
    let saveTimer: ReturnType<typeof setTimeout> | undefined;

    $effect(() => {
        const currentBase = lightboxBaseScale;
        const prevBase = prevLightboxBaseScale;
        prevLightboxBaseScale = currentBase;
        if (expanded && prevBase > 0 && currentBase !== prevBase) {
            lightboxScale = (lightboxScale / prevBase) * currentBase;
        }
    });

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
        if (thumbImgEl && thumbImgEl.naturalWidth > 0) {
            updateNaturalDimensions(thumbImgEl);
        }
        lightboxScale = lightboxBaseScale;
        prevLightboxBaseScale = lightboxBaseScale;
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
        {#if imageFailed}
            <div class="rounded-lg border border-border bg-surface-container-low p-4 text-center" role="status">
                <p class="text-sm text-muted-foreground">Image couldn’t load.</p>
                <div class="mt-3 flex flex-wrap justify-center gap-2">
                    <Button variant="outline" size="sm" disabled={retrying} onclick={retryImage}>
                        <span class="grid">
                            <span class="col-start-1 row-start-1" class:invisible={retrying} aria-hidden={retrying}>Retry</span>
                            <span class="col-start-1 row-start-1" class:invisible={!retrying} aria-hidden={!retrying}>Retrying…</span>
                        </span>
                    </Button>
                    {#if externalImage}
                        <Button variant="outline" size="sm" href={externalImage.href} target="_blank" rel="noopener noreferrer">
                            {externalImage.label}
                        </Button>
                    {/if}
                </div>
            </div>
        {/if}
        <button
            type="button"
            class={imageFailed ? "invisible absolute inset-0 w-full pointer-events-none" : "block w-full cursor-zoom-in"}
            disabled={imageFailed}
            aria-hidden={imageFailed}
            title="Click to expand"
            onclick={openLightbox}
        >
            <span
                class="relative mx-auto block w-fit max-w-full"
                bind:clientWidth={thumbWidth}
                bind:clientHeight={thumbHeight}
            >
                {#key `${imageSrc}:${retryAttempt}`}
                    <img
                        bind:this={thumbImgEl}
                        src={imageSrc}
                        onerror={handleImageError}
                        onload={handleImageLoad}
                        {alt}
                        style={inverted ? INVERT_STYLE : ""}
                        class="block max-h-[300px] max-w-full rounded-lg object-contain select-none"
                    />
                {/key}
                {#if wb && board && board.scene.elements.length > 0}
                    {@const Whiteboard = wb.Whiteboard}
                    <span class="pointer-events-none absolute inset-0" inert>
                        <Whiteboard
                            store={board}
                            showGrid={false}
                            transparent
                            navigation={false}
                            scale={thumbnailScale}
                            baseScale={thumbnailScale}
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
        {#if view === "image" && !imageFailed}
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
    <div
        class="relative h-full w-full overflow-hidden"
        bind:clientWidth={lightboxWidth}
        bind:clientHeight={lightboxHeight}
    >
        <div
            class="pointer-events-none absolute inset-0 flex items-center justify-center"
            transition:scale={{ duration: 150, start: 0.95, easing: cubicOut }}
        >
            <img
                src={imageSrc}
                onerror={handleImageError}
                onload={handleImageLoad}
                {alt}
                style={`${inverted ? `${INVERT_STYLE};` : ""} transform: translate(${lightboxPanX}px, ${lightboxPanY}px) scale(${lightboxBaseScale > 0 ? lightboxScale / lightboxBaseScale : 1});`}
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
                baseScale={lightboxBaseScale}
                bind:scale={lightboxScale}
                bind:panX={lightboxPanX}
                bind:panY={lightboxPanY}
                class="absolute inset-0"
            />

            <CompactControls
                store={board}
                class="absolute left-1/2 top-[max(0.75rem,var(--safe-area-top))] z-10 max-w-[calc(100%-6rem)] -translate-x-1/2 sm:top-4"
            />
        {/if}
    </div>
    <Button
        variant="ghost"
        size="icon"
        class="absolute right-3 top-[max(0.75rem,var(--safe-area-top))] z-20 bg-surface-container-lowest/90 text-foreground sm:right-4 sm:top-4"
        title="Close"
        onclick={closeLightbox}
    >
        <Icon name="close" />
    </Button>
</Modal>
