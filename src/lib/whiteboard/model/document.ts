import type { Scene, SceneElement } from "../../asy/scene/types";
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

export function isBakedDocument(document: WhiteboardDocument): boolean {
    return document.items.every((item) => item.kind === "baked") &&
        Object.keys(document.sketch.points).length === 0 &&
        Object.keys(document.sketch.parameters).length === 0 &&
        Object.keys(document.sketch.curves).length === 0 &&
        Object.keys(document.sketch.constraints).length === 0;
}

/**
 * Phase 1 operation boundary for the existing Scene-based tools. Smart items are
 * deliberately rejected so a future document can never be flattened silently.
 */
export function replaceBakedDocumentScene(
    document: WhiteboardDocument,
    scene: Scene,
): WhiteboardDocument {
    if (!isBakedDocument(document)) {
        throw new Error("Scene replacement is only valid for an all-baked whiteboard document");
    }
    return migrateSceneToWhiteboardDocument(scene);
}

export function updateBakedElements(
    document: WhiteboardDocument,
    update: (elements: SceneElement[]) => SceneElement[],
): WhiteboardDocument {
    if (!isBakedDocument(document)) {
        throw new Error("Baked element updates require an all-baked whiteboard document");
    }
    return {
        ...document,
        items: update(document.items.map((item) => {
            if (item.kind !== "baked") throw new Error("unreachable non-baked item");
            return item.element;
        })).map((element) => ({ kind: "baked" as const, element })),
    };
}
