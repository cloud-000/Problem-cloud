import { describe, expect, test } from "bun:test";
import { History } from "../../asy/engine/history";
import type { Scene } from "../../asy/scene/types";
import {
    emptyWhiteboardDocument,
    migrateSceneToWhiteboardDocument,
    parsePersistedWhiteboardDocument,
    resolveWhiteboardDocument,
    validateWhiteboardDocument,
    WHITEBOARD_SCHEMA_VERSION,
    type WhiteboardDocument,
} from ".";

const EVERY_ELEMENT_SCENE: Scene = {
    elements: [
        { id: "dot", kind: "dot", at: [1, 2], pen: { namedColor: "red", lineWidth: 4 } },
        {
            id: "path",
            kind: "path",
            path: { nodes: [[0, 0], [2, 3], [4, 0]], joins: ["--", "..", "--"], cyclic: true },
            pen: { dash: { pattern: "linetype(new real[] {2,1})" } },
            fillPen: { color: { r: 0.2, g: 0.4, b: 0.6 }, opacity: 0.5 },
        },
        { id: "circle", kind: "circle", center: [3, 4], radius: 5, strokeEnabled: false },
        { id: "arc", kind: "arc", center: [-1, 2], radius: 3, angle1: 10, angle2: 280 },
        {
            id: "ellipse",
            kind: "ellipse",
            center: [2, 2],
            axisX: [5, 1],
            axisY: [-1, 3],
            fillPen: { namedColor: "blue" },
        },
        {
            id: "elliptical-arc",
            kind: "elliptical-arc",
            center: [0, 0],
            axisX: [4, 2],
            axisY: [1, 3],
            angle1: -20,
            angle2: 95,
        },
        { id: "label", kind: "label", text: "$x^2$", at: [7, 8], align: [0, 1], pen: { fontSize: 16 } },
        {
            id: "fill",
            kind: "fill",
            path: { nodes: [[0, 0], [1, 0], [0, 1]], joins: ["--", "--", "--"], cyclic: true },
            pen: { namedColor: "green" },
            drawPen: { namedColor: "black", lineWidth: 2 },
        },
        { id: "raw", kind: "raw", source: "pair preserved=(1,2);" },
    ],
    meta: { unit: 1.25, source: "import" },
};

describe("whiteboard document foundation", () => {
    test("migrates and resolves every legacy element without changing structure", () => {
        const document = migrateSceneToWhiteboardDocument(EVERY_ELEMENT_SCENE);

        expect(document.schemaVersion).toBe(WHITEBOARD_SCHEMA_VERSION);
        expect(document.items.map((item) => item.kind)).toEqual(
            EVERY_ELEMENT_SCENE.elements.map(() => "baked"),
        );
        expect(resolveWhiteboardDocument(document)).toEqual(EVERY_ELEMENT_SCENE);
        expect(validateWhiteboardDocument(document)).toEqual({ valid: true, errors: [] });
    });

    test("parses V2 deterministically and migrates unversioned V1 scenes", () => {
        const document = migrateSceneToWhiteboardDocument(EVERY_ELEMENT_SCENE);
        const json = JSON.stringify(document);

        expect(parsePersistedWhiteboardDocument(JSON.parse(json))).toEqual(document);
        expect(JSON.stringify(parsePersistedWhiteboardDocument(JSON.parse(json)))).toBe(json);
        expect(parsePersistedWhiteboardDocument(JSON.parse(JSON.stringify(EVERY_ELEMENT_SCENE)))).toEqual(document);
    });

    test("rejects invalid schema and dangling smart references", () => {
        expect(parsePersistedWhiteboardDocument({ schemaVersion: 99, items: [], sketch: {} })).toBeNull();

        const dangling: WhiteboardDocument = {
            ...emptyWhiteboardDocument(),
            items: [{ id: "marker", kind: "sketch-point-marker", pointId: "missing" }],
        };
        const result = validateWhiteboardDocument(dangling);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain("items[0] references missing point missing");
        expect(parsePersistedWhiteboardDocument(dangling)).toBeNull();

        const unknownConstraint = {
            ...emptyWhiteboardDocument(),
            sketch: {
                ...emptyWhiteboardDocument().sketch,
                constraints: {
                    mystery: {
                        id: "mystery",
                        kind: "mystery",
                        enabled: true,
                        origin: "explicit",
                    },
                },
            },
        };
        expect(validateWhiteboardDocument(unknownConstraint).errors).toContain(
            "constraint mystery has unsupported kind mystery",
        );
    });

    test("validates structural path connections and feature compatibility", () => {
        const document: WhiteboardDocument = {
            schemaVersion: 2,
            items: [{
                id: "path-item",
                kind: "sketch-path",
                uses: [
                    { curveId: "a", reversed: false },
                    { curveId: "b", reversed: false },
                ],
                cyclic: false,
            }],
            sketch: {
                points: {
                    p1: { id: "p1", at: [0, 0] },
                    p2: { id: "p2", at: [1, 0] },
                    p3: { id: "p3", at: [2, 0] },
                    p4: { id: "p4", at: [3, 0] },
                },
                parameters: {},
                curves: {
                    a: { id: "a", kind: "segment", start: "p1", end: "p2" },
                    b: { id: "b", kind: "segment", start: "p3", end: "p4" },
                },
                constraints: {
                    bad: {
                        id: "bad",
                        kind: "coincident",
                        enabled: true,
                        origin: "explicit",
                        a: { kind: "curve-point", curveId: "a", feature: "center" },
                        b: { kind: "point", pointId: "p1" },
                    },
                },
            },
        };

        const result = validateWhiteboardDocument(document);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain("items[0] is not a structurally connected path");
        expect(result.errors).toContain("constraint bad.a cannot reference center on segment a");
    });

    test("resolves supported smart presentations from one canonical graph", () => {
        const document: WhiteboardDocument = {
            schemaVersion: 2,
            items: [
                { id: "edge", kind: "sketch-curve", curveId: "segment", pen: { lineWidth: 2 } },
                { id: "center-dot", kind: "sketch-point-marker", pointId: "center" },
                { id: "circle-item", kind: "sketch-curve", curveId: "circle" },
            ],
            sketch: {
                points: {
                    a: { id: "a", at: [0, 0] },
                    b: { id: "b", at: [2, 0] },
                    center: { id: "center", at: [4, 5] },
                },
                parameters: {},
                curves: {
                    segment: { id: "segment", kind: "segment", start: "a", end: "b" },
                    circle: { id: "circle", kind: "circle", center: "center", radius: 3 },
                },
                constraints: {},
            },
        };

        expect(validateWhiteboardDocument(document).valid).toBe(true);
        expect(resolveWhiteboardDocument(document).elements).toEqual([
            {
                id: "edge",
                kind: "path",
                path: { nodes: [[0, 0], [2, 0]], joins: ["--"], cyclic: false },
                pen: { lineWidth: 2 },
            },
            { id: "center-dot", kind: "dot", at: [4, 5] },
            { id: "circle-item", kind: "circle", center: [4, 5], radius: 3 },
        ]);
    });

    test("document snapshots are the history unit and redo is deterministic", () => {
        const history = new History<WhiteboardDocument>();
        const first = emptyWhiteboardDocument();
        const second = migrateSceneToWhiteboardDocument({ elements: [EVERY_ELEMENT_SCENE.elements[0]] });
        const third = migrateSceneToWhiteboardDocument({ elements: [EVERY_ELEMENT_SCENE.elements[1]] });
        history.push(first);
        history.push(second);

        expect(history.undo(third)).toEqual(second);
        expect(history.undo(second)).toEqual(first);
        expect(history.redo(first)).toEqual(second);
    });

    // The former "never silently flattens a smart document through the Phase 1
    // scene operation" test guarded `replaceBakedDocumentScene`, deleted in
    // Phase 3 along with the rest of the Scene→Document merge. Flattening is now
    // structurally impossible: no operation takes a Scene as the document's item
    // list, so there is no path left to guard.
});
