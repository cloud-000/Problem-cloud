import { describe, expect, test } from "bun:test";
import type { Scene } from "../../asy/scene/types";
import {
    addCoincidentConstraint,
    appendSmartPathNode,
    closeSmartPath,
    createSmartPath,
    createSmartPointMarker,
    deleteWhiteboardItems,
    discoverPointFeatures,
    emptyWhiteboardDocument,
    nearestPointFeature,
    pathNodeFeature,
    removeConstraint,
    resolveWhiteboardDocument,
    solveWhiteboardDocument,
    validateWhiteboardDocument,
} from ".";

describe("whiteboard smart geometry phase 2", () => {
    test("creates canonical smart lines, rectangles, and explicit points", () => {
        const line = createSmartPath(
            emptyWhiteboardDocument(),
            [[0, 0], [2, 1]],
            false,
            { namedColor: "red" },
        );
        const rectangle = createSmartPath(
            line.document,
            [[3, 0], [5, 0], [5, 2], [3, 2]],
            true,
            { lineWidth: 2 },
            { namedColor: "gray" },
        );
        const marker = createSmartPointMarker(rectangle.document, [7, 8], { lineWidth: 4 });

        expect(marker.document.items.map((item) => item.kind)).toEqual([
            "sketch-path",
            "sketch-path",
            "sketch-point-marker",
        ]);
        expect(Object.keys(marker.document.sketch.curves)).toHaveLength(5);
        expect(resolveWhiteboardDocument(marker.document).elements).toMatchObject([
            { kind: "path", path: { nodes: [[0, 0], [2, 1]], cyclic: false } },
            { kind: "path", path: { nodes: [[3, 0], [5, 0], [5, 2], [3, 2]], cyclic: true } },
            { kind: "dot", at: [7, 8] },
        ]);
        expect(validateWhiteboardDocument(marker.document)).toEqual({ valid: true, errors: [] });
    });

    test("discovers stable segment endpoint and explicit-point features", () => {
        const line = createSmartPath(emptyWhiteboardDocument(), [[0, 0], [2, 0]], false);
        const marker = createSmartPointMarker(line.document, [2.1, 0]);
        const features = discoverPointFeatures(marker.document);

        expect(features.map((feature) => feature.kind).sort()).toEqual([
            "endpoint",
            "endpoint",
            "explicit-point",
        ]);
        expect(pathNodeFeature(marker.document, line.itemId, 1)).toEqual(line.endpointFeatures[1]);
        expect(nearestPointFeature(marker.document, [2.1, 0], 0.2)?.kind).toBe("explicit-point");
    });

    test("conjoined endpoints follow either driver and relation deletion separates them", () => {
        const first = createSmartPath(emptyWhiteboardDocument(), [[0, 0], [1, 0]], false);
        const second = createSmartPath(first.document, [[3, 0], [4, 0]], false);
        const a = first.endpointFeatures[1];
        const b = second.endpointFeatures[0];
        const conjoined = addCoincidentConstraint(second.document, a, b);
        expect(conjoined).not.toBeNull();
        if (!conjoined) return;

        const dragged = solveWhiteboardDocument(conjoined, {
            affected: [a],
            drivers: [{ feature: a, target: [6, 5] }],
            mode: "commit",
        });
        expect(dragged.document).toBeDefined();
        if (!dragged.document) return;
        const scene = resolveWhiteboardDocument(dragged.document);
        const firstLine = scene.elements[0];
        const secondLine = scene.elements[1];
        expect(firstLine.kind).toBe("path");
        expect(secondLine.kind).toBe("path");
        if (firstLine.kind !== "path" || secondLine.kind !== "path") return;
        expect(firstLine.path.nodes[1][0]).toBeCloseTo(6, 1);
        expect(firstLine.path.nodes[1][1]).toBeCloseTo(5, 1);
        expect(secondLine.path.nodes[0][0]).toBeCloseTo(firstLine.path.nodes[1][0], 7);
        expect(secondLine.path.nodes[0][1]).toBeCloseTo(firstLine.path.nodes[1][1], 7);
        const separatedAt = secondLine.path.nodes[0];

        const constraintId = Object.keys(dragged.document.sketch.constraints)[0];
        const separated = removeConstraint(dragged.document, constraintId);
        const movedAgain = solveWhiteboardDocument(separated, {
            affected: [a],
            drivers: [{ feature: a, target: [8, 7] }],
            mode: "commit",
        }).document!;
        const separatedScene = resolveWhiteboardDocument(movedAgain);
        const movedFirst = separatedScene.elements[0];
        const stationarySecond = separatedScene.elements[1];
        expect(movedFirst.kind).toBe("path");
        expect(stationarySecond.kind).toBe("path");
        if (movedFirst.kind !== "path" || stationarySecond.kind !== "path") return;
        expect(movedFirst.path.nodes[1][0]).toBeCloseTo(8, 1);
        expect(movedFirst.path.nodes[1][1]).toBeCloseTo(7, 1);
        expect(stationarySecond.path.nodes[0]).toEqual(separatedAt);
    });

    test("continues and closes one structural smart path without array-index references", () => {
        const initial = createSmartPath(emptyWhiteboardDocument(), [[0, 0], [1, 0]], false);
        const appended = appendSmartPathNode(initial.document, initial.itemId, [1, 1]);
        const closed = closeSmartPath(appended.document, initial.itemId);

        expect(resolveWhiteboardDocument(closed).elements[0]).toMatchObject({
            kind: "path",
            path: { nodes: [[0, 0], [1, 0], [1, 1]], cyclic: true },
        });
        expect(validateWhiteboardDocument(closed).valid).toBe(true);
    });

    // The former "keeps baked edits compatible in a mixed document and rejects
    // smart flattening" test covered `reconcileResolvedScene`, the Scene→Document
    // merge retired in Phase 3. Tool commits are now lifted to targeted document
    // transactions instead, so the equivalent guarantee — a baked edit in a mixed
    // document leaves the smart item untouched — is asserted at the store layer
    // in `state/whiteboard.test.ts`.

    test("deleting the last presentation removes orphan geometry and its relation atomically", () => {
        const first = createSmartPath(emptyWhiteboardDocument(), [[0, 0], [1, 0]], false);
        const second = createSmartPath(first.document, [[1, 0], [2, 0]], false);
        const conjoined = addCoincidentConstraint(
            second.document,
            first.endpointFeatures[1],
            second.endpointFeatures[0],
        )!;
        const deleted = deleteWhiteboardItems(conjoined, [first.itemId]);

        expect(deleted.items.map((item) => item.kind === "baked" ? item.element.id : item.id)).toEqual([second.itemId]);
        expect(Object.keys(deleted.sketch.constraints)).toHaveLength(0);
        expect(validateWhiteboardDocument(deleted).valid).toBe(true);
    });
});
