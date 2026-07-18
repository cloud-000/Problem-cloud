import { describe, expect, test } from "bun:test";
import type { Pair } from "../scene/types";
import { PointerSampleBatcher } from "./pointer-sample-batcher";

function harness() {
    const callbacks = new Map<number, () => void>();
    const cancelled: number[] = [];
    const batches: Pair[][] = [];
    let nextHandle = 1;
    const batcher = new PointerSampleBatcher(
        (points) => batches.push([...points]),
        (callback) => {
            const handle = nextHandle++;
            callbacks.set(handle, callback);
            return handle;
        },
        (handle) => {
            cancelled.push(handle);
            callbacks.delete(handle);
        },
    );
    return { batcher, batches, callbacks, cancelled };
}

describe("PointerSampleBatcher", () => {
    test("coalesces browser batches into one dispatch per frame", () => {
        const { batcher, batches, callbacks } = harness();
        batcher.add([[0, 0], [1, 1]]);
        batcher.add([[2, 2], [3, 3]]);
        expect(callbacks).toHaveLength(1);
        callbacks.values().next().value?.();
        expect(batches).toEqual([[[0, 0], [1, 1], [2, 2], [3, 3]]]);
    });

    test("pointer-up can synchronously drain pending samples once", () => {
        const { batcher, batches, callbacks, cancelled } = harness();
        const released: Pair[][] = [];
        batcher.add([[1, 0], [2, 0]]);
        expect(batcher.flushWith((points) => released.push([...points]))).toBe(true);
        expect(released).toEqual([[[1, 0], [2, 0]]]);
        expect(batches).toEqual([]);
        expect(callbacks).toHaveLength(0);
        expect(cancelled).toEqual([1]);
        expect(batcher.flushWith(() => {})).toBe(false);
    });

    test("cancellation drops pending input and its frame callback", () => {
        const { batcher, batches, callbacks, cancelled } = harness();
        batcher.add([[1, 1]]);
        batcher.cancel();
        expect(callbacks).toHaveLength(0);
        expect(cancelled).toEqual([1]);
        expect(batcher.flush()).toBe(false);
        expect(batches).toEqual([]);
    });
});
