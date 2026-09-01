/**
 * Getting started ranking. Home and tests share this definition of done
 * (`docs/onboarding-and-home.md` §3.2). Product records win; acknowledged
 * tips cover gestures that have no table.
 */

import { GETTING_STARTED_TIP, hasAcknowledgedTip } from "./tips";
import type { OnboardingState } from "./types";

export const GETTING_STARTED_ITEM_IDS = [
    "solve-5",
    "practice-settings",
    "whiteboard",
    "coach",
    "set-goal",
] as const;

export type GettingStartedItemId = (typeof GETTING_STARTED_ITEM_IDS)[number];

export type GettingStartedItem = {
    id: GettingStartedItemId;
    label: string;
    href: string;
    done: boolean;
};

export type GettingStartedInput = {
    attempted: number;
    hasGoal: boolean;
    hasCoachConversation: boolean;
    whiteboardHasContent: boolean;
    acknowledgedTips: readonly string[];
};

export type GettingStartedCard = {
    items: GettingStartedItem[];
    completedCount: number;
    total: number;
};

const PRACTICE_HREF = "/practice";
const NEW_GOAL_HREF = "/goals?new=1";

export function rankGettingStarted(input: GettingStartedInput): GettingStartedCard {
    const items: GettingStartedItem[] = [
        {
            id: "solve-5",
            label: "Solve 5 problems",
            href: PRACTICE_HREF,
            done: input.attempted >= 5,
        },
        {
            id: "practice-settings",
            label: "Try practice settings",
            href: PRACTICE_HREF,
            done: hasAcknowledgedTip(
                input.acknowledgedTips,
                GETTING_STARTED_TIP.practiceSettings,
            ),
        },
        {
            id: "whiteboard",
            label: "Use the whiteboard",
            href: PRACTICE_HREF,
            done:
                hasAcknowledgedTip(
                    input.acknowledgedTips,
                    GETTING_STARTED_TIP.whiteboard,
                ) || input.whiteboardHasContent,
        },
        {
            id: "coach",
            label: "Ask Coach",
            href: PRACTICE_HREF,
            done:
                hasAcknowledgedTip(input.acknowledgedTips, GETTING_STARTED_TIP.coach) ||
                input.hasCoachConversation,
        },
        {
            id: "set-goal",
            label: "Set a goal",
            href: NEW_GOAL_HREF,
            done:
                input.hasGoal ||
                hasAcknowledgedTip(input.acknowledgedTips, GETTING_STARTED_TIP.setGoal),
        },
    ];
    return {
        items,
        completedCount: items.filter((item) => item.done).length,
        total: items.length,
    };
}

export function showGettingStarted(input: {
    welcomeOver: boolean;
    dismissed: boolean;
    card: GettingStartedCard;
}): boolean {
    if (!input.welcomeOver || input.dismissed) return false;
    return input.card.completedCount < input.card.total;
}

export function dismissGettingStarted(
    state: OnboardingState,
    now: string,
): OnboardingState {
    return {
        ...state,
        gettingStartedDismissedAt: state.gettingStartedDismissedAt ?? now,
    };
}
