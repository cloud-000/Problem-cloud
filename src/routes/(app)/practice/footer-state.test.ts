import { describe, expect, test } from "bun:test";
import { deriveFooterViewState } from "./footer-state";

const base = {
    gradeImmediately: true,
    isLatest: true,
    submitted: false,
    paused: false,
    focusMode: false,
    canGoBack: true,
};

describe("footer view state", () => {
    for (const [input, mode] of [
        [{ ...base, gradeImmediately: false }, "test"],
        [{ ...base, isLatest: false }, "historical"],
        [{ ...base, submitted: true }, "submitted"],
        [base, "answering"],
    ] as const) {
        test(`derives ${mode} mode`, () => {
            expect(deriveFooterViewState(input).mode).toBe(mode);
        });
    }

    test("accounts for pause, history, and focus-mode controls", () => {
        expect(deriveFooterViewState({ ...base, paused: true }).backDisabled).toBe(true);
        expect(deriveFooterViewState({ ...base, canGoBack: false }).backDisabled).toBe(true);
        expect(deriveFooterViewState({ ...base, focusMode: true, canGoBack: false }).showBack).toBe(false);
        expect(deriveFooterViewState({ ...base, focusMode: true }).compact).toBe(true);
        expect(deriveFooterViewState({ ...base, gradeImmediately: false, isLatest: false }).showForward).toBe(true);
    });
});
