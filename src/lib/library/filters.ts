import type { ProblemFilterValues } from "#lib/problem-filter-spec.js";

export type Level = "series" | "tests" | "problems";
export const LEVELS: Level[] = ["series", "tests", "problems"];

/** Existing data-access callers share this superset; views narrow it by tab. */
export type Filters = ProblemFilterValues & {
    name?: string;
    isOfficial?: boolean | null;
    type?: string[];
};
export type SeriesFilters = Pick<Filters, "search" | "isOfficial">;
export type TestFilters = Pick<Filters,
    "search" | "seriesId" | "year" | "type" | "isComputational" | "divisions" | "formats"
>;
export type ProblemFilters = ProblemFilterValues;

/** Overall problem rating bounds, rather than authored difficulty. */
export const DIFFICULTY_RANGE: [number, number] = [0, 3000];
export const QUALITY_RANGE: [number, number] = [0, 100];
export const YEAR_RANGE: [number, number] = [1950, new Date().getFullYear()];
