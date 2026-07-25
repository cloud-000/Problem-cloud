<script module lang="ts">
    /** Lazily created off-screen context used only for text metrics. */
    let metricsContext: CanvasRenderingContext2D | null | undefined;

    /**
     * The width `render.ts` will actually paint for a label, so its selection
     * box matches the ink. Must mirror the font that `drawElement` sets.
     * Returns `undefined` with no DOM (SSR), letting the overlay model fall
     * back to its estimate.
     */
    function measureLabelWidth(text: string, fontSize: number): number | undefined {
        if (metricsContext === undefined) {
            metricsContext = typeof document === "undefined"
                ? null
                : document.createElement("canvas").getContext("2d");
        }
        if (!metricsContext) return undefined;
        metricsContext.font = `${fontSize}px sans-serif`;
        return metricsContext.measureText(text).width;
    }
</script>

<script lang="ts">
    import { cn } from "$lib/utils.js";
    import type { Attachment } from "svelte/attachments";
    import { sceneBounds, type Pair, type Scene } from "$lib/asy/scene";
    import type { WhiteboardStore } from "$lib/state/whiteboard.svelte";
    import { Theme } from "$lib/utils/Theme.svelte";
    import {
        registerCanvasSnapshot,
        renderWhiteboard,
        type WhiteboardPalette,
        type WhiteboardRenderSnapshot,
    } from "./render";
    import {
        activeSelectedVertexOf,
        buildOverlay,
        type VertexRef,
        type WhiteboardOverlay,
    } from "./overlay-model";
    import { hasConstraintToolbarTarget } from "./constraint-toolbar";
    import { Camera } from "./camera.svelte";
    import { PointerInputController } from "./pointer-input.svelte";
    import { KeyboardShortcutController } from "./shortcuts.svelte";
    import ConstraintToolbar from "./constraint-toolbar.svelte";
    import ZoomControls from "./zoom-controls.svelte";

    let {
        store,
        showGrid = true,
        transparent = false,
        navigation = true,
        shortcutsAlwaysActive = false,
        surface = $bindable(null),
        scale = $bindable(40),
        panX = $bindable(0),
        panY = $bindable(0),
        minimumZoom = 20,
        resetViewportControl = false,
        class: className,
    }: {
        store: WhiteboardStore;
        /** Hide the navigation grid for in-context annotation overlays. */
        showGrid?: boolean;
        /** Leave the host's image/surface visible beneath the canvas. */
        transparent?: boolean;
        /** Disable viewport gestures when the host image must remain registration-locked. */
        navigation?: boolean;
        /** Handle canvas shortcuts immediately, without requiring prior canvas interaction. */
        shortcutsAlwaysActive?: boolean;
        /** Bindable ref to the underlying canvas (for SVG/PNG export). */
        surface?: HTMLCanvasElement | null;
        /** Bindable viewport scale in pixels per scene unit. */
        scale?: number;
        /** Bindable horizontal viewport offset in pixels. */
        panX?: number;
        /** Bindable vertical viewport offset in pixels. */
        panY?: number;
        /** Minimum viewport zoom percentage. */
        minimumZoom?: number;
        /** Make the viewport action reset to 100% and zero pan instead of fitting the scene. */
        resetViewportControl?: boolean;
        class?: string;
    } = $props();

    /** The viewport: the only place screen ↔ asy-space conversion happens. */
    const camera = new Camera({
        get scale() {
            return scale;
        },
        set scale(value: number) {
            scale = value;
        },
        get panX() {
            return panX;
        },
        set panX(value: number) {
            panX = value;
        },
        get panY() {
            return panY;
        },
        set panY(value: number) {
            panY = value;
        },
        get minimumZoom() {
            return minimumZoom;
        },
        get surface() {
            return surface;
        },
    });
    const project = (point: Pair): Pair => camera.project(point);

    let lengthMenuOpen = $state(false);
    /** Pointer/DOM plumbing: capture, interaction mode, pinch, pen batching. */
    const pointer = new PointerInputController({
        get store() {
            return store;
        },
        get camera() {
            return camera;
        },
        get surface() {
            return surface;
        },
        // Annotated because the overlay reads the controller's handle state,
        // so inference would otherwise chase its own tail.
        get overlay(): WhiteboardOverlay {
            return overlay;
        },
        get navigation() {
            return navigation;
        },
        // Annotated (like `overlay`) because the two controllers reference each
        // other, so inference would otherwise chase its own tail.
        get spacePressed(): boolean {
            return shortcuts.spacePressed;
        },
        get activeSelectedVertex(): VertexRef | null {
            return activeSelectedVertex;
        },
        onSurfaceActivated() {
            shortcuts.claimSurface();
        },
        closeLengthMenu() {
            lengthMenuOpen = false;
        },
    });

    /** Window keyboard shortcuts, and which canvas currently answers them. */
    const shortcuts = new KeyboardShortcutController({
        get store() {
            return store;
        },
        get pointer(): PointerInputController {
            return pointer;
        },
        get surface() {
            return surface;
        },
        get navigation() {
            return navigation;
        },
        get shortcutsAlwaysActive() {
            return shortcutsAlwaysActive;
        },
        get activeSelectedVertex(): VertexRef | null {
            return activeSelectedVertex;
        },
    });

    /** All screen-space overlay geometry, computed by the pure overlay model. */
    const overlay = $derived(
        buildOverlay({
            displayScene: store.displayScene,
            selection: store.selection,
            selectionPreview: store.selectionPreview,
            hasPreview: store.preview !== null,
            toolKind: store.toolKind,
            selectionContainsSmartItems: store.selectionContainsSmartItems,
            constructionArcGuide: store.arcGuide,
            marquee: store.marquee,
            snapProposal: store.snapProposal,
            constraintGlyphs: store.constraintGlyphs,
            dimensionGlyphs: store.dimensionGlyphs,
            selectedFeatureGeometry: store.selectedFeatureGeometry,
            selectedVertex: pointer.selectedVertex,
            hoveredVertex: pointer.hoveredVertex,
            selectedArcControl: pointer.selectedArcControl,
            hoveredArcControl: pointer.hoveredArcControl,
            activeArcPointer: pointer.activeArcPointer,
            project,
            toScreenLength: (units) => camera.toScreenLength(units),
            measureLabelWidth,
        }),
    );
    const selectedDimension = $derived(overlay.dimensions.find(({ selected }) => selected));
    /** Shared with the toolbar so overlays can lay out around it. */
    const constraintToolbarVisible = $derived(hasConstraintToolbarTarget(store));

    const activeSelectedVertex = $derived(
        activeSelectedVertexOf(overlay.straightVertexEditablePath, pointer.selectedVertex),
    );

    const attachSurface: Attachment<HTMLCanvasElement> = (node) => {
        const attachedStore = store;
        const promptLabel = () =>
            typeof window !== "undefined" ? window.prompt("Label (LaTeX, e.g. $A$):") : null;

        surface = node;
        camera.syncPixelRatio();
        attachedStore.promptLabel = promptLabel;
        return () => {
            pointer.dispose();
            shortcuts.releaseSurface(node);
            if (surface === node) surface = null;
            if (attachedStore.promptLabel === promptLabel) attachedStore.promptLabel = undefined;
        };
    };

    function onWindowResize() {
        camera.syncPixelRatio();
    }

    function fitScene() {
        camera.fitScene(sceneBounds(store.scene));
    }

    const zoomPercentage = $derived(camera.zoomPercentage);
    const canFitScene = $derived(sceneBounds(store.scene) !== null);

    function onWheel(e: WheelEvent) {
        e.preventDefault();
        if (!navigation) return;
        camera.wheel(e);
    }

    function currentPalette(): WhiteboardPalette {
        const current = Theme.currentTheme;
        const light = Theme.themes.get("light");
        return {
            background: current?.theme["surface-container-lowest"] ?? "#ffffff",
            foreground: current?.theme.foreground ?? "#191c1e",
            inverseInk: light?.theme.foreground ?? "#191c1e",
            border: current?.theme.border ?? "#e2e8f0",
            primary: current?.theme["primary-foreground"] ?? "#326cec",
            isDark: Theme.isDark,
        };
    }

    $effect(() => {
        const canvas = surface;
        if (!canvas || camera.width <= 0 || camera.height <= 0) return;

        void Theme.theme;
        const displayScene = $state.snapshot(store.displayScene) as Scene;
        const committedScene = $state.snapshot(store.scene) as Scene;
        const viewport = camera.viewport;
        const palette = currentPalette();
        const runtimeSnapshot: WhiteboardRenderSnapshot = {
            scene: displayScene,
            viewport,
            showGrid,
            transparent,
            palette,
        };
        // `overlay` is already plain screen-space data (every coordinate is a
        // freshly projected value), so it goes to the renderer as-is.
        const renderOverlay = overlay;

        const pixelRatio = camera.pixelRatio;
        const backingWidth = Math.max(1, Math.round(camera.width * pixelRatio));
        const backingHeight = Math.max(1, Math.round(camera.height * pixelRatio));
        if (canvas.width !== backingWidth) canvas.width = backingWidth;
        if (canvas.height !== backingHeight) canvas.height = backingHeight;
        registerCanvasSnapshot(canvas, { ...runtimeSnapshot, scene: committedScene });
        const frame = requestAnimationFrame(() => {
            const context = canvas.getContext("2d");
            if (context) renderWhiteboard(context, runtimeSnapshot, renderOverlay, pixelRatio);
        });
        return () => cancelAnimationFrame(frame);
    });
</script>

<svelte:window
    onkeydown={(e) => shortcuts.keyDown(e)}
    onkeyup={(e) => shortcuts.keyUp(e)}
    onresize={onWindowResize}
    onblur={() => shortcuts.blur()}
/>

<div
    class={cn(
        "relative h-full w-full overflow-hidden select-none",
        transparent ? "bg-transparent" : "bg-surface-container-lowest",
        className,
    )}
    bind:clientWidth={camera.width}
    bind:clientHeight={camera.height}
>
    {#if navigation}
        <div class="absolute bottom-3 right-3 z-10">
            <ZoomControls
                percentage={zoomPercentage}
                onZoomOut={() => camera.zoomBy(1 / 1.2)}
                onZoomIn={() => camera.zoomBy(1.2)}
                onZoomTo={(percentage) => camera.zoomTo(percentage)}
                onFitScene={resetViewportControl ? () => camera.resetViewport() : fitScene}
                canFitScene={resetViewportControl || canFitScene}
                minimumPercentage={minimumZoom}
                resetViewport={resetViewportControl}
            />
        </div>
    {/if}

    <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
    <canvas
        {@attach attachSurface}
        role="application"
        aria-label="Whiteboard canvas"
        tabindex="0"
        class={cn(
            "block h-full w-full touch-none select-none outline-none",
            pointer.mode === "pan"
                ? "cursor-grabbing"
                : navigation && (store.toolKind === "pan" || shortcuts.spacePressed)
                  ? "cursor-grab"
                  : store.toolKind === "select"
                    ? "cursor-default"
                    : store.toolKind === "eraser"
                      ? "cursor-none"
                    : "cursor-crosshair",
        )}
        style:cursor={pointer.transformCursor}
        onpointerdown={(e) => pointer.pointerDown(e)}
        onpointermove={(e) => pointer.pointerMove(e)}
        onpointerup={(e) => pointer.pointerUp(e)}
        onpointercancel={(e) => pointer.pointerCancel(e)}
        onpointerleave={() => pointer.pointerLeave()}
        ondblclick={(e) => pointer.doubleClick(e)}
        onwheel={onWheel}
    ></canvas>
    {#each overlay.selectedSegmentMarkers as marker (marker.label)}
        <span
            class="pointer-events-none absolute z-20 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-surface-container-lowest bg-primary text-[10px] font-bold text-primary-foreground shadow-sm"
            style:left={`${marker.screen[0]}px`}
            style:top={`${marker.screen[1]}px`}
            aria-hidden="true"
        >{marker.label}</span>
    {/each}
    <ConstraintToolbar
        {store}
        {project}
        board={{ width: camera.width, height: camera.height }}
        selectedSegmentMarkers={overlay.selectedSegmentMarkers}
        bind:lengthMenuOpen
    />
    {#if selectedDimension && selectedDimension.mode === "driving" && !lengthMenuOpen}
        <input
            class="absolute z-30 h-7 w-20 -translate-x-1/2 -translate-y-1/2 rounded-md border border-primary bg-background px-1 text-center text-xs shadow-sm outline-none focus:ring-2 focus:ring-ring"
            style:left={`${selectedDimension.label[0]}px`}
            style:top={`${selectedDimension.label[1]}px`}
            type="number"
            min="0"
            step="0.1"
            value={selectedDimension.value}
            aria-label="Driving length"
            onkeydown={(event) => {
                const input = event.currentTarget;
                if (event.key === "Enter") {
                    store.editDimension(selectedDimension.id, Number(input.value));
                    input.blur();
                } else if (event.key === "Escape") input.blur();
            }}
        />
    {/if}
    {#if store.solverDiagnostic && store.conflictingConstraintIds.length > 0 && !constraintToolbarVisible}
        <div class="pointer-events-none absolute bottom-3 left-1/2 z-30 max-w-sm -translate-x-1/2 rounded-lg border border-destructive/40 bg-background/95 px-3 py-2 text-xs text-destructive shadow-sm">
            {store.solverDiagnostic}
        </div>
    {/if}
    {#if store.toolKind === "eraser" && pointer.eraserPointer}
        <div
            class="pointer-events-none absolute z-20 rounded-full border border-foreground/70 bg-background/20 shadow-sm"
            style:left={`${pointer.eraserPointer[0] - store.eraserSize}px`}
            style:top={`${pointer.eraserPointer[1] - store.eraserSize}px`}
            style:width={`${store.eraserSize * 2}px`}
            style:height={`${store.eraserSize * 2}px`}
            aria-hidden="true"
        ></div>
    {/if}
</div>
