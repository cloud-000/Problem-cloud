import { describe, expect, test } from "bun:test";
import {
    workArchivable,
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

    test("a concluded thread is never offered, however recent", () => {
        expect(workResumable(anchorState({ submitted: true, idleMs: 0 }))).toBe(false);
        expect(workResumable(anchorState({ skipped: true, idleMs: 0 }))).toBe(false);
    });
});

describe("archival", () => {
    test("concluded is not archived while the student is still on the problem", () => {
        // Submitting a wrong answer is the moment they most want to ask "why?".
        expect(workArchivable(anchorState({ submitted: true }))).toBe(false);
    });

    test("leaving an unconcluded anchor keeps the thread live", () => {
        expect(workArchivable(anchorState({ leftAnchor: true }))).toBe(false);
    });

    test("both halves together retire the row", () => {
        expect(workArchivable(anchorState({ submitted: true, leftAnchor: true }))).toBe(true);
    });
});
