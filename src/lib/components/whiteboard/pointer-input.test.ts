import { describe, expect, test } from "bun:test";
import * as bunTest from "bun:test";
import type { Pair } from "$lib/asy/scene";
import { createSmartPath, emptyWhiteboardDocument, type CurveFeatureRef } from "$lib/whiteboard/model";
import type { VertexRef, WhiteboardOverlay } from "./overlay-model";

const runtimeMock = (bunTest as unknown as {
    mock: { module(id: string, factory: () => unknown): void };
}).mock;
runtimeMock.module("$app/environment", () => ({ browser: false }));

const state = Object.assign(<T>(value: T): T => value, {
    snapshot: <T>(value: T): T => structuredClone(value),
});
Object.assign(globalThis, { $state: state });

const { WhiteboardStore } = await import("$lib/state/whiteboard.svelte");
const { Camera } = await import("./camera.svelte");
const { PointerInputController } = await import("./pointer-input.svelte");
const { activeSelectedVertexOf, buildOverlay } = await import("./overlay-model");

/** A canvas stub: only the pointer-capture and geometry surface is exercised. */
function fakeSurface(): HTMLCanvasElement {
    const captured = new Set<number>();
    return {
        focus() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
        setPointerCapture: (id: number) => captured.add(id),
        hasPointerCapture: (id: number) => captured.has(id),
        releasePointerCapture: (id: number) => captured.delete(id),
    } as unknown as HTMLCanvasElement;
}

function pressAt([clientX, clientY]: Pair): PointerEvent {
    return {
        clientX,
        clientY,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
        altKey: false,
        shiftKey: false,
        timeStamp: 0,
        preventDefault() {},
    } as unknown as PointerEvent;
}

/**
 * A store holding one straight smart path with a driving length dimension, wired
 * to a controller through a host that rebuilds the overlay on every read (the
 * component gets that from `$derived`).
 */
function harness() {
    const created = createSmartPath(emptyWhiteboardDocument(), [[0, 0], [3, 4]], false);
    const item = created.document.items[0];
    if (item.kind !== "sketch-path") throw new Error("missing smart path");
    const store = new WhiteboardStore(created.document);

    const curve: CurveFeatureRef = { kind: "curve", curveId: item.uses[0].curveId };
    store.selectFeature(curve);
    if (!store.addLengthDimension("driving")) throw new Error("missing dimension");
    const dimensionId = store.selectedDimensionId!;

    store.clearFeatureSelection();
    store.selectDimension(null);
    const pathElementId = store.scene.elements[0].id;
    store.selection = [pathElementId];

    const surface = fakeSurface();
    const camera = new Camera({
        scale: 40,
        panX: 0,
        panY: 0,
        minimumZoom: 20,
        get surface() {
            return surface;
        },
    });
    camera.width = 800;
    camera.height = 600;

    // Annotated for the same reason as in `whiteboard.svelte`: the overlay reads
    // the controller's handle state, so inference would chase its own tail.
    const overlayOf = (): WhiteboardOverlay =>
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
            selectedVertex: controller.selectedVertex,
            hoveredVertex: controller.hoveredVertex,
            selectedArcControl: controller.selectedArcControl,
            hoveredArcControl: controller.hoveredArcControl,
            project: (point) => camera.project(point),
            toScreenLength: (units) => camera.toScreenLength(units),
        });

    let lengthMenuClosed = false;
    const controller = new PointerInputController({
        store,
        camera,
        surface,
        navigation: true,
        spacePressed: false,
        get overlay() {
            return overlayOf();
        },
        get activeSelectedVertex(): VertexRef | null {
            return activeSelectedVertexOf(
                overlayOf().straightVertexEditablePath,
                controller.selectedVertex,
            );
        },
        onSurfaceActivated() {},
        closeLengthMenu() {
            lengthMenuClosed = true;
        },
    });

    return {
        store,
        controller,
        dimensionId,
        pathElementId,
        overlay: overlayOf,
        get lengthMenuClosed() {
            return lengthMenuClosed;
        },
    };
}

describe("PointerInputController pointer-down routing", () => {
    test("four canvas clicks can close an arc at its construction endpoint", () => {
        const scope = harness();
        scope.store.setTool("arc");
        const click = (point: Pair) => {
            const event = pressAt(point);
            scope.controller.pointerDown(event);
            scope.controller.pointerUp(event);
        };

        click([400, 300]); // center
        click([500, 300]); // radius
        click([500, 300]); // start

        scope.controller.pointerMove(pressAt([500, 300]));
        expect(scope.store.inspectorClosed).toBe(true);

        click([500, 300]); // end

        const created = scope.store.scene.elements.at(-1);
        expect(created).toMatchObject({ kind: "arc", angle1: 0, angle2: 360 });
        expect(scope.store.inspectorClosed).toBe(true);
    });

    test("pressing a vertex handle selects that vertex and opens a transform", () => {
        const scope = harness();
        const handle = scope.overlay().vertexHandles[0];
        expect(handle).toBeDefined();

        scope.controller.pointerDown(pressAt(handle.screen));

        expect(scope.controller.selectedVertex).toEqual({
            elementId: handle.elementId,
            nodeIndex: handle.nodeIndex,
        });
        expect(scope.controller.mode).toBe("transform");
    });

    test("pressing a dimension glyph selects it and drops the stale handle selection", () => {
        const scope = harness();
        const handle = scope.overlay().vertexHandles[0];
        scope.controller.pointerDown(pressAt(handle.screen));
        scope.controller.pointerUp(pressAt(handle.screen));
        expect(scope.controller.selectedVertex).not.toBeNull();

        const glyph = scope.overlay().dimensions[0];
        expect(glyph).toBeDefined();
        scope.controller.pointerDown(pressAt(glyph.label));

        expect(scope.store.selectedDimensionId).toBe(scope.dimensionId);
        expect(scope.controller.mode).toBe("idle");
        // `selectDimension` clears the item selection, so a retained vertex ref
        // would revive — and capture Delete — when that path is selected again.
        expect(scope.controller.selectedVertex).toBeNull();
        expect(scope.store.selection).toEqual([]);
    });
});
