/**
 * Copy for the tour's Library mock. The mock renders the live catalog through
 * the real Library result list; these helpers keep its chrome copy stable.
 */

import type { Level } from "$lib/library";

export const LIBRARY_MOCK_TABS: { value: Level; label: string }[] = [
    { value: "problems", label: "Problems" },
    { value: "tests", label: "Tests" },
    { value: "series", label: "Series" },
];

export function librarySearchPlaceholder(level: Level): string {
    return level === "problems"
        ? "Search by problem ID"
        : `Search ${level} by name`;
}

export function libraryMockCaption(input: {
    level: Level;
    seriesName?: string | null;
    testName?: string | null;
}): string {
    if (input.testName) return `Problems from ${input.testName}.`;
    if (input.seriesName && input.level === "tests") {
        return `Tests in ${input.seriesName}.`;
    }
    if (input.level === "problems") return "One problem at a time.";
    if (input.level === "tests") return "A whole contest.";
    return "A competition across years.";
}
