/**
 * First-run acknowledgement. Product facts (sessions, submissions, goals)
 * stay in their own tables; this is only what the student has seen or
 * dismissed (`docs/onboarding-and-home.md` §6).
 */

export const ONBOARDING_CONTENT_VERSION = 1;

export const WELCOME_STATUSES = [
    "unseen",
    "in_progress",
    "completed",
    "dismissed",
] as const;

export type WelcomeStatus = (typeof WELCOME_STATUSES)[number];

export type HomePresentation = "introduction" | "home";

export type OnboardingState = {
    contentVersion: number;
    welcomeStatus: WelcomeStatus;
    lastCompletedTourStep: number | null;
    gettingStartedDismissedAt: string | null;
    acknowledgedTips: string[];
    welcomeStartedAt: string | null;
    welcomeCompletedAt: string | null;
    welcomeDismissedAt: string | null;
};

export function emptyOnboarding(): OnboardingState {
    return {
        contentVersion: ONBOARDING_CONTENT_VERSION,
        welcomeStatus: "unseen",
        lastCompletedTourStep: null,
        gettingStartedDismissedAt: null,
        acknowledgedTips: [],
        welcomeStartedAt: null,
        welcomeCompletedAt: null,
        welcomeDismissedAt: null,
    };
}

export function isWelcomeStatus(value: unknown): value is WelcomeStatus {
    return (
        typeof value === "string" &&
        (WELCOME_STATUSES as readonly string[]).includes(value)
    );
}
