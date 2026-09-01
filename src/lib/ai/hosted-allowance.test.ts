import { describe, expect, test } from "bun:test";
import {
    hostedAllowanceSnapshot,
    hostedPeriodLabel,
    hostedRemainingPct,
    hostedResetsOn,
    hostedUsageMenuLabel,
} from "./hosted-allowance";

describe("hosted remaining percent", () => {
    test("is 100 when nothing has been spent", () => {
        expect(hostedRemainingPct({ credits: 0, turns: 0 }, { creditLimit: 200, turnLimit: 50 })).toBe(
            100,
        );
    });

    test("follows the tighter of credits and turns", () => {
        expect(
            hostedRemainingPct({ credits: 100, turns: 5 }, { creditLimit: 200, turnLimit: 50 }),
        ).toBe(50);
        expect(
            hostedRemainingPct({ credits: 10, turns: 40 }, { creditLimit: 200, turnLimit: 50 }),
        ).toBe(20);
    });

    test("is 0 at or past either cap", () => {
        expect(
            hostedRemainingPct({ credits: 200, turns: 1 }, { creditLimit: 200, turnLimit: 50 }),
        ).toBe(0);
        expect(
            hostedRemainingPct({ credits: 0, turns: 50 }, { creditLimit: 200, turnLimit: 50 }),
        ).toBe(0);
        expect(
            hostedRemainingPct({ credits: 250, turns: 1 }, { creditLimit: 200, turnLimit: 50 }),
        ).toBe(0);
    });

    test("does not round a sliver of remaining allowance down to exhausted", () => {
        expect(
            hostedRemainingPct({ credits: 199, turns: 0 }, { creditLimit: 200, turnLimit: 50 }),
        ).toBe(1);
    });
});

describe("hosted period rollover", () => {
    test("a monthly period resets on the first of the next month", () => {
        expect(hostedResetsOn("month", "2026-09-01")).toBe("2026-10-01");
        expect(hostedResetsOn("month", "2026-12-01")).toBe("2027-01-01");
    });

    test("a daily period resets the next UTC day", () => {
        expect(hostedResetsOn("day", "2026-09-18")).toBe("2026-09-19");
        expect(hostedResetsOn("day", "2024-02-29")).toBe("2024-03-01");
    });
});

describe("hosted allowance snapshot", () => {
    test("carries remaining percent and the next reset", () => {
        expect(
            hostedAllowanceSnapshot({
                credits: 50_000,
                turns: 10,
                periodStart: "2026-09-01",
                creditLimit: 200_000,
                turnLimit: 50,
                period: "month",
            }),
        ).toEqual({
            remainingPct: 75,
            credits: 50_000,
            creditLimit: 200_000,
            turns: 10,
            turnLimit: 50,
            period: "month",
            periodStart: "2026-09-01",
            resetsOn: "2026-10-01",
        });
    });

    test("menu copy names remaining percent", () => {
        expect(hostedUsageMenuLabel(50)).toBe("Usage 50% remaining");
        expect(hostedUsageMenuLabel(0)).toBe("Usage 0% remaining");
        expect(hostedPeriodLabel("month")).toBe("this month");
        expect(hostedPeriodLabel("day")).toBe("today");
    });
});
