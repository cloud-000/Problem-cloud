<script module lang="ts">
    let activeShortcutSurface: HTMLCanvasElement | null = null;

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
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import type { Attachment } from "svelte/attachments";
    import { sceneBounds, type Pair, type Scene } from "$lib/asy/scene";
    import type { WhiteboardStore } from "$lib/state/whiteboard.svelte";
    import type { RelationKind } from "$lib/whiteboard/model";
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
    import { clampToolbarPosition } from "./constraint-toolbar";
    import { Camera } from "./camera.svelte";
    import { PointerInputController } from "./pointer-input.svelte";
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

    let spacePressed = $state(false);
    let lengthMenuOpen = $state(false);
    let constraintToolbarWidth = $state(0);
    let constraintToolbarHeight = $state(0);
    let constraintToolbarPlacement = $state<{ selectionKey: string; offset: Pair }>({
        selectionKey: "",
        offset: [0, 0],
    });
    let constraintToolbarDrag: {
        pointerId: number;
        selectionKey: string;
        clientStart: Pair;
        positionStart: Pair;
    } | null = null;
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
        get spacePressed() {
            return spacePressed;
        },
        get activeSelectedVertex(): VertexRef | null {
            return activeSelectedVertex;
        },
        onSurfaceActivated() {
            activeShortcutSurface = surface;
        },
        closeLengthMenu() {
            lengthMenuOpen = false;
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
            project,
            toScreenLength: (units) => camera.toScreenLength(units),
            measureLabelWidth,
        }),
    );
    const selectedDimension = $derived(overlay.dimensions.find(({ selected }) => selected));
    const constraintToolbarSelectionKey = $derived(JSON.stringify(store.featureSelection));
    const constraintToolbarPosition = $derived.by(() => {
        if (store.toolKind !== "select" || store.featureSelection.length === 0) return null;
        const geometry = store.selectedFeatureGeometry;
        const anchors = [
            ...geometry.points.map(project),
            ...geometry.segments.flatMap((segment) => [project(segment.a), project(segment.b)]),
        ];
        if (anchors.length === 0) return null;
        const minX = Math.min(...anchors.map((point) => point[0]));
        const maxX = Math.max(...anchors.map((point) => point[0]));
        const minY = Math.min(...anchors.map((point) => point[1]));
        const maxY = Math.max(...anchors.map((point) => point[1]));
        const aboveSelection = minY >= 56;
        const autoPosition = {
            left: (minX + maxX) / 2,
            top: aboveSelection ? minY - 44 : maxY + 12,
        };
        const offset = constraintToolbarPlacement.selectionKey === constraintToolbarSelectionKey
            ? constraintToolbarPlacement.offset
            : [0, 0] as Pair;
        const position = clampToolbarPosition(
            { left: autoPosition.left + offset[0], top: autoPosition.top + offset[1] },
            { width: camera.width, height: camera.height },
            { width: constraintToolbarWidth || 320, height: constraintToolbarHeight || 40 },
        );
        return {
            ...position,
            menuAbove: position.top + constraintToolbarHeight + 190 > camera.height,
            autoPosition,
            offset,
        };
    });
    const lineSelectionGuidance = $derived.by(() => {
        const markers = overlay.selectedSegmentMarkers;
        if (store.featureSelection.length !== markers.length) return null;
        if (markers.length === 1) {
            return "Shift-click another smart line to compare segments";
        }
        if (markers.length === 2) return "Choose a relationship for these segments";
        return null;
    });

    const relationGlyphs: Record<RelationKind, string> = {
        horizontal: "H",
        vertical: "V",
        parallel: "∥",
        perpendicular: "⟂",
        "equal-length": "=",
        "fixed-point": "⌖",
        distance: "↔",
    };

    function toggleContextRelation(kind: RelationKind) {
        store.toggleRelation(kind);
    }

    function onConstraintToolbarDragStart(event: PointerEvent) {
        if (event.button !== 0 || !constraintToolbarPosition) return;
        event.preventDefault();
        (event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId);
        constraintToolbarDrag = {
            pointerId: event.pointerId,
            selectionKey: constraintToolbarSelectionKey,
            clientStart: [event.clientX, event.clientY],
            positionStart: [constraintToolbarPosition.left, constraintToolbarPosition.top],
        };
    }

    function onConstraintToolbarDragMove(event: PointerEvent) {
        if (
            !constraintToolbarDrag ||
            event.pointerId !== constraintToolbarDrag.pointerId ||
            !constraintToolbarPosition
        ) return;
        const position = clampToolbarPosition(
            {
                left: constraintToolbarDrag.positionStart[0] + event.clientX - constraintToolbarDrag.clientStart[0],
                top: constraintToolbarDrag.positionStart[1] + event.clientY - constraintToolbarDrag.clientStart[1],
            },
            { width: camera.width, height: camera.height },
            { width: constraintToolbarWidth || 320, height: constraintToolbarHeight || 40 },
        );
        constraintToolbarPlacement = {
            selectionKey: constraintToolbarDrag.selectionKey,
            offset: [
                position.left - constraintToolbarPosition.autoPosition.left,
                position.top - constraintToolbarPosition.autoPosition.top,
            ],
        };
    }

    function onConstraintToolbarDragEnd(event: PointerEvent) {
        if (!constraintToolbarDrag || event.pointerId !== constraintToolbarDrag.pointerId) return;
        constraintToolbarDrag = null;
    }

    function addContextDimension(mode: "driving" | "reference") {
        store.addLengthDimension(mode);
    }

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
            if (activeShortcutSurface === node) activeShortcutSurface = null;
            if (surface === node) surface = null;
            if (attachedStore.promptLabel === promptLabel) attachedStore.promptLabel = undefined;
        };
    };

    function onKeyDown(e: KeyboardEvent) {
        const target = e.target;
        if (
            (!shortcutsAlwaysActive && activeShortcutSurface !== surface) ||
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            (target instanceof HTMLElement && target.isContentEditable)
        ) return;

        if (navigation && e.key === " ") {
            e.preventDefault();
            spacePressed = true;
        } else if (e.key === "Escape") {
            pointer.cancelPenBatch();
            store.cancel();
            pointer.clearHandleSelection();
            pointer.abortGesture();
        } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
            e.preventDefault();
            pointer.cancelPenBatch();
            store.cancel();
            pointer.clearHandleSelection();
            store.selectAll();
        } else if (e.key === "Delete" || e.key === "Backspace") {
            if (activeSelectedVertex) {
                e.preventDefault();
                store.deletePathVertex(
                    activeSelectedVertex.elementId,
                    activeSelectedVertex.nodeIndex,
                );
                pointer.clearHandleSelection();
            } else if (store.selectedConstraintId) {
                e.preventDefault();
                store.deleteSelectedConstraint();
            } else if (store.selectedDimensionId) {
                e.preventDefault();
                store.deleteSelected();
            } else if (store.selection.length) {
                e.preventDefault();
                store.deleteSelected();
            }
        } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
            e.preventDefault();
            if (e.shiftKey) store.redo();
            else store.undo();
        }
    }

    function onWindowKeyUp(e: KeyboardEvent) {
        if (e.key === " ") spacePressed = false;
    }

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
    onkeydown={onKeyDown}
    onkeyup={onWindowKeyUp}
    onresize={onWindowResize}
    onblur={() => (spacePressed = false)}
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
                : navigation && (store.toolKind === "pan" || spacePressed)
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
    {#if constraintToolbarPosition}
        <section
            class="absolute z-30 max-w-[calc(100%-1rem)] -translate-x-1/2 rounded-lg border border-border/70 bg-surface-container-lowest/97 p-1 shadow-lg backdrop-blur-(--backdrop-blur)"
            style:left={`${constraintToolbarPosition.left}px`}
            style:top={`${constraintToolbarPosition.top}px`}
            aria-label="Constraint toolbar"
            bind:clientWidth={constraintToolbarWidth}
            bind:clientHeight={constraintToolbarHeight}
        >
            <div class="flex items-center gap-1" role="toolbar" aria-label="Geometry constraints">
                <button
                    type="button"
                    class="flex size-6 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing"
                    aria-label="Drag constraint toolbar"
                    title="Drag constraint toolbar"
                    onpointerdown={onConstraintToolbarDragStart}
                    onpointermove={onConstraintToolbarDragMove}
                    onpointerup={onConstraintToolbarDragEnd}
                    onpointercancel={onConstraintToolbarDragEnd}
                >
                    <Icon name="drag_indicator" />
                </button>
                {#each store.contextualRelationActions as action (action.kind)}
                    {#if action.kind !== "distance" || (
                        action.constraintId &&
                        !store.selectedFeatureDimensions.some(({ constraintId }) => constraintId === action.constraintId)
                    )}
                        <Button
                            variant={action.constraintId ? "secondary" : "ghost"}
                            size="sm"
                            class={action.constraintId ? "text-primary" : undefined}
                            aria-label={`${action.constraintId ? "Remove" : "Add"} ${action.label.toLowerCase()} constraint`}
                            aria-pressed={Boolean(action.constraintId)}
                            title={`${action.constraintId ? "Remove" : "Add"} ${action.label.toLowerCase()} constraint`}
                            onclick={() => toggleContextRelation(action.kind)}
                        >
                            <span class="text-base font-semibold leading-none" aria-hidden="true">{relationGlyphs[action.kind]}</span>
                            <span>{action.label}</span>
                        </Button>
                    {/if}
                {/each}
                {#if store.canDimensionSelection}
                    <div class="mx-0.5 h-5 w-px bg-border" aria-hidden="true"></div>
                    <Button
                        variant={lengthMenuOpen || store.selectedFeatureDimensions.length > 0 ? "secondary" : "ghost"}
                        size="sm"
                        class={store.selectedFeatureDimensions.length > 0 ? "text-primary" : undefined}
                        aria-haspopup="menu"
                        aria-expanded={lengthMenuOpen}
                        title="Length dimensions"
                        onclick={() => lengthMenuOpen = !lengthMenuOpen}
                    >
                        <Icon name="straighten" />
                        <span>Length</span>
                    </Button>
                {/if}
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Close constraint toolbar"
                    title="Close constraint toolbar"
                    onclick={() => {
                        lengthMenuOpen = false;
                        store.clearFeatureSelection();
                    }}
                >
                    <Icon name="close" />
                </Button>
            </div>

            {#if lineSelectionGuidance}
                <p class="px-2 pb-1 pt-0.5 text-center text-xs text-muted-foreground" role="status" aria-live="polite">
                    {lineSelectionGuidance}
                </p>
            {/if}

            {#if lengthMenuOpen && store.canDimensionSelection}
                <div
                    class={cn(
                        "absolute right-0 w-64 rounded-lg border border-border/70 bg-surface-container-lowest p-2 shadow-lg",
                        constraintToolbarPosition.menuAbove ? "bottom-full mb-2" : "top-full mt-2",
                    )}
                    role="menu"
                    aria-label="Length dimensions"
                >
                    <p class="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Length dimensions
                    </p>
                    {#if store.selectedFeatureDimensions.length > 0}
                        <div class="space-y-1 border-b border-border/60 pb-2">
                            {#each store.selectedFeatureDimensions as dimension (dimension.id)}
                                <div class="grid grid-cols-[1fr_5rem_1.75rem] items-center gap-1">
                                    <span class="truncate px-1 text-xs capitalize">{dimension.mode}</span>
                                    {#if dimension.mode === "driving"}
                                        <input
                                            class="h-7 min-w-0 rounded-md border border-input bg-background px-1.5 text-right text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                                            type="number"
                                            min="0"
                                            step="0.1"
                                            value={dimension.value}
                                            aria-label="Driving length"
                                            onchange={(event) => store.editDimension(dimension.id, Number(event.currentTarget.value))}
                                        />
                                    {:else}
                                        <span class="px-1 text-right text-xs tabular-nums">{dimension.value.toFixed(2)}</span>
                                    {/if}
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        aria-label={`Remove ${dimension.mode} length dimension`}
                                        title={`Remove ${dimension.mode} length dimension`}
                                        onclick={() => store.removeDimension(dimension.id)}
                                    >
                                        <Icon name="delete" />
                                    </Button>
                                </div>
                            {/each}
                        </div>
                    {/if}
                    <div class="grid grid-cols-2 gap-1 pt-2">
                        <Button
                            variant="ghost"
                            size="xs"
                            disabled={store.selectedFeatureDimensions.some(({ mode }) => mode === "driving")}
                            onclick={() => addContextDimension("driving")}
                        >Driving</Button>
                        <Button
                            variant="ghost"
                            size="xs"
                            disabled={store.selectedFeatureDimensions.some(({ mode }) => mode === "reference")}
                            onclick={() => addContextDimension("reference")}
                        >Reference</Button>
                    </div>
                    <p class="px-1 pt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                        Driving controls geometry. Reference only measures it.
                    </p>
                </div>
            {/if}
            {#if store.solverDiagnostic && store.conflictingConstraintIds.length > 0}
                <p class="absolute left-0 top-full mt-2 w-64 rounded-md bg-surface-container-lowest px-2 py-1.5 text-[10px] leading-relaxed text-destructive shadow-md">
                    {store.solverDiagnostic}
                </p>
            {/if}
        </section>
    {/if}
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
    {#if store.solverDiagnostic && store.conflictingConstraintIds.length > 0 && !constraintToolbarPosition}
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
