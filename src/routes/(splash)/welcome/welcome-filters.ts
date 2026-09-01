/**
 * Sample series vocabulary for the splash filter mock. Loaders feed the
 * real practice Track so a visitor can work the same comboboxes without
 * an account; ids are numeric strings because Track fetches by number.
 */

import type { SeriesDimensionRow, SeriesYearSpan } from "$lib/series-review";

export const WELCOME_SERIES_OPTIONS = [
    { value: "1", label: "AMC 10" },
    { value: "2", label: "AMC 12" },
    { value: "3", label: "AIME" },
];

const DIMENSIONS: Record<number, SeriesDimensionRow[]> = {
    1: [
        { division: "A", division_order: 1, format: null, format_order: null },
        { division: "B", division_order: 2, format: null, format_order: null },
    ],
    2: [
        { division: "A", division_order: 1, format: null, format_order: null },
        { division: "B", division_order: 2, format: null, format_order: null },
    ],
    3: [
        { division: null, division_order: null, format: "I", format_order: 1 },
        { division: null, division_order: null, format: "II", format_order: 2 },
    ],
};

const NUMBER_LINE: Record<number, number> = { 1: 25, 2: 25, 3: 15 };

const YEARS: Record<number, SeriesYearSpan> = {
    1: { min: 2000, max: 2025 },
    2: { min: 2000, max: 2025 },
    3: { min: 1983, max: 2025 },
};

/** Seed AMC 10 so the nested division / year / number controls are visible. */
export function initialWelcomeTrack() {
    return {
        topic: [] as string[],
        seriesIds: ["1"],
        seriesScopes: {
            "1": { divisions: [] as string[], formats: [] as string[] },
        },
    };
}

export function loadWelcomeSeriesDimensions(seriesId: number) {
    return Promise.resolve(DIMENSIONS[seriesId] ?? []);
}

export function loadWelcomeSeriesNumberLine(seriesId: number) {
    return Promise.resolve(NUMBER_LINE[seriesId] ?? 0);
}

export function loadWelcomeSeriesYearSpan(seriesId: number) {
    return Promise.resolve(YEARS[seriesId] ?? null);
}
