import { describe, expect, test } from "bun:test";
import { emptyOnboarding } from "./types";
import { resumeTourStep, tourHeading, TOUR_STEP_COUNT, TOUR_STEPS } from "./tour";
import {
    completeTourStep,
    completeWelcome,
    decideHomePresentation,
    hasProductHistory,
    skipWelcome,
    startTour,
    tourWritesWelcomeState,
} from "./welcome";

describe("the short tour", () => {
    test("has five product-mock steps ending on the trainer", () => {
        expect(TOUR_STEPS).toHaveLength(TOUR_STEP_COUNT);
        expect(TOUR_STEPS.map((step) => step.id)).toEqual([
            "hello",
            "library",
            "goals",
            "progress",
            "trainer",
        ]);
        expect(TOUR_STEPS[4]?.title).toBe("Practice");
        expect(TOUR_STEPS.map((step) => step.nav)).toEqual([
            "home",
            "library",
            "goals",
            "progress",
            "practice",
        ]);
        expect(tourHeading(TOUR_STEPS[0]!, "Alex")).toBe("Hi, Alex.");
        expect(tourHeading(TOUR_STEPS[0]!, "  ")).toBe("Hi.");
        expect(tourHeading(TOUR_STEPS[1]!, "Alex")).toBe("Library");
    });

    test("resumes on the step after the last completed one", () => {
        expect(resumeTourStep(null)).toBe(0);
        expect(resumeTourStep(-1)).toBe(0);
        expect(resumeTourStep(0)).toBe(1);
        expect(resumeTourStep(3)).toBe(4);
        expect(resumeTourStep(4)).toBe(4);
        expect(resumeTourStep(99)).toBe(4);
    });
});

describe("product history", () => {
    test("a brand-new account with only the root session is not history", () => {
        expect(
            hasProductHistory({ attempted: 0, seen: 0, sessionTimesSeen: 0 }),
        ).toBe(false);
    });

    test("a graded submission, a seen problem, or session work counts", () => {
        expect(
            hasProductHistory({ attempted: 1, seen: 0, sessionTimesSeen: 0 }),
        ).toBe(true);
        expect(
            hasProductHistory({ attempted: 0, seen: 2, sessionTimesSeen: 0 }),
        ).toBe(true);
        expect(
            hasProductHistory({ attempted: 0, seen: 0, sessionTimesSeen: 1 }),
        ).toBe(true);
    });
});

describe("Home presentation", () => {
    test("unseen with no history opens the tour", () => {
        expect(
            decideHomePresentation({ status: "unseen", hasProductHistory: false }),
        ).toBe("introduction");
    });

    test("unseen with history skips Welcome so existing accounts are not reset", () => {
        expect(
            decideHomePresentation({ status: "unseen", hasProductHistory: true }),
        ).toBe("home");
    });

    test("in_progress always resumes the tour", () => {
        expect(
            decideHomePresentation({
                status: "in_progress",
                hasProductHistory: true,
            }),
        ).toBe("introduction");
        expect(
            decideHomePresentation({
                status: "in_progress",
                hasProductHistory: false,
            }),
        ).toBe("introduction");
    });

    test("completed and dismissed both leave Welcome mode", () => {
        expect(
            decideHomePresentation({
                status: "completed",
                hasProductHistory: false,
            }),
        ).toBe("home");
        expect(
            decideHomePresentation({
                status: "dismissed",
                hasProductHistory: false,
            }),
        ).toBe("home");
    });
});

describe("Welcome status patches", () => {
    const now = "2026-08-31T12:00:00.000Z";

    test("taking the tour records in_progress without clobbering a prior start", () => {
        const started = startTour(emptyOnboarding(), now);
        expect(started.welcomeStatus).toBe("in_progress");
        expect(started.welcomeStartedAt).toBe(now);
        expect(startTour(started, "later").welcomeStartedAt).toBe(now);
    });

    test("completing a step is monotonic", () => {
        const mid = completeTourStep(emptyOnboarding(), 1);
        expect(mid.lastCompletedTourStep).toBe(1);
        expect(completeTourStep(mid, 0).lastCompletedTourStep).toBe(1);
        expect(completeTourStep(mid, 2).lastCompletedTourStep).toBe(2);
    });

    test("skip and complete are terminal and keep their first timestamp", () => {
        const skipped = skipWelcome(emptyOnboarding(), now);
        expect(skipped.welcomeStatus).toBe("dismissed");
        expect(skipWelcome(skipped, "later").welcomeDismissedAt).toBe(now);

        const done = completeWelcome(emptyOnboarding(), now);
        expect(done.welcomeStatus).toBe("completed");
        expect(done.lastCompletedTourStep).toBe(TOUR_STEP_COUNT - 1);
        expect(completeWelcome(done, "later").welcomeCompletedAt).toBe(now);
    });

    test("a Help replay writes Welcome state only before the tour has finished", () => {
        expect(tourWritesWelcomeState("unseen")).toBe(true);
        expect(tourWritesWelcomeState("unseen", true)).toBe(false);
        expect(tourWritesWelcomeState("in_progress")).toBe(true);
        expect(tourWritesWelcomeState("in_progress", true)).toBe(true);
        expect(tourWritesWelcomeState("completed")).toBe(false);
        expect(tourWritesWelcomeState("dismissed")).toBe(false);
    });
});
