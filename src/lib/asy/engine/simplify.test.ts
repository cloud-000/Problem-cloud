import { describe, expect, test } from "bun:test";
import { dedupePoints, simplifyRDP } from "./simplify";
import type { Pair } from "../scene/types";

describe("simplifyRDP", () => {
    test("keeps 2 or fewer points as-is", () => {
        expect(simplifyRDP([[0, 0]], 0.1)).toEqual([[0, 0]]);
        expect(simplifyRDP([[0, 0], [1, 1]], 0.1)).toEqual([[0, 0], [1, 1]]);
    });

    test("collapses a nearly-straight run to its endpoints", () => {
        const line: Pair[] = [[0, 0], [1, 0.001], [2, -0.001], [3, 0], [4, 0]];
        expect(simplifyRDP(line, 0.1)).toEqual([[0, 0], [4, 0]]);
    });

    test("preserves a sharp corner", () => {
        const corner: Pair[] = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]];
        const out = simplifyRDP(corner, 0.1);
        expect(out).toContainEqual([2, 0]); // the corner survives
        expect(out[0]).toEqual([0, 0]);
        expect(out[out.length - 1]).toEqual([2, 2]);
    });

    test("does not mutate its input", () => {
        const input: Pair[] = [[0, 0], [1, 1], [2, 2]];
        const copy = input.map((p) => [...p] as Pair);
        simplifyRDP(input, 0.1);
        expect(input).toEqual(copy);
    });
});

describe("dedupePoints", () => {
    test("drops consecutive duplicates", () => {
        expect(dedupePoints([[0, 0], [0, 0], [1, 1], [1, 1], [2, 2]])).toEqual([
            [0, 0],
            [1, 1],
            [2, 2],
        ]);
    });
});
