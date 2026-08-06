import { describe, expect, test } from "bun:test";
import {
    openTrainerAnchor,
    releasedTrainerAnchor,
    trainerAnchorLeft,
    trainerAnchorWork,
} from "./coach-anchor";

describe("trainer coach anchor", () => {
    test("opens on a problem and releases to nothing", () => {
        const opened = openTrainerAnchor(releasedTrainerAnchor(), 12, false);
        expect(opened).toEqual({ problemId: 12, submitted: false, skipped: false });
        expect(releasedTrainerAnchor().problemId).toBeNull();
    });

    test("carries an already-submitted problem into the anchor", () => {
        expect(openTrainerAnchor(releasedTrainerAnchor(), 12, true).submitted).toBe(true);
    });

    test("re-opening on the same problem keeps a recorded conclusion", () => {
        const concluded = { problemId: 12, submitted: true, skipped: true };
        // Hiding and re-showing the Coach must not reset the sitting: a thread that
        // looked unconcluded again would never be archived off its anchor.
        expect(openTrainerAnchor(concluded, 12, false)).toBe(concluded);
    });

    test("opening on another problem starts a fresh record", () => {
        const concluded = { problemId: 12, submitted: true, skipped: true };
        expect(openTrainerAnchor(concluded, 13, false)).toEqual({
            problemId: 13,
            submitted: false,
            skipped: false,
        });
    });

    test("leaving is decided by the problem on screen, not by visibility", () => {
        const anchor = { problemId: 12, submitted: false, skipped: false };
        expect(trainerAnchorLeft(anchor, 12)).toBe(false);
        expect(trainerAnchorLeft(anchor, 13)).toBe(true);
        expect(trainerAnchorLeft(anchor, null)).toBe(true);
        expect(trainerAnchorLeft(anchor, undefined)).toBe(true);
    });

    test("an unheld anchor is never left", () => {
        expect(trainerAnchorLeft(releasedTrainerAnchor(), 12)).toBe(false);
        expect(trainerAnchorLeft(releasedTrainerAnchor(), null)).toBe(false);
    });

    test("hands the lifecycle rules only the conclusion flags", () => {
        expect(trainerAnchorWork({ problemId: 12, submitted: true, skipped: false })).toEqual({
            submitted: true,
            skipped: false,
        });
    });
});
