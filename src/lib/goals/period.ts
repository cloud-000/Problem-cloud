/**
 * Volume periods → a half-open instant range.
 *
 * This arithmetic is deliberately here rather than in SQL (`goals.sql`): the
 * three period kinds all reduce to `[from, to)`, and TypeScript already owns
 * the timezone the goal was created in. SQL counts; this decides what "this
 * month" means.
 *
 * Calendar periods need a timezone for the same reason streaks do — a week that
 * starts on a different day depending on where you open the app is not a week —
 * and it comes from the goal, never from the device.
 */

import type { VolumePeriod } from "./types";

/** A half-open range of ISO instants. `null` means unbounded on that side. */
export type InstantRange = { from: string | null; to: string | null };

/** Calendar weeks start on Monday. Contest prep is a weekday habit, and ISO
 * agrees; the choice only has to be consistent, not universal. */
const WEEK_STARTS_ON = 1; // 1 = Monday, per Date#getUTCDay numbering

const MS_PER_DAY = 86_400_000;

/**
 * The wall-clock fields an instant has in a given zone. `Intl` is the only
 * timezone database in the browser, so every conversion below is built from
 * this one primitive rather than from a fixed offset — a fixed offset is wrong
 * twice a year in most of the world.
 */
function zonedParts(instant: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).formatToParts(instant);

    const read = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((p) => p.type === type)?.value ?? "0");

    // `hour12: false` renders midnight as 24 in some ICU versions; normalize it
    // back to 0 so the arithmetic below cannot land a day late.
    const hour = read("hour") % 24;

    return {
        year: read("year"),
        month: read("month"),
        day: read("day"),
        hour,
        minute: read("minute"),
        second: read("second"),
    };
}

/** How far `timeZone` is ahead of UTC at `instant`, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
    const p = zonedParts(instant, timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    // Sub-second precision is not carried by formatToParts; drop it from both
    // sides so the difference is a whole number of seconds.
    return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which the given wall-clock midnight occurs in `timeZone`.
 *
 * Solved by iteration rather than by a lookup: guess that the zone's offset now
 * also applies at the target date, then correct once using the offset actually
 * in force at the guess. One correction is enough for every real zone — offsets
 * change by at most a couple of hours, so the first guess is never more than
 * that far off, and never lands in a different transition.
 */
function zonedMidnight(
    year: number,
    month: number,
    day: number,
    timeZone: string,
): Date {
    const naive = Date.UTC(year, month - 1, day, 0, 0, 0);
    const firstGuess = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
    return new Date(naive - zoneOffsetMs(firstGuess, timeZone));
}

/**
 * The start of the calendar period containing `now`, in `timeZone`.
 *
 * Week arithmetic is done on the zone's own calendar date (via a UTC proxy so
 * `getUTCDay` reads the local weekday), then converted back — stepping back in
 * milliseconds instead would drift across a DST boundary.
 */
export function calendarPeriodStart(
    unit: "week" | "month",
    now: Date,
    timeZone: string,
): Date {
    const local = zonedParts(now, timeZone);

    if (unit === "month") {
        return zonedMidnight(local.year, local.month, 1, timeZone);
    }

    const proxy = new Date(Date.UTC(local.year, local.month - 1, local.day));
    const back = (proxy.getUTCDay() - WEEK_STARTS_ON + 7) % 7;
    const start = new Date(proxy.getTime() - back * MS_PER_DAY);
    return zonedMidnight(
        start.getUTCFullYear(),
        start.getUTCMonth() + 1,
        start.getUTCDate(),
        timeZone,
    );
}

/**
 * The range a volume goal counts over.
 *
 * `to` is left unbounded rather than pinned to `now`: the count is "so far in
 * this period", and closing the range at the moment of the request would make
 * two evaluations a second apart disagree for no reason.
 */
export function volumeRange(
    period: VolumePeriod,
    ctx: { now: Date; createdAt: string },
): InstantRange {
    switch (period.kind) {
        case "since_creation":
            return { from: ctx.createdAt, to: null };
        case "rolling": {
            const days = Math.max(1, Math.floor(period.days));
            return {
                from: new Date(ctx.now.getTime() - days * MS_PER_DAY).toISOString(),
                to: null,
            };
        }
        case "calendar":
            return {
                from: calendarPeriodStart(
                    period.unit,
                    ctx.now,
                    period.timeZone,
                ).toISOString(),
                to: null,
            };
    }
}

/**
 * Whether a period can be finished once and stay finished. Calendar periods
 * re-evaluate each cycle, so a goal on one is a recurring quota rather than a
 * finish line — the creation flow has to say which the student is choosing.
 */
export function isPeriodFinishable(period: VolumePeriod): boolean {
    return period.kind !== "calendar";
}
