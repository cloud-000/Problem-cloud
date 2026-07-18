import { describe, expect, test } from "bun:test";
import { makePath } from "./factory";
import {
    flattenPath,
    isStraightPathVertexEditable,
    pathCommands,
    pathExtrema,
} from "./path-geometry";

describe("shared path geometry", () => {
    test("only valid all-straight paths qualify for vertex editing", () => {
        expect(isStraightPathVertexEditable(makePath([[0, 0], [1, 1], [2, 0]]))).toBe(true);
        expect(isStraightPathVertexEditable(makePath(
            [[0, 0], [1, 1], [2, 0]],
            { join: ".." },
        ))).toBe(false);
        expect(isStraightPathVertexEditable(makePath(
            [[0, 0], [1, 1], [2, 0]],
            { joins: ["..", "--"] },
        ))).toBe(false);
        expect(isStraightPathVertexEditable({
            nodes: [[0, 0], [1, 1]],
            joins: [],
            cyclic: false,
        })).toBe(false);
    });

    test("straight joins remain exact while curved joins are adaptively flattened", () => {
        const straight = flattenPath(makePath([[0, 0], [2, 0], [2, 2]]), 0.001);
        expect(straight).toEqual([[0, 0], [2, 0], [2, 2]]);

        const curved = flattenPath(makePath(
            [[0, 0], [1, 1], [2, 1], [3, 0]],
            { join: ".." },
        ), 0.001);
        expect(curved.length).toBeGreaterThan(4);
        expect(Math.max(...curved.map((point) => point[1]))).toBeGreaterThan(1.1);
    });

    test("cyclic curves include the rendered closing segment", () => {
        const path = makePath([[0, 0], [2, 0], [1, 1]], { cyclic: true, join: ".." });
        const commands = pathCommands(path);
        const flattened = flattenPath(path, 0.001);

        expect(commands.filter(({ kind }) => kind === "curve")).toHaveLength(3);
        expect(commands.at(-1)?.kind).toBe("close");
        expect(flattened.length).toBeGreaterThan(path.nodes.length + 1);
        expect(flattened.at(-1)).toEqual(flattened[0]);
    });

    test("reports interior cubic extrema", () => {
        const path = makePath([[0, 0], [1, 1], [2, 1], [3, 0]], { join: ".." });
        const extrema = pathExtrema(path);
        expect(Math.max(...extrema.map((point) => point[1]))).toBeCloseTo(1.125, 8);
    });
});
