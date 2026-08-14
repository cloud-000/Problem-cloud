import { describe, expect, test } from "bun:test";
import { glickoMatchPreview } from "$lib/library";
import { advanceShadowRating } from "./shadow";

const player = { rating: 1200, rd: 80, matches: 8, last_match_at: null };
const problem = { rating: 1325, rd: 70, attempts: 12 };

describe("offline shadow rating", () => {
    test("moves only by the shared Glicko preview delta", () => {
        const preview = glickoMatchPreview(player, problem);
        expect(advanceShadowRating(1200, player, problem, true)).toBe(
            1200 + preview.deltaWin,
        );
        expect(advanceShadowRating(1200, player, problem, false)).toBe(
            1200 + preview.deltaLoss,
        );
    });

    test("uses the current shadow as the next preview center", () => {
        const first = advanceShadowRating(1200, player, problem, true);
        const preview = glickoMatchPreview({ ...player, rating: first }, problem);
        expect(advanceShadowRating(first, player, problem, false)).toBe(
            first + preview.deltaLoss,
        );
    });
});
