import { describe, expect, test } from "bun:test";
import { recordedTime, selectTimeEndpoint, summarizeTimeRange } from "./test-time-range";
import { TIME_RANGE_HOLD_MS, timeRangeGesture } from "./test-time-range-gesture";

describe("test review time range", () => {
    test("keeps the first endpoint fixed, orders reverse ranges, and includes both endpoints", () => {
        const start = selectTimeEndpoint(null, 3);
        expect(summarizeTimeRange([{}, {}, {}, { elapsedMs: 500 }], start)).toEqual({ from: 3, to: 3, count: 1, totalMs: 500 });
        const range = selectTimeEndpoint(start, 1);
        expect(range).toEqual({ start: 3, end: 1 });
        expect(summarizeTimeRange([
            { elapsedMs: 9000 }, { elapsedMs: 1200 }, { elapsedMs: 0 }, { elapsedMs: 500 },
        ], range)).toEqual({ from: 1, to: 3, count: 3, totalMs: 1700 });
        expect(selectTimeEndpoint(range, 0)).toEqual({ start: 3, end: 0 });
    });

    test("selecting any active problem toggles the range off", () => {
        expect(selectTimeEndpoint({ start: 2, end: 2 }, 2)).toBeNull();
        expect(selectTimeEndpoint({ start: 2, end: 5 }, 2)).toBeNull();
        expect(selectTimeEndpoint({ start: 2, end: 5 }, 5)).toBeNull();
        expect(selectTimeEndpoint({ start: 2, end: 5 }, 3)).toBeNull();
        expect(selectTimeEndpoint({ start: 5, end: 2 }, 3)).toBeNull();
        expect(summarizeTimeRange([], null)).toBeNull();
    });

    test("counts skipped, ungraded, and missing durations without changing the records", () => {
        const history = [
            { elapsedMs: 1000, skipped: true }, { elapsedMs: 0, correct: null }, {}, { elapsedMs: null },
        ];
        const before = structuredClone(history);
        expect(summarizeTimeRange(history, { start: 0, end: 3 })).toEqual({ from: 0, to: 3, count: 4, totalMs: 1000 });
        expect(history).toEqual(before);
        expect(recordedTime(NaN)).toBe(0);
        expect(recordedTime(-100)).toBe(0);
    });
});

function harness() {
    let pending: (() => void) | null = null;
    const endpoints: number[] = [];
    const held: (number | null)[] = [];
    const gesture = timeRangeGesture(index => endpoints.push(index), index => held.push(index), {
        schedule(callback, ms) {
            expect(ms).toBe(TIME_RANGE_HOLD_MS);
            pending = callback;
            return () => { pending = null; };
        },
    });
    return { gesture, endpoints, held, completeHold: () => { const callback = pending; pending = null; callback?.(); } };
}

const touch = { pointerId: 1, clientX: 10, clientY: 10, pointerType: "touch", isPrimary: true };

describe("test review hold gesture", () => {
    test("ordinary taps navigate; a completed hold suppresses exactly its click, regardless of release delay", () => {
        const h = harness();
        h.gesture.down(touch, 2);
        h.gesture.cancel();
        h.completeHold();
        expect(h.endpoints).toEqual([]);
        expect(h.gesture.consumeClick(2)).toBe(false);
        h.gesture.down(touch, 2);
        expect(h.held.at(-1)).toBe(2);
        h.completeHold();
        expect(h.endpoints).toEqual([2]);
        expect(h.held.at(-1)).toBeNull();
        h.gesture.cancel(); // release after any length of time
        expect(h.gesture.consumeClick(2)).toBe(true);
        expect(h.gesture.consumeClick(2)).toBe(false);
    });

    test("movement, pointercancel, and cleanup cancel a pending hold", () => {
        for (const cancel of [
            (h: ReturnType<typeof harness>) => h.gesture.move({ ...touch, clientY: 23 }),
            (h: ReturnType<typeof harness>) => h.gesture.cancel(),
        ]) {
            const h = harness();
            h.gesture.down(touch, 0);
            cancel(h);
            h.completeHold();
            expect(h.endpoints).toEqual([]);
            expect(h.held.at(-1)).toBeNull();
        }
    });

    test("a fresh pointer or keyboard activation cannot inherit a swallowed click", () => {
        const h = harness();
        h.gesture.down(touch, 2);
        h.completeHold();
        h.gesture.cancel();
        h.gesture.down({ ...touch, pointerType: "mouse" }, 2);
        expect(h.gesture.consumeClick(2)).toBe(false);
        h.gesture.down(touch, 2);
        h.completeHold();
        h.gesture.resetClick();
        expect(h.gesture.consumeClick(2)).toBe(false);
    });
});
