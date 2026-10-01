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

function strokeHeight(path: NonNullable<ReturnType<typeof brushOutline>>): number {
    const ys = path.nodes.map(([, y]) => y);
    return Math.max(...ys) - Math.min(...ys);
}

function verticalExtent(path: NonNullable<ReturnType<typeof brushOutline>>, nearX: number): number {
    const points = path.nodes.filter(([x]) => Math.abs(x - nearX) < 0.6);
    return Math.max(...points.map(([, y]) => y)) - Math.min(...points.map(([, y]) => y));
}

describe("brushOutline", () => {
    test("is deterministic, cyclic, finite, and has full round caps by default", () => {
        const input = samples([[0, 0], [5, 0], [10, 0], [15, 0], [20, 0]]);
        const first = brushOutline(input, options)!;
        const second = brushOutline(input, options)!;
        expect(first).toEqual(second);
        expect(first.cyclic).toBe(true);
        expect(first.joins).toHaveLength(first.nodes.length);
        expect(first.nodes.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
        // Full round caps preserve stroke diameter at both endpoints without tapering to needle points
        expect(verticalExtent(first, 0)).toBeGreaterThan(options.size * 0.5);
        expect(verticalExtent(first, 20)).toBeGreaterThan(options.size * 0.5);
    });

    test("supports optional taper when configured", () => {
        const input = samples([[0, 0], [5, 0], [10, 0], [15, 0], [20, 0]]);
        const tapered = brushOutline(input, { ...options, taper: true })!;
        expect(verticalExtent(tapered, 10)).toBeGreaterThan(verticalExtent(tapered, 0));
        expect(verticalExtent(tapered, 10)).toBeGreaterThan(verticalExtent(tapered, 20));
    });

    test("pen pressure changes width", () => {
        const points = [[0, 0], [5, 0], [10, 0], [15, 0], [20, 0]] as const;
        const light = brushOutline(samples(points, { pointerType: "pen", pressure: 0.1 }), options)!;
        const heavy = brushOutline(samples(points, { pointerType: "pen", pressure: 1 }), options)!;
        expect(strokeHeight(heavy)).toBeGreaterThan(strokeHeight(light));
    });

    test("mouse width responds to speed and ignores constant browser pressure", () => {
        const points = [[0, 0], [5, 0], [10, 0], [15, 0], [20, 0]] as const;
        const slow = brushOutline(samples(points, { pressure: 0.5, stepMs: 20 }), options)!;
        const fast = brushOutline(samples(points, { pressure: 0.5, stepMs: 1 }), options)!;
        expect(strokeHeight(slow)).toBeGreaterThan(strokeHeight(fast));
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

    test("suppresses outline spikes and normal jitter on curved strokes with noise", () => {
        const curvePoints: [number, number][] = [];
        for (let i = 0; i <= 40; i++) {
            const t = i / 40;
            const x = t * 100;
            const y = Math.sin(t * Math.PI) * 30 + (i % 2 === 0 ? 0.6 : -0.6);
            curvePoints.push([x, y]);
        }
        const outline = brushOutline(samples(curvePoints), options)!;
        expect(outline).not.toBeNull();
        expect(outline.cyclic).toBe(true);
        expect(outline.nodes.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);

        const nodes = outline.nodes;
        for (let i = 0; i < nodes.length; i++) {
            const p0 = nodes[(i - 1 + nodes.length) % nodes.length];
            const p1 = nodes[i];
            const p2 = nodes[(i + 1) % nodes.length];
            const v1 = [p1[0] - p0[0], p1[1] - p0[1]];
            const v2 = [p2[0] - p1[0], p2[1] - p1[1]];
            const l1 = Math.hypot(v1[0], v1[1]);
            const l2 = Math.hypot(v2[0], v2[1]);
            if (l1 > 1e-4 && l2 > 1e-4) {
                const cos = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)));
                const deg = (Math.acos(cos) * 180) / Math.PI;
                expect(deg).toBeLessThan(60);
            }
        }
    });
});
