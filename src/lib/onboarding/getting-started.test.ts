import { describe, expect, test } from "bun:test";
import { emptyOnboarding } from "./types";
import {
    dismissGettingStarted,
    rankGettingStarted,
    showGettingStarted,
} from "./getting-started";
import { GETTING_STARTED_TIP } from "./tips";

const incomplete = {
    attempted: 0,
    hasGoal: false,
    hasCoachConversation: false,
    whiteboardHasContent: false,
    acknowledgedTips: [] as string[],
};

describe("Getting started ranking", () => {
    test("leads with practice and treats a goal as the last item", () => {
        const card = rankGettingStarted(incomplete);
        expect(card.items.map((item) => item.id)).toEqual([
            "solve-5",
            "practice-settings",
            "whiteboard",
            "coach",
            "set-goal",
        ]);
        expect(card.items.map((item) => item.href)).toEqual([
            "/practice",
            "/practice",
            "/practice",
            "/practice",
            "/goals?new=1",
        ]);
        expect(card.completedCount).toBe(0);
        expect(card.total).toBe(5);
    });

    test("solve 5 is attempted count, not skips-on-one-problem", () => {
        expect(rankGettingStarted({ ...incomplete, attempted: 4 }).items[0]?.done).toBe(
            false,
        );
        expect(rankGettingStarted({ ...incomplete, attempted: 5 }).items[0]?.done).toBe(
            true,
        );
    });

    test("a goal row, including archived, completes Set a goal", () => {
        expect(rankGettingStarted({ ...incomplete, hasGoal: true }).items[4]?.done).toBe(
            true,
        );
    });

    test("Coach is done from a conversation row or the send acknowledgement", () => {
        expect(
            rankGettingStarted({ ...incomplete, hasCoachConversation: true }).items[3]
                ?.done,
        ).toBe(true);
        expect(
            rankGettingStarted({
                ...incomplete,
                acknowledgedTips: [GETTING_STARTED_TIP.coach],
            }).items[3]?.done,
        ).toBe(true);
    });

    test("whiteboard is done from local content or the persist acknowledgement", () => {
        expect(
            rankGettingStarted({ ...incomplete, whiteboardHasContent: true }).items[2]
                ?.done,
        ).toBe(true);
        expect(
            rankGettingStarted({
                ...incomplete,
                acknowledgedTips: [GETTING_STARTED_TIP.whiteboard],
            }).items[2]?.done,
        ).toBe(true);
    });

    test("practice settings is acknowledgement only", () => {
        expect(rankGettingStarted(incomplete).items[1]?.done).toBe(false);
        expect(
            rankGettingStarted({
                ...incomplete,
                acknowledgedTips: [GETTING_STARTED_TIP.practiceSettings],
            }).items[1]?.done,
        ).toBe(true);
    });
});

describe("Getting started visibility", () => {
    test("stays off until Welcome is over", () => {
        const card = rankGettingStarted(incomplete);
        expect(
            showGettingStarted({ welcomeOver: false, dismissed: false, card }),
        ).toBe(false);
        expect(
            showGettingStarted({ welcomeOver: true, dismissed: false, card }),
        ).toBe(true);
    });

    test("hides when dismissed or every item is done", () => {
        const card = rankGettingStarted(incomplete);
        expect(
            showGettingStarted({ welcomeOver: true, dismissed: true, card }),
        ).toBe(false);
        const done = rankGettingStarted({
            attempted: 5,
            hasGoal: true,
            hasCoachConversation: true,
            whiteboardHasContent: true,
            acknowledgedTips: [GETTING_STARTED_TIP.practiceSettings],
        });
        expect(done.completedCount).toBe(5);
        expect(
            showGettingStarted({ welcomeOver: true, dismissed: false, card: done }),
        ).toBe(false);
    });

    test("dismissal is sticky and does not reset Welcome", () => {
        const now = "2026-08-31T12:00:00.000Z";
        const started = { ...emptyOnboarding(), welcomeStatus: "completed" as const };
        const dismissed = dismissGettingStarted(started, now);
        expect(dismissed.gettingStartedDismissedAt).toBe(now);
        expect(dismissed.welcomeStatus).toBe("completed");
        expect(dismissGettingStarted(dismissed, "later").gettingStartedDismissedAt).toBe(
            now,
        );
    });
});
