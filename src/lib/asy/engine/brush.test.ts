import { describe, expect, test } from "bun:test";
import { brushOutline } from "./brush";
import type { PointerSample } from "./tools";

const options = {
    size: 10,
    sceneUnitsPerPixel: 1,
    sampleSpacing: 1,
    smoothing: 0.35,
};

function samples(
    points: readonly (readonly [number, number])[],
    config: { pressure?: number; pointerType?: string; stepMs?: number } = {},
): PointerSample[] {
    return points.map((point, index) => ({
        point,
        timestamp: index * (config.stepMs ?? 16),
        pointerType: config.pointerType ?? "mouse",
        ...(config.pressure === undefined ? {} : { pressure: config.pressure }),
    }));
}

function verticalExtent(path: NonNullable<ReturnType<typeof brushOutline>>, nearX: number): number {
    const points = path.nodes.filter(([x]) => Math.abs(x - nearX) < 0.6);
    return Math.max(...points.map(([, y]) => y)) - Math.min(...points.map(([, y]) => y));
}

describe("brushOutline", () => {
    test("is deterministic, cyclic, tapered, and finite", () => {
        const input = samples([[0, 0], [5, 0], [10, 0], [15, 0], [20, 0]]);
        const first = brushOutline(input, options)!;
        const second = brushOutline(input, options)!;
        expect(first).toEqual(second);
        expect(first.cyclic).toBe(true);
        expect(first.joins).toHaveLength(first.nodes.length);
        expect(first.nodes.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
        expect(verticalExtent(first, 10)).toBeGreaterThan(verticalExtent(first, 0));
        expect(verticalExtent(first, 10)).toBeGreaterThan(verticalExtent(first, 20));
    });

    test("pen pressure changes width", () => {
        const points = [[0, 0], [5, 0], [10, 0], [15, 0], [20, 0]] as const;
        const light = brushOutline(samples(points, { pointerType: "pen", pressure: 0.1 }), options)!;
        const heavy = brushOutline(samples(points, { pointerType: "pen", pressure: 1 }), options)!;
        expect(verticalExtent(heavy, 10)).toBeGreaterThan(verticalExtent(light, 10));
    });

    test("mouse width responds to speed and ignores constant browser pressure", () => {
        const points = [[0, 0], [5, 0], [10, 0], [15, 0], [20, 0]] as const;
        const slow = brushOutline(samples(points, { pressure: 0.5, stepMs: 20 }), options)!;
        const fast = brushOutline(samples(points, { pressure: 0.5, stepMs: 1 }), options)!;
        expect(verticalExtent(slow, 10)).toBeGreaterThan(verticalExtent(fast, 10));
    });

    test("handles duplicates, stationary input, and sharp reversals", () => {
        expect(brushOutline(samples([[1, 1], [1, 1]]), options)).toBeNull();
        const reversal = brushOutline(samples([[0, 0], [4, 0], [0, 0], [0, 4]]), options)!;
        expect(reversal.nodes.length).toBeGreaterThan(4);
        expect(reversal.nodes.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    });

    test("simplifies long committed outlines without losing their silhouette", () => {
        const points = Array.from({ length: 201 }, (_, index) => [index / 2, 0] as const);
        const outline = brushOutline(samples(points), options)!;
        expect(outline.nodes.length).toBeLessThan(40);
        const ys = outline.nodes.map(([, y]) => y);
        expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1);
    });

    test("filters alternating pressure noise into a compact smooth contour", () => {
        const noisy: PointerSample[] = Array.from({ length: 101 }, (_, index) => ({
            point: [index, 0],
            timestamp: index * 16,
            pointerType: "pen",
            pressure: index % 2 === 0 ? 1 : 0.1,
        }));
        const outline = brushOutline(noisy, options)!;
        expect(outline.nodes.length).toBeLessThan(30);
        expect(outline.nodes.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    });
});
