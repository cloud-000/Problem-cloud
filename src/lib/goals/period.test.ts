import { describe, expect, test } from "bun:test";
import { calendarPeriodStart, isPeriodFinishable, volumeRange } from "./period";

const at = (iso: string) => new Date(iso);

describe("rolling and since-creation periods", () => {
    test("a rolling window starts N days before now and stays open", () => {
        const range = volumeRange(
            { kind: "rolling", days: 7 },
            { now: at("2026-08-10T15:30:00Z"), createdAt: "2026-01-01T00:00:00Z" },
        );
        expect(range.from).toBe("2026-08-03T15:30:00.000Z");
        // Left open rather than pinned to `now`: two evaluations a second apart
        // must not disagree.
        expect(range.to).toBeNull();
    });

    test("since-creation starts at the goal's own creation", () => {
        const range = volumeRange(
            { kind: "since_creation" },
            { now: at("2026-08-10T15:30:00Z"), createdAt: "2026-07-04T09:00:00Z" },
        );
        expect(range.from).toBe("2026-07-04T09:00:00Z");
        expect(range.to).toBeNull();
    });

    test("only calendar periods re-evaluate each cycle", () => {
        expect(isPeriodFinishable({ kind: "rolling", days: 7 })).toBe(true);
        expect(isPeriodFinishable({ kind: "since_creation" })).toBe(true);
        expect(
            isPeriodFinishable({
                kind: "calendar",
                unit: "week",
                timeZone: "UTC",
            }),
        ).toBe(false);
    });
});

describe("calendar periods", () => {
    test("a week starts on the preceding Monday, at local midnight", () => {
        // 2026-08-10T12:00Z is a Monday; the week starts that same morning.
        expect(
            calendarPeriodStart("week", at("2026-08-10T12:00:00Z"), "UTC").toISOString(),
        ).toBe("2026-08-10T00:00:00.000Z");
        // A Sunday belongs to the week that began six days earlier, not the
        // one starting tomorrow.
        expect(
            calendarPeriodStart("week", at("2026-08-16T23:00:00Z"), "UTC").toISOString(),
        ).toBe("2026-08-10T00:00:00.000Z");
    });

    test("a month starts on the first, at local midnight", () => {
        expect(
            calendarPeriodStart("month", at("2026-08-10T12:00:00Z"), "UTC").toISOString(),
        ).toBe("2026-08-01T00:00:00.000Z");
    });

    test("the boundary is the zone's midnight, not UTC's", () => {
        // 2026-08-01T03:00Z is still 31 July in New York, so the August window
        // has not opened there yet.
        expect(
            calendarPeriodStart(
                "month",
                at("2026-08-01T03:00:00Z"),
                "America/New_York",
            ).toISOString(),
        ).toBe("2026-07-01T04:00:00.000Z");
        // An hour later it is 1 August locally.
        expect(
            calendarPeriodStart(
                "month",
                at("2026-08-01T05:00:00Z"),
                "America/New_York",
            ).toISOString(),
        ).toBe("2026-08-01T04:00:00.000Z");
    });

    test("zones ahead of UTC open their period earlier in UTC terms", () => {
        // Tokyo is UTC+9 year-round: 1 August there begins 2026-07-31T15:00Z.
        expect(
            calendarPeriodStart("month", at("2026-08-05T00:00:00Z"), "Asia/Tokyo").toISOString(),
        ).toBe("2026-07-31T15:00:00.000Z");
    });

    test("a month spanning a DST change still starts at local midnight", () => {
        // US DST began 2026-03-08. A month start computed with March's offset
        // applied to a pre-transition date would land an hour out.
        expect(
            calendarPeriodStart(
                "month",
                at("2026-03-20T12:00:00Z"),
                "America/New_York",
            ).toISOString(),
        ).toBe("2026-03-01T05:00:00.000Z");
        expect(
            calendarPeriodStart(
                "month",
                at("2026-11-20T12:00:00Z"),
                "America/New_York",
            ).toISOString(),
        ).toBe("2026-11-01T04:00:00.000Z");
    });

    test("a week whose Monday sits on the other side of a DST change", () => {
        // 2026-03-08 (the transition, a Sunday) belongs to the week starting
        // Monday 2026-03-02, which was still on standard time.
        expect(
            calendarPeriodStart(
                "week",
                at("2026-03-08T18:00:00Z"),
                "America/New_York",
            ).toISOString(),
        ).toBe("2026-03-02T05:00:00.000Z");
    });

    test("a half-hour zone is handled like any other", () => {
        expect(
            calendarPeriodStart("month", at("2026-08-10T12:00:00Z"), "Asia/Kolkata").toISOString(),
        ).toBe("2026-07-31T18:30:00.000Z");
    });

    test("volumeRange routes a calendar period through the same arithmetic", () => {
        const range = volumeRange(
            { kind: "calendar", unit: "week", timeZone: "UTC" },
            { now: at("2026-08-12T09:00:00Z"), createdAt: "2026-01-01T00:00:00Z" },
        );
        expect(range.from).toBe("2026-08-10T00:00:00.000Z");
        expect(range.to).toBeNull();
    });
});
