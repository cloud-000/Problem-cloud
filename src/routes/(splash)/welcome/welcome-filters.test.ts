import { describe, expect, test } from "bun:test";
import {
    WELCOME_SERIES_OPTIONS,
    initialWelcomeTrack,
    loadWelcomeSeriesDimensions,
    loadWelcomeSeriesNumberLine,
    loadWelcomeSeriesYearSpan,
} from "./welcome-filters";

describe("welcome filter mock", () => {
    test("seeds AMC 10 so nested series controls have something to show", () => {
        const seeded = initialWelcomeTrack();
        expect(seeded.seriesIds).toEqual(["1"]);
        expect(WELCOME_SERIES_OPTIONS[0]?.label).toBe("AMC 10");
        expect(seeded.seriesScopes["1"]).toEqual({
            divisions: [],
            formats: [],
        });
    });

    test("loaders return per-series vocabulary for the Track mock", async () => {
        expect(await loadWelcomeSeriesDimensions(1)).toEqual([
            { division: "A", division_order: 1, format: null, format_order: null },
            { division: "B", division_order: 2, format: null, format_order: null },
        ]);
        expect(await loadWelcomeSeriesNumberLine(1)).toBe(25);
        expect(await loadWelcomeSeriesYearSpan(3)).toEqual({
            min: 1983,
            max: 2025,
        });
        expect(await loadWelcomeSeriesDimensions(99)).toEqual([]);
    });
});
