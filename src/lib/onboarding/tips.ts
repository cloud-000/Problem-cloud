/**
 * One-time acknowledgement ids. Gesture tips (`getting-started:…`) complete
 * Getting started items that have no product table. Feature tips (`tip:…`)
 * are the contextual introductions in `docs/onboarding-and-home.md` §5.2.
 */

import type { OnboardingState } from "./types";

export const GETTING_STARTED_TIP = {
    practiceSettings: "getting-started:practice-settings",
    whiteboard: "getting-started:whiteboard",
    coach: "getting-started:coach",
} as const;

export const CONTEXTUAL_TIP = {
    firstProgress: "tip:first-progress",
    firstReview: "tip:first-review",
    firstMatrix: "tip:first-matrix",
    firstGoal: "tip:first-goal",
} as const;

export type GettingStartedTipId =
    (typeof GETTING_STARTED_TIP)[keyof typeof GETTING_STARTED_TIP];
export type ContextualTipId = (typeof CONTEXTUAL_TIP)[keyof typeof CONTEXTUAL_TIP];
export type OnboardingTipId = GettingStartedTipId | ContextualTipId;

export const WHITEBOARD_ONBOARDING_KEYS = [
    "whiteboard:scratch",
    "whiteboard:page",
] as const;

export function isWhiteboardOnboardingKey(key: string): boolean {
    return (WHITEBOARD_ONBOARDING_KEYS as readonly string[]).includes(key);
}

export function hasAcknowledgedTip(
    acknowledgedTips: readonly string[],
    tipId: OnboardingTipId,
): boolean {
    return acknowledgedTips.includes(tipId);
}

export function withAcknowledgedTip(
    acknowledgedTips: readonly string[],
    tipId: OnboardingTipId,
): string[] {
    if (acknowledgedTips.includes(tipId)) return [...acknowledgedTips];
    return [...acknowledgedTips, tipId];
}

export function acknowledgeTipInState(
    state: OnboardingState,
    tipId: OnboardingTipId,
): OnboardingState {
    if (hasAcknowledgedTip(state.acknowledgedTips, tipId)) return state;
    return {
        ...state,
        acknowledgedTips: withAcknowledgedTip(state.acknowledgedTips, tipId),
    };
}

export type ContextualTipCopy = {
    id: ContextualTipId;
    body: string;
};

const TIP_COPY: Record<ContextualTipId, string> = {
    [CONTEXTUAL_TIP.firstProgress]:
        "Each graded attempt is counted on Progress, so you can see what still needs work.",
    [CONTEXTUAL_TIP.firstReview]:
        "A problem comes back when it is due, so you see it again before it fades.",
    [CONTEXTUAL_TIP.firstMatrix]:
        "Each cell is one problem. Color is how it went; select a cell to open it.",
    [CONTEXTUAL_TIP.firstGoal]:
        "Practicing this goal starts a session in that material, not the whole catalog.",
};

export function contextualTipCopy(id: ContextualTipId): ContextualTipCopy {
    return { id, body: TIP_COPY[id] };
}

export type HomeContextualTipInput = {
    acknowledgedTips: readonly string[];
    attempted: number;
    reviewDue: number;
    hasGoal: boolean;
};

/**
 * At most one Home tip, so Progressive guidance does not stack. Review is
 * more specific than the first Progress appearance; a new goal is quieter
 * than either.
 */
export function homeContextualTip(
    input: HomeContextualTipInput,
): ContextualTipId | null {
    const { acknowledgedTips, attempted, reviewDue, hasGoal } = input;
    if (reviewDue > 0 && !hasAcknowledgedTip(acknowledgedTips, CONTEXTUAL_TIP.firstReview)) {
        return CONTEXTUAL_TIP.firstReview;
    }
    if (
        attempted > 0 &&
        !hasAcknowledgedTip(acknowledgedTips, CONTEXTUAL_TIP.firstProgress)
    ) {
        return CONTEXTUAL_TIP.firstProgress;
    }
    if (hasGoal && !hasAcknowledgedTip(acknowledgedTips, CONTEXTUAL_TIP.firstGoal)) {
        return CONTEXTUAL_TIP.firstGoal;
    }
    return null;
}

export function shouldShowTip(
    acknowledgedTips: readonly string[],
    tipId: ContextualTipId,
    ready: boolean,
): boolean {
    return ready && !hasAcknowledgedTip(acknowledgedTips, tipId);
}
