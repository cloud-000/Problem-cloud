import { describe, expect, test } from "bun:test";
import {
    HINT_LADDER,
    HINT_LADDER_LENGTH,
    clampHintLevel,
    hintLadderState,
    hintQuickAction,
    hintRungFromActionId,
    nextHintRung,
} from "./hints";
import { PROBLEM_QUICK_ACTIONS, PROBLEM_SUPPORT_ACTIONS } from "./quick-actions";

describe("hint ladder", () => {
    test("rungs are distinct and ordered shallowest first", () => {
        const ids = HINT_LADDER.map((rung) => rung.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids[0]).toBe("nudge");
        expect(ids.at(-1)).toBe("walkthrough");
    });

    test("nextHintRung walks the ladder and then stops", () => {
        for (let level = 0; level < HINT_LADDER_LENGTH; level++) {
            expect(nextHintRung(level)).toBe(HINT_LADDER[level]);
        }
        expect(nextHintRung(HINT_LADDER_LENGTH)).toBeNull();
        expect(nextHintRung(HINT_LADDER_LENGTH + 5)).toBeNull();
    });

    test("a loosely-stored level cannot fall off either end", () => {
        expect(nextHintRung(-1)).toBe(HINT_LADDER[0]);
        expect(nextHintRung(Number.NaN)).toBe(HINT_LADDER[0]);
        expect(clampHintLevel(-3)).toBe(0);
        expect(clampHintLevel(2.7)).toBe(2);
        expect(clampHintLevel(99)).toBe(HINT_LADDER_LENGTH);
    });
});

describe("hintLadderState", () => {
    test("exactly one rung is takeable, and only while the ladder has one left", () => {
        for (let level = 0; level < HINT_LADDER_LENGTH; level++) {
            const takeable = hintLadderState(level).filter((state) => state.next);
            expect(takeable).toHaveLength(1);
            expect(takeable[0].index).toBe(level);
        }
        expect(hintLadderState(HINT_LADDER_LENGTH).some((state) => state.next)).toBe(
            false,
        );
    });

    test("every rung is exactly one of used, next, or locked", () => {
        for (let level = 0; level <= HINT_LADDER_LENGTH; level++) {
            for (const state of hintLadderState(level)) {
                const flags = [state.used, state.next, state.locked].filter(Boolean);
                expect(flags).toHaveLength(1);
            }
        }
    });

    test("taken rungs accumulate behind the next one", () => {
        const state = hintLadderState(2);
        expect(state.filter((rung) => rung.used).map((rung) => rung.index)).toEqual([
            0, 1,
        ]);
        expect(state.filter((rung) => rung.locked).map((rung) => rung.index)).toEqual([
            3,
        ]);
    });

    test("the whole ladder stays visible at every level", () => {
        for (let level = 0; level <= HINT_LADDER_LENGTH; level++) {
            expect(hintLadderState(level)).toHaveLength(HINT_LADDER_LENGTH);
        }
    });
});

describe("hintQuickAction", () => {
    test("offers the next rung under its escalating label", () => {
        const first = hintQuickAction(0);
        expect(first?.label).toBe(HINT_LADDER[0].escalatingLabel);
        expect(first?.prompt).toBe(HINT_LADDER[0].prompt);
        expect(hintQuickAction(1)?.label).toBe(HINT_LADDER[1].escalatingLabel);
    });

    test("ids are stable per rung, so a chip is not remounted mid-stream", () => {
        expect(hintQuickAction(0)?.id).toBe("hint:nudge");
        expect(hintQuickAction(0)?.id).toBe(hintQuickAction(0)?.id);
    });

    test("returns nothing rather than a dead chip once the ladder is spent", () => {
        expect(hintQuickAction(HINT_LADDER_LENGTH)).toBeNull();
    });
});

describe("hintRungFromActionId", () => {
    // The chip has to be recognizable coming back, or the surface that tracks the
    // level cannot spend a rung on the press — which is how the trainer's chip ended
    // up re-sending the nudge under a label promising the next rung.
    test("round-trips every rung the chip can offer", () => {
        for (let level = 0; level < HINT_LADDER_LENGTH; level++) {
            const action = hintQuickAction(level);
            expect(hintRungFromActionId(action!.id)).toBe(HINT_LADDER[level]);
        }
    });

    test("ignores actions that are not ladder rungs", () => {
        // Notably the flat hint, which is a rung's *prompt* but carries no level.
        for (const action of PROBLEM_QUICK_ACTIONS) {
            expect(hintRungFromActionId(action.id)).toBeNull();
        }
        expect(hintRungFromActionId("hint:nonexistent")).toBeNull();
        expect(hintRungFromActionId("")).toBeNull();
    });
});

describe("shared quick actions", () => {
    // The flat hint offered by surfaces that track no level has to ask for the same
    // thing the trainer's first press asks for, or "give me a hint" quietly means two
    // different depths depending on where it was pressed.
    test("the flat problem hint is the ladder's shallowest rung", () => {
        const hint = PROBLEM_QUICK_ACTIONS.find((action) => action.id === "hint");
        expect(hint?.prompt).toBe(HINT_LADDER[0].prompt);
        expect(hint?.label).toBe(HINT_LADDER[0].escalatingLabel);
    });

    test("support actions carry no hint of their own", () => {
        expect(PROBLEM_SUPPORT_ACTIONS.some((action) => action.id === "hint")).toBe(
            false,
        );
        expect(PROBLEM_QUICK_ACTIONS).toHaveLength(PROBLEM_SUPPORT_ACTIONS.length + 1);
    });
});
