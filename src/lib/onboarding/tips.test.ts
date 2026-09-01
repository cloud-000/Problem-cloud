import { describe, expect, test } from "bun:test";
import {
    CONTEXTUAL_TIP,
    GETTING_STARTED_TIP,
    contextualTipCopy,
    hasAcknowledgedTip,
    homeContextualTip,
    isWhiteboardOnboardingKey,
    shouldShowTip,
    withAcknowledgedTip,
} from "./tips";

describe("tip ids", () => {
    test("Getting started gestures use the getting-started prefix", () => {
        expect(GETTING_STARTED_TIP.coach).toBe("getting-started:coach");
        expect(GETTING_STARTED_TIP.practiceSettings).toBe(
            "getting-started:practice-settings",
        );
        expect(GETTING_STARTED_TIP.whiteboard).toBe("getting-started:whiteboard");
        expect(GETTING_STARTED_TIP.setGoal).toBe("getting-started:set-goal");
    });

    test("whiteboard persist only counts scratch and page keys", () => {
        expect(isWhiteboardOnboardingKey("whiteboard:scratch")).toBe(true);
        expect(isWhiteboardOnboardingKey("whiteboard:page")).toBe(true);
        expect(isWhiteboardOnboardingKey("figure:annotations:abc:12")).toBe(false);
    });

    test("append is idempotent", () => {
        const once = withAcknowledgedTip([], CONTEXTUAL_TIP.firstReview);
        const twice = withAcknowledgedTip(once, CONTEXTUAL_TIP.firstReview);
        expect(once).toEqual(["tip:first-review"]);
        expect(twice).toEqual(["tip:first-review"]);
        expect(hasAcknowledgedTip(twice, CONTEXTUAL_TIP.firstReview)).toBe(true);
    });
});

describe("Home contextual tip ranking", () => {
    const fresh = {
        acknowledgedTips: [] as string[],
        attempted: 0,
        reviewDue: 0,
        hasGoal: false,
    };

    test("stays off with no history", () => {
        expect(homeContextualTip(fresh)).toBeNull();
    });

    test("first Progress appears after the first graded attempt", () => {
        expect(homeContextualTip({ ...fresh, attempted: 1 })).toBe(
            CONTEXTUAL_TIP.firstProgress,
        );
    });

    test("first review outranks first Progress when review is due", () => {
        expect(
            homeContextualTip({ ...fresh, attempted: 2, reviewDue: 1 }),
        ).toBe(CONTEXTUAL_TIP.firstReview);
    });

    test("a new goal is the quiet leftover when Progress is already explained", () => {
        expect(
            homeContextualTip({
                acknowledgedTips: [CONTEXTUAL_TIP.firstProgress],
                attempted: 3,
                reviewDue: 0,
                hasGoal: true,
            }),
        ).toBe(CONTEXTUAL_TIP.firstGoal);
    });

    test("nothing remains after every Home tip is acknowledged", () => {
        expect(
            homeContextualTip({
                acknowledgedTips: [
                    CONTEXTUAL_TIP.firstProgress,
                    CONTEXTUAL_TIP.firstReview,
                    CONTEXTUAL_TIP.firstGoal,
                ],
                attempted: 6,
                reviewDue: 2,
                hasGoal: true,
            }),
        ).toBeNull();
    });
});

describe("surface tips", () => {
    test("Review and matrix wait until the surface is actually ready", () => {
        expect(shouldShowTip([], CONTEXTUAL_TIP.firstMatrix, false)).toBe(false);
        expect(shouldShowTip([], CONTEXTUAL_TIP.firstMatrix, true)).toBe(true);
        expect(
            shouldShowTip(
                [CONTEXTUAL_TIP.firstMatrix],
                CONTEXTUAL_TIP.firstMatrix,
                true,
            ),
        ).toBe(false);
    });

    test("copy explains a consequence, not the layout", () => {
        expect(contextualTipCopy(CONTEXTUAL_TIP.firstReview).body).toContain(
            "comes back",
        );
        expect(contextualTipCopy(CONTEXTUAL_TIP.firstMatrix).body).toContain(
            "cell",
        );
        expect(contextualTipCopy(CONTEXTUAL_TIP.firstGoal).body).toContain(
            "session",
        );
    });
});
