import { describe, expect, test } from "bun:test";
import * as bunTest from "bun:test";
import type { Pair } from "$lib/asy/scene";
import {
    createSmartArc,
    createSmartPath,
    emptyWhiteboardDocument,
    type CurveFeatureRef,
} from "$lib/whiteboard/model";
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

function pressAt(
    [clientX, clientY]: Pair,
    overrides: Partial<PointerEvent> = {},
): PointerEvent {
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
        ...overrides,
    } as unknown as PointerEvent;
}

/** Wire a store to the pointer controller exactly as `whiteboard.svelte` does. */
function wire(store: InstanceType<typeof WhiteboardStore>) {
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
            activeArcPointer: controller.activeArcPointer,
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
        overlay: overlayOf,
        get lengthMenuClosed() {
            return lengthMenuClosed;
        },
    };
}

/**
 * A store holding one straight smart path with a driving length dimension,
 * wired to a controller through a host that rebuilds the overlay on every read.
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

    return { ...wire(store), dimensionId, pathElementId };
}

describe("PointerInputController pointer-down routing", () => {
    test("arc-to-line feature selection tolerates click jitter and exposes tangency", () => {
        const arc = createSmartArc(
            emptyWhiteboardDocument(),
            [0, 0],
            [2, 0],
            [0, 2],
            undefined,
            undefined,
            "arc",
        );
        const line = createSmartPath(
            arc.document,
            [[-4, 4], [4, 4]],
            false,
            undefined,
            undefined,
            "line",
        );
        const arcItem = line.document.items.find((item) =>
            item.kind !== "baked" && item.id === "arc"
        );
        const lineItem = line.document.items.find((item) =>
            item.kind !== "baked" && item.id === "line"
        );
        if (arcItem?.kind !== "sketch-curve" || lineItem?.kind !== "sketch-path") {
            throw new Error("missing smart arc/line");
        }
        const scope = wire(new WhiteboardStore(line.document));
        const before = structuredClone(scope.store.document);
        const arcStroke: Pair = [457, 243];

        scope.controller.pointerDown(pressAt(arcStroke));
        scope.controller.pointerMove(pressAt([461, 243]));
        scope.controller.pointerUp(pressAt([461, 243]));

        expect(scope.store.document).toEqual(before);
        expect(scope.store.canUndo).toBe(false);
        expect(scope.store.featureSelection).toEqual([
            { kind: "curve", curveId: arcItem.curveId },
        ]);
        expect(scope.overlay().featurePoints).toEqual([]);
        expect(scope.overlay().featureArcs).toHaveLength(1);

        const lineStroke: Pair = [480, 140];
        scope.controller.pointerDown(pressAt(lineStroke, { shiftKey: true }));
        scope.controller.pointerUp(pressAt(lineStroke, { shiftKey: true }));

        expect(scope.store.featureSelection).toEqual([
            { kind: "curve", curveId: arcItem.curveId },
            { kind: "curve", curveId: lineItem.uses[0].curveId },
        ]);
        expect(scope.store.contextualRelationActions.map(({ kind }) => kind))
            .toEqual(["tangent"]);
    });

    test("normal curve clicks still replace selection and real drags move the arc", () => {
        const arc = createSmartArc(
            emptyWhiteboardDocument(),
            [0, 0],
            [2, 0],
            [0, 2],
            undefined,
            undefined,
            "arc",
        );
        const line = createSmartPath(
            arc.document,
            [[-4, 4], [4, 4]],
            false,
            undefined,
            undefined,
            "line",
        );
        const lineItem = line.document.items.find((item) =>
            item.kind !== "baked" && item.id === "line"
        );
        if (lineItem?.kind !== "sketch-path") throw new Error("missing smart line");
        const scope = wire(new WhiteboardStore(line.document));
        const arcStroke: Pair = [457, 243];
        const lineStroke: Pair = [480, 140];

        scope.controller.pointerDown(pressAt(arcStroke));
        scope.controller.pointerUp(pressAt(arcStroke));
        scope.controller.pointerDown(pressAt(lineStroke));
        scope.controller.pointerUp(pressAt(lineStroke));

        expect(scope.store.featureSelection).toEqual([
            { kind: "curve", curveId: lineItem.uses[0].curveId },
        ]);
        expect(scope.store.contextualRelationActions.map(({ kind }) => kind))
            .toEqual(["horizontal", "vertical"]);

        scope.controller.pointerDown(pressAt(arcStroke));
        scope.controller.pointerMove(pressAt([465, 243]));
        scope.controller.pointerUp(pressAt([465, 243]));

        expect(scope.store.canUndo).toBe(true);
        const movedArc = scope.store.scene.elements.find(({ id }) => id === "arc");
        expect(movedArc?.kind).toBe("arc");
        if (movedArc?.kind !== "arc") throw new Error("missing moved arc");
        expect(movedArc.center[0]).toBeCloseTo(0.2, 9);
        expect(movedArc.center[1]).toBeCloseTo(0, 9);
    });

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

    test("dragging separated near-coincident arc handles together closes the smart arc", () => {
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
        click([400, 200]); // open quarter-turn end

        const quarterEnd = scope.overlay().arcGuide?.editHandles.find(
            ({ control }) => control === "end",
        );
        expect(quarterEnd).toBeDefined();
        if (!quarterEnd) return;

        // First place the endpoint 0.0796585° shy of closure with Alt held.
        // Its semantic endpoints are now under 2px apart, so the idle overlay
        // separates the two handles by 7px each to keep both selectable.
        const gap = 360 - 359.920341454506;
        const radians = (-gap * Math.PI) / 180;
        const nearStart: Pair = [
            400 + 100 * Math.cos(radians),
            300 - 100 * Math.sin(radians),
        ];
        scope.controller.pointerDown(pressAt(quarterEnd.screen, { altKey: true }));
        scope.controller.pointerMove(pressAt(nearStart, { altKey: true }));
        scope.controller.pointerUp(pressAt(nearStart, { altKey: true }));

        const open = scope.store.inspectorProperties.find(({ id }) => id === "arcAngle");
        expect(open?.value).toBeCloseTo(359.920341454506, 9);

        const guide = scope.overlay().arcGuide;
        const start = guide?.editHandles.find(({ control }) => control === "start");
        const end = guide?.editHandles.find(({ control }) => control === "end");
        expect(start).toBeDefined();
        expect(end).toBeDefined();
        if (!start || !end) return;
        expect(Math.hypot(start.screen[0] - end.screen[0], start.screen[1] - end.screen[1]))
            .toBeGreaterThan(10);

        scope.controller.pointerDown(pressAt(end.screen));
        expect(scope.store.featureSelection).toHaveLength(1);
        expect(scope.store.featureSelection[0]).toMatchObject({
            kind: "curve-point",
            feature: "end",
        });
        scope.controller.pointerMove(pressAt(start.screen));
        scope.controller.pointerUp(pressAt(start.screen));

        expect(scope.store.inspectorClosed).toBe(true);
        expect(scope.store.inspectorProperties.find(({ id }) => id === "arcAngle")?.value)
            .toBe(360);
        expect(Object.values(scope.store.document.sketch.constraints).filter(
            (constraint) => {
                if (
                    constraint.kind !== "coincident" ||
                    constraint.origin !== "inferred" ||
                    constraint.a.kind !== "curve-point" ||
                    constraint.b.kind !== "curve-point" ||
                    constraint.a.curveId !== constraint.b.curveId
                ) return false;
                const features = [constraint.a.feature, constraint.b.feature];
                return features.includes("start") && features.includes("end");
            },
        )).toHaveLength(1);
    });

    test("an off-rim pointer closes by the rendered arc endpoint without leaving a stale point", () => {
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
        click([400, 200]); // open quarter-turn end

        const end = scope.overlay().arcGuide?.editHandles.find(
            ({ control }) => control === "end",
        );
        expect(end).toBeDefined();
        if (!end) return;

        const gap = 360 - 359.39883330280395;
        const radians = (-gap * Math.PI) / 180;
        // The pointer is a normal 20px outside the radius, while the rendered
        // endpoint projects onto the radius-100 circle only ~1px from `start`.
        const pointer: Pair = [
            400 + 120 * Math.cos(radians),
            300 - 120 * Math.sin(radians),
        ];
        scope.controller.pointerDown(pressAt(end.screen));
        scope.controller.pointerMove(pressAt(pointer));
        const featurePointsDuringDrag = scope.overlay().featurePoints;

        scope.controller.pointerUp(pressAt(pointer));

        expect(scope.store.inspectorClosed).toBe(true);
        expect(scope.store.inspectorProperties.find(({ id }) => id === "arcAngle")?.value)
            .toBe(360);
        expect(featurePointsDuringDrag).toHaveLength(0);
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
