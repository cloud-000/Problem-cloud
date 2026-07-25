import type { Scene } from "../../asy/scene/types";
import {
    WHITEBOARD_SCHEMA_VERSION,
    type SketchGraph,
    type WhiteboardDocument,
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
    return { ...document, schemaVersion: WHITEBOARD_SCHEMA_VERSION };
}
