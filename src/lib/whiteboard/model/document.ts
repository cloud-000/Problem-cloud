import type { Pen, Scene, SceneElement } from "../../asy/scene/types";
import { ptToSceneUnits } from "../../asy/scene/pen";
import {
    WHITEBOARD_SCHEMA_VERSION,
    type SketchGraph,
    type WhiteboardDocument,
    type WhiteboardItem,
} from "./types";

export function emptySketchGraph(): SketchGraph {
    return { points: {}, parameters: {}, curves: {}, constraints: {} };
}

export function emptyWhiteboardDocument(): WhiteboardDocument {
    return {
        schemaVersion: WHITEBOARD_SCHEMA_VERSION,
        items: [],
        sketch: emptySketchGraph(),
    };
}

/** V1 migration: preserve every scene element as baked geometry without inference. */
export function migrateSceneToWhiteboardDocument(scene: Scene): WhiteboardDocument {
    return {
        schemaVersion: WHITEBOARD_SCHEMA_VERSION,
        items: scene.elements.map((element) => ({ kind: "baked", element })),
        sketch: emptySketchGraph(),
        ...(scene.meta ? { meta: scene.meta } : {}),
    };
}

/** V2 → V3 is additive: existing curve records remain valid verbatim. */
export function migrateV2WhiteboardDocument(
    document: Omit<WhiteboardDocument, "schemaVersion"> & { schemaVersion: 2 },
): WhiteboardDocument {
    return migrateV3WhiteboardDocument({ ...document, schemaVersion: 3 });
}

/**
 * V3 → V4 rescales stroke dimensions from point-flavored numbers to scene
 * units (dividing by the reference pixels-per-unit). Geometry is untouched;
 * only `Pen.lineWidth` / `Pen.fontSize` move, on baked elements and smart
 * presentation styles alike. Exotic dash pattern strings carry no unit
 * information and pass through verbatim.
 */
export function migrateV3WhiteboardDocument(
    document: Omit<WhiteboardDocument, "schemaVersion"> & { schemaVersion: 3 },
): WhiteboardDocument {
    return {
        ...document,
        schemaVersion: WHITEBOARD_SCHEMA_VERSION,
        items: document.items.map((item) => {
            if (item.kind === "baked") {
                return { ...item, element: scaleElementPens(item.element) };
            }
            return {
                ...item,
                ...(item.pen ? { pen: scalePen(item.pen) } : {}),
                ...("fillPen" in item && item.fillPen ? { fillPen: scalePen(item.fillPen) } : {}),
            } as WhiteboardItem;
        }),
    };
}

/** V1 persisted scenes predate scene-unit strokes; scale their pens like V3. */
export function migrateV1Scene(scene: Scene): WhiteboardDocument {
    return migrateSceneToWhiteboardDocument(scaleElementPensInScene(scene));
}

function scalePen(pen: Pen): Pen {
    return {
        ...pen,
        ...(pen.lineWidth !== undefined ? { lineWidth: ptToSceneUnits(pen.lineWidth) } : {}),
        ...(pen.fontSize !== undefined ? { fontSize: ptToSceneUnits(pen.fontSize) } : {}),
    };
}

function scaleElementPens(element: SceneElement): SceneElement {
    switch (element.kind) {
        case "fill":
            return {
                ...element,
                ...(element.pen ? { pen: scalePen(element.pen) } : {}),
                ...(element.drawPen ? { drawPen: scalePen(element.drawPen) } : {}),
            };
        case "raw":
            return element;
        default:
            return {
                ...element,
                ...(element.pen ? { pen: scalePen(element.pen) } : {}),
                ...("fillPen" in element && element.fillPen ? { fillPen: scalePen(element.fillPen) } : {}),
            } as SceneElement;
    }
}

function scaleElementPensInScene(scene: Scene): Scene {
    return { ...scene, elements: scene.elements.map(scaleElementPens) };
}
