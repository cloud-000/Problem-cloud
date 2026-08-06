import { describe, expect, test } from "bun:test";
import {
    workRetirable,
    workConcluded,
    workResumable,
    WORK_STALE_AFTER_MS,
    type WorkAnchorState,
} from "./lifecycle";

const anchorState = (overrides: Partial<WorkAnchorState> = {}): WorkAnchorState => ({
    submitted: false,
    skipped: false,
    leftAnchor: false,
    idleMs: 0,
    ...overrides,
});

describe("work conclusion", () => {
    test("an open problem has not concluded", () => {
        expect(workConcluded(anchorState())).toBe(false);
    });

    test("submitting concludes the work", () => {
        expect(workConcluded(anchorState({ submitted: true }))).toBe(true);
    });

    test("skipping concludes it too", () => {
        // A skip writes a real submissions row and is an explicit "I'm done with this".
        // Left out, its thread would hold the anchor's index slot until staleness or a
        // return visit cleared it.
        expect(workConcluded(anchorState({ skipped: true }))).toBe(true);
    });
});

describe("resumability", () => {
    test("an abandoned thread is offered back while it is fresh", () => {
        expect(workResumable(anchorState({ idleMs: 60_000 }))).toBe(true);
    });

    test("staleness retires an offer nothing else would ever retire", () => {
        // Without the cutoff an unconcluded thread stays offerable forever, and the root
        // practice session never ends — so returning to a problem next week would prompt
        // over a conversation the student has entirely forgotten.
        expect(workResumable(anchorState({ idleMs: WORK_STALE_AFTER_MS + 1 }))).toBe(false);
    });

    test("a concluded thread is still offered — that is the one worth reviewing", () => {
        // The chat about a problem you just got wrong is the chat you most want back.
        expect(workResumable(anchorState({ submitted: true, idleMs: 0 }))).toBe(true);
        expect(workResumable(anchorState({ skipped: true, idleMs: 0 }))).toBe(true);
        // Staleness still applies to it, exactly as to an unconcluded one.
        expect(
            workResumable(anchorState({ submitted: true, idleMs: WORK_STALE_AFTER_MS + 1 })),
        ).toBe(false);
    });
});

describe("retirement", () => {
    test("concluded is not retired while the student is still on the problem", () => {
        // Submitting a wrong answer is the moment they most want to ask "why?".
        expect(workRetirable(anchorState({ submitted: true }))).toBe(false);
    });

    test("leaving an unconcluded anchor keeps the thread live", () => {
        expect(workRetirable(anchorState({ leftAnchor: true }))).toBe(false);
    });

    test("both halves together retire the row", () => {
        expect(workRetirable(anchorState({ submitted: true, leftAnchor: true }))).toBe(true);
    });
});
