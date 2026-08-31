/**
 * Which Home presentation to show, and the Welcome-status patches that
 * produce it. Ranking lives here so the page cannot invent a third mode.
 */

import { type OnboardingState, type HomePresentation, type WelcomeStatus } from "./types";
import { TOUR_STEP_COUNT } from "./tour";

export type ProductHistoryInput = {
    attempted: number;
    seen: number;
    sessionTimesSeen: number;
};

export function hasProductHistory(input: ProductHistoryInput): boolean {
    return input.attempted > 0 || input.seen > 0 || input.sessionTimesSeen > 0;
}

/**
 * Welcome is first-login guidance. Unseen accounts with no practice
 * history open the tour immediately; Skip on the tour is the way out.
 * Existing accounts that already have practice history skip it even
 * when no onboarding row exists yet, so shipping this table does not
 * replay the tour for established students.
 *
 * `in_progress` always resumes the tour, including on a second device.
 */
export function decideHomePresentation(input: {
    status: WelcomeStatus;
    hasProductHistory: boolean;
}): HomePresentation {
    if (input.status === "completed" || input.status === "dismissed") {
        return "home";
    }
    if (input.status === "unseen" && input.hasProductHistory) return "home";
    return "introduction";
}

/** First-run tour writes Welcome status; a Help replay of an already-finished tour does not. */
export function tourWritesWelcomeState(
    status: WelcomeStatus,
    hasHistory = false,
): boolean {
    if (status === "completed" || status === "dismissed") return false;
    if (status === "in_progress") return true;
    return !hasHistory;
}

export function startTour(state: OnboardingState, now: string): OnboardingState {
    return {
        ...state,
        welcomeStatus: "in_progress",
        welcomeStartedAt: state.welcomeStartedAt ?? now,
    };
}

export function completeTourStep(
    state: OnboardingState,
    stepIndex: number,
): OnboardingState {
    const clamped = Math.max(0, Math.min(Math.floor(stepIndex), TOUR_STEP_COUNT - 1));
    const previous = state.lastCompletedTourStep;
    return {
        ...state,
        lastCompletedTourStep:
            previous == null ? clamped : Math.max(previous, clamped),
    };
}

export function skipWelcome(state: OnboardingState, now: string): OnboardingState {
    return {
        ...state,
        welcomeStatus: "dismissed",
        welcomeDismissedAt: state.welcomeDismissedAt ?? now,
    };
}

export function completeWelcome(
    state: OnboardingState,
    now: string,
): OnboardingState {
    return {
        ...state,
        welcomeStatus: "completed",
        welcomeCompletedAt: state.welcomeCompletedAt ?? now,
        lastCompletedTourStep: TOUR_STEP_COUNT - 1,
    };
}
