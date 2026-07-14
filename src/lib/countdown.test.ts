import { describe, expect, test } from "bun:test";
import { countdownExpired, countdownRemainingMs } from "./countdown";

describe("countdownRemainingMs", () => {
    test("returns time left before the limit", () => {
        expect(countdownRemainingMs(45_000, 10_000)).toBe(35_000);
    });

    test("floors at zero once the limit is passed", () => {
        expect(countdownRemainingMs(45_000, 45_000)).toBe(0);
        expect(countdownRemainingMs(45_000, 60_000)).toBe(0);
    });

    test("floors fractional milliseconds", () => {
        expect(countdownRemainingMs(1_000, 250.7)).toBe(749);
    });
});

describe("countdownExpired", () => {
    test("false before the limit, true at or after it", () => {
        expect(countdownExpired(45_000, 44_999)).toBe(false);
        expect(countdownExpired(45_000, 45_000)).toBe(true);
        expect(countdownExpired(45_000, 45_001)).toBe(true);
    });
});
