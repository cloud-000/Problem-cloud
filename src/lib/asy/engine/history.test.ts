import { describe, expect, test } from "bun:test";
import { History } from "./history";

describe("History", () => {
    test("undo/redo walks the snapshot stack", () => {
        const h = new History<string>();
        // states: A -> B -> C
        h.push("A");
        h.push("B");
        let current = "C";

        expect(h.canUndo).toBe(true);
        current = h.undo(current)!; // -> B
        expect(current).toBe("B");
        current = h.undo(current)!; // -> A
        expect(current).toBe("A");
        expect(h.canUndo).toBe(false);
        expect(h.undo(current)).toBeNull();

        current = h.redo(current)!; // -> B
        expect(current).toBe("B");
        current = h.redo(current)!; // -> C
        expect(current).toBe("C");
        expect(h.canRedo).toBe(false);
    });

    test("a new push clears the redo stack", () => {
        const h = new History<string>();
        h.push("A");
        let current = h.undo("B")!; // current now "A", redo has "B"
        expect(h.canRedo).toBe(true);
        h.push(current); // new edit
        expect(h.canRedo).toBe(false);
    });

    test("respects the ring-buffer limit", () => {
        const h = new History<number>(3);
        for (let i = 0; i < 10; i++) h.push(i);
        // Only the last 3 snapshots (7,8,9) are retained.
        let current = 10;
        const seen: number[] = [];
        while (h.canUndo) {
            current = h.undo(current)!;
            seen.push(current);
        }
        expect(seen).toEqual([9, 8, 7]);
    });
});
