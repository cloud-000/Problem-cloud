import { describe, expect, test } from "bun:test";
import { initialFeaturedContest, nextFeaturedContest } from "./welcome-featured";

const names = ["AMC", "MATHCOUNTS", "Purple Comet", "Mandelbrot", "AIME"];

describe("featured contest rotation", () => {
    test("opens with MATHCOUNTS regardless of catalog order", () => {
        expect(initialFeaturedContest(names).name).toBe("MATHCOUNTS");
    });

    test("draws from weighted families even with many other contests", () => {
        const catalog = [...names, ...Array.from({ length: 100 }, (_, i) => `Contest ${i}`)];
        const current = { name: "AMC", changesSinceMathcounts: 0 };
        for (const [draw, expected] of [[0.39, "MATHCOUNTS"], [0.4, "Purple Comet"], [0.55, "Mandelbrot"], [0.7, "AIME"]] as const) {
            let calls = 0;
            expect(nextFeaturedContest(catalog, current, () => calls++ === 0 ? draw : 0).name).toBe(expected);
        }
    });

    test("never repeats consecutively and returns to MATHCOUNTS within three changes", () => {
        let current = initialFeaturedContest(names);
        let absent = 0;
        for (let i = 0; i < 30; i++) {
            const next = nextFeaturedContest(names, current, () => 0.99);
            expect(next.name).not.toBe(current.name);
            absent = next.name === "MATHCOUNTS" ? 0 : absent + 1;
            expect(absent).toBeLessThan(3);
            current = next;
        }
    });

    test("handles empty and single-contest catalogs", () => {
        const current = initialFeaturedContest([]);
        expect(nextFeaturedContest([], current)).toEqual(current);
        const single = initialFeaturedContest(["AMC"]);
        expect(nextFeaturedContest(["AMC"], single)).toEqual(single);
    });
});
