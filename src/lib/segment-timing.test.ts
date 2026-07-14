import { describe, expect, test } from "bun:test";
import {
    isLastSegment,
    isLocked,
    segmentCount,
    segmentElapsedMs,
    segmentOf,
    segmentRange,
    segmentRemainingMs,
} from "./segment-timing";

describe("segmentCount", () => {
    test("Target: 8 problems in pairs → 4 segments", () => {
        expect(segmentCount(8, 2)).toBe(4);
    });
    test("odd counts round the final segment up", () => {
        expect(segmentCount(7, 2)).toBe(4);
        expect(segmentCount(5, 2)).toBe(3);
    });
    test("Countdown: segmentSize 1 → one segment per problem", () => {
        expect(segmentCount(80, 1)).toBe(80);
        expect(segmentCount(25, 1)).toBe(25);
    });
    test("no problems → no segments", () => {
        expect(segmentCount(0, 2)).toBe(0);
    });
});

describe("segmentOf", () => {
    test("maps problem index to its pair", () => {
        expect(segmentOf(0, 2)).toBe(0);
        expect(segmentOf(1, 2)).toBe(0);
        expect(segmentOf(2, 2)).toBe(1);
        expect(segmentOf(7, 2)).toBe(3);
    });
    test("segmentSize 1 is identity (Countdown)", () => {
        for (let i = 0; i < 5; i += 1) expect(segmentOf(i, 1)).toBe(i);
    });
});

describe("segmentRange", () => {
    test("half-open pair ranges", () => {
        expect(segmentRange(0, 2, 8)).toEqual([0, 2]);
        expect(segmentRange(3, 2, 8)).toEqual([6, 8]);
    });
    test("final short segment is clamped to problemCount", () => {
        // 7 problems, pairs: last segment is a single problem [6, 7).
        expect(segmentRange(3, 2, 7)).toEqual([6, 7]);
    });
    test("segmentSize 1 yields single-problem ranges", () => {
        expect(segmentRange(4, 1, 80)).toEqual([4, 5]);
    });
});

describe("isLocked (no backtrack)", () => {
    test("earlier segments are locked, current and later are not", () => {
        // Currently on segment 1 (problems 2,3) of a paired test.
        expect(isLocked(0, 1, 2)).toBe(true); // segment 0 → locked
        expect(isLocked(1, 1, 2)).toBe(true);
        expect(isLocked(2, 1, 2)).toBe(false); // current segment
        expect(isLocked(3, 1, 2)).toBe(false);
        expect(isLocked(4, 1, 2)).toBe(false); // later segment
    });
    test("nothing is locked on the first segment", () => {
        expect(isLocked(0, 0, 2)).toBe(false);
        expect(isLocked(1, 0, 2)).toBe(false);
    });
});

describe("isLastSegment", () => {
    test("true only for the final pair", () => {
        expect(isLastSegment(3, 8, 2)).toBe(true);
        expect(isLastSegment(2, 8, 2)).toBe(false);
    });
    test("Countdown: final single-problem segment", () => {
        expect(isLastSegment(79, 80, 1)).toBe(true);
        expect(isLastSegment(0, 1, 1)).toBe(true);
    });
});

describe("segmentElapsedMs", () => {
    const elapsed = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000];
    test("sums a pair's problem times (no carry-over between segments)", () => {
        expect(segmentElapsedMs(0, 2, 8, (i) => elapsed[i])).toBe(3000);
        expect(segmentElapsedMs(1, 2, 8, (i) => elapsed[i])).toBe(7000);
        expect(segmentElapsedMs(3, 2, 8, (i) => elapsed[i])).toBe(15000);
    });
    test("segmentSize 1 is just that problem's time", () => {
        expect(segmentElapsedMs(4, 1, 8, (i) => elapsed[i])).toBe(5000);
    });
    test("clamps negative accessor values to 0", () => {
        expect(segmentElapsedMs(0, 2, 8, () => -100)).toBe(0);
    });
});

describe("segmentRemainingMs", () => {
    test("counts down and floors at zero", () => {
        expect(segmentRemainingMs(360, 60_000)).toBe(300_000); // 6 min − 1 min
        expect(segmentRemainingMs(45, 50_000)).toBe(0); // overrun → 0
    });
});
