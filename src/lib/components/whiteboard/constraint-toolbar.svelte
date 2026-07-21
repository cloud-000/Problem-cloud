<script lang="ts">
    import { cn } from "$lib/utils.js";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import type { Pair } from "$lib/asy/scene";
    import type { WhiteboardStore } from "$lib/state/whiteboard.svelte";
    import type { RelationKind } from "$lib/whiteboard/model";
    import {
        autoToolbarPosition,
        clampToolbarPosition,
        hasConstraintToolbarTarget,
    } from "./constraint-toolbar";

    let {
        store,
        project,
        board,
        selectedSegmentMarkers,
        lengthMenuOpen = $bindable(false),
    }: {
        store: WhiteboardStore;
        /** Screen projection for the selected feature's anchor points. */
        project: (point: Pair) => Pair;
        /** Whiteboard client size, so the toolbar stays inside it. */
        board: { width: number; height: number };
        /** Numbered badges on the selected segments, for the guidance line. */
        selectedSegmentMarkers: Array<{ label: number; screen: Pair }>;
        /** Bindable so the host can hide overlays the open menu would cover. */
        lengthMenuOpen?: boolean;
    } = $props();

    let toolbarWidth = $state(0);
    let toolbarHeight = $state(0);
    /** A drag offset survives only while the same features stay selected. */
    let placement = $state<{ selectionKey: string; offset: Pair }>({
        selectionKey: "",
        offset: [0, 0],
    });
    let drag: {
        pointerId: number;
        selectionKey: string;
        clientStart: Pair;
        positionStart: Pair;
    } | null = null;

    const selectionKey = $derived(JSON.stringify(store.featureSelection));
    const toolbarSize = $derived({ width: toolbarWidth || 320, height: toolbarHeight || 40 });
    /**
     * Stage one: where the selection alone puts the toolbar. Upstream of the
     * drag offset, so `onDragMove` can read it without reading `position`.
     */
    const auto = $derived.by(() => {
        if (!hasConstraintToolbarTarget(store)) return null;
        const geometry = store.selectedFeatureGeometry;
        return autoToolbarPosition([
            ...geometry.points.map(project),
            ...geometry.segments.flatMap((segment) => [project(segment.a), project(segment.b)]),
        ]);
    });
    /** Stage two: the drag offset applied to `auto`, kept inside the board. */
    const position = $derived.by(() => {
        if (!auto) return null;
        const offset = placement.selectionKey === selectionKey
            ? placement.offset
            : [0, 0] as Pair;
        const clamped = clampToolbarPosition(
            { left: auto.left + offset[0], top: auto.top + offset[1] },
            { width: board.width, height: board.height },
            toolbarSize,
        );
        return { ...clamped, menuAbove: clamped.top + toolbarHeight + 190 > board.height };
    });
    const lineSelectionGuidance = $derived.by(() => {
        const markers = selectedSegmentMarkers;
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

    function onDragStart(event: PointerEvent) {
        if (event.button !== 0 || !position) return;
        event.preventDefault();
        (event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId);
        drag = {
            pointerId: event.pointerId,
            selectionKey,
            clientStart: [event.clientX, event.clientY],
            positionStart: [position.left, position.top],
        };
    }

    // Reads `auto` (upstream) and never `position` (downstream of the offset it
    // writes) — that direction is what keeps the placement from feeding back on
    // itself. Clamping here, not just on read, is deliberate: it stops the
    // offset accumulating past the edge and needing to unwind on the way back.
    function onDragMove(event: PointerEvent) {
        if (!drag || event.pointerId !== drag.pointerId || !auto) return;
        const moved = clampToolbarPosition(
            {
                left: drag.positionStart[0] + event.clientX - drag.clientStart[0],
                top: drag.positionStart[1] + event.clientY - drag.clientStart[1],
            },
            { width: board.width, height: board.height },
            toolbarSize,
        );
        placement = {
            selectionKey: drag.selectionKey,
            offset: [moved.left - auto.left, moved.top - auto.top],
        };
    }

    function onDragEnd(event: PointerEvent) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag = null;
    }

    function addContextDimension(mode: "driving" | "reference") {
        store.addLengthDimension(mode);
    }
</script>

{#if position}
    <section
        class="absolute z-30 max-w-[calc(100%-1rem)] -translate-x-1/2 rounded-lg border border-border/70 bg-surface-container-lowest/97 p-1 shadow-lg backdrop-blur-(--backdrop-blur)"
        style:left={`${position.left}px`}
        style:top={`${position.top}px`}
        aria-label="Constraint toolbar"
        bind:clientWidth={toolbarWidth}
        bind:clientHeight={toolbarHeight}
    >
        <div class="flex items-center gap-1" role="toolbar" aria-label="Geometry constraints">
            <button
                type="button"
                class="flex size-6 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing"
                aria-label="Drag constraint toolbar"
                title="Drag constraint toolbar"
                onpointerdown={onDragStart}
                onpointermove={onDragMove}
                onpointerup={onDragEnd}
                onpointercancel={onDragEnd}
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
                    position.menuAbove ? "bottom-full mb-2" : "top-full mt-2",
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
