import { describe, expect, test } from "bun:test";
import { activeContextSnapshot } from "./registry";
import { CONTEXT_PRIORITY, problemContextLayer } from "./surfaces";

const alias = { id: 501, n: 17, canonical_id: 42, tests: { name: "2023 AMC 12A" } };
const canonical = { id: 42, n: 17, tests: { name: "2023 AMC 10A" } };

describe("problem context layer", () => {
    test("resolves the canonical id for both the fact ref and the descriptor identity", () => {
        const layer = problemContextLayer({
            ownerId: "trainer:problem",
            source: "trainer",
            problem: alias,
            policy: "coaching",
        });

        expect(layer.descriptors[0].ref).toEqual({ kind: "problem", id: 42 });
        expect(layer.descriptors[0].id).toBe("problem:42");
        // problems.n is 0-based: #18 is stored as 17.
        expect(layer.descriptors[0].label).toBe("2023 AMC 12A #18");
    });

    test("two placements of one shared problem collapse to a single fact", () => {
        // The same real problem under two tests. Keying the descriptor on the placement
        // id used to let both register, attaching the same statement twice.
        const snapshot = activeContextSnapshot([
            problemContextLayer({
                ownerId: "trainer:problem",
                source: "trainer",
                problem: alias,
                policy: "coaching",
            }),
            problemContextLayer({
                ownerId: "library:problem",
                source: "selection",
                problem: canonical,
                policy: "coaching",
            }),
        ]);

        expect(snapshot.scope).toEqual([{ kind: "problem", id: 42 }]);
    });

    test("takes its priority from the ladder, so the selection outranks the trainer", () => {
        const trainer = problemContextLayer({
            ownerId: "trainer:problem",
            source: "trainer",
            problem: canonical,
            policy: "test-locked",
        });
        const selection = problemContextLayer({
            ownerId: "library:problem",
            source: "selection",
            problem: canonical,
            policy: "coaching",
        });

        expect(selection.priority).toBeGreaterThan(trainer.priority);
        expect(trainer.priority).toBe(CONTEXT_PRIORITY.trainer);
        expect(activeContextSnapshot([trainer, selection]).policy).toBe("coaching");
    });
});
