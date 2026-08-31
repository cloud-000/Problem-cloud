/**
 * The short first-run tour. Interactive product mocks, no live-control
 * spotlights (`docs/onboarding-and-home.md` §5.1).
 */

export const TOUR_STEP_COUNT = 5;

export type TourStepId = "hello" | "library" | "goals" | "progress" | "trainer";

export type TourStep = {
    id: TourStepId;
    title: string;
    body: string;
};

export const TOUR_STEPS: TourStep[] = [
    {
        id: "hello",
        title: "Hi.",
        body: "A short look at how ProblemCloud is put together. Skip anytime.",
    },
    {
        id: "library",
        title: "Library",
        body: "Problems, tests, and whole series. Switch the tabs.",
    },
    {
        id: "goals",
        title: "Goals",
        body: "A destination for practice. Home follows one lead goal.",
    },
    {
        id: "progress",
        title: "Progress",
        body: "Rating on the left. The series matrix on the right — every problem in a competition.",
    },
    {
        id: "trainer",
        title: "Practice",
        body: "The loop. Whiteboard, Coach, and settings live in the top bar.",
    },
];

export function tourHeading(step: TourStep, username: string | null): string {
    if (step.id !== "hello") return step.title;
    const name = username?.trim();
    return name ? `Hi, ${name}.` : "Hi.";
}

/**
 * The step to show after a cross-device pause. `lastCompleted` is the
 * 0-based index of the last finished step; the next one is shown.
 */
export function resumeTourStep(
    lastCompleted: number | null,
    stepCount = TOUR_STEP_COUNT,
): number {
    if (lastCompleted == null || lastCompleted < 0) return 0;
    return Math.min(lastCompleted + 1, Math.max(stepCount - 1, 0));
}
