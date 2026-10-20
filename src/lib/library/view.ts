import {
    DIFFICULTY_RANGE, QUALITY_RANGE, YEAR_RANGE,
    type Filters, type Level, type SeriesFilters, type TestFilters, type ProblemFilters,
} from "./filters.js";

export type LibraryView =
    | { tab: "series"; filters: SeriesFilters }
    | { tab: "tests"; filters: TestFilters }
    | { tab: "problems"; filters: ProblemFilters };

export type LibraryAction =
    | { type: "tab"; tab: Level }
    | { type: "patch"; filters: Filters }
    | { type: "series"; seriesId: number }
    | { type: "test"; testId: number; seriesId?: number }
    | { type: "clear-scope"; scope: "series" | "test" }
    | { type: "clear-filters" };

export function libraryHistoryMode(action: LibraryAction): "push" | "replace" {
    return action.type === "tab" || action.type === "series" || action.type === "test"
        ? "push" : "replace";
}

const shared = ["search"] as const;
const scoped = ["seriesId", "divisions", "formats", "year"] as const;
const keys: Record<Level, readonly (keyof Filters)[]> = {
    series: [...shared, "isOfficial"],
    tests: [...shared, ...scoped, "type", "isComputational"],
    problems: [...shared, ...scoped, "testId", "problemNumbers", "topic", "tags",
        "difficulty", "quality", "isComputational", "verified", "mastery", "engagement"],
};
const enums: Partial<Record<keyof Filters, readonly string[]>> = {
    topic: ["A", "C", "G", "N", "K", "O"],
    mastery: ["unassessed", "needs_work", "learning", "confident"],
    engagement: ["none", "working", "revisit", "later", "ignored"],
};
const ranges: Partial<Record<keyof Filters, [number, number]>> = {
    difficulty: DIFFICULTY_RANGE, quality: QUALITY_RANGE, year: [1, 9999],
    problemNumbers: [1, Number.MAX_SAFE_INTEGER],
};

/** Complete-snapshot validation. Does not perform action-specific dependent resets. */
export function normalizeView(input: { tab: string; filters: Filters }): LibraryView {
    const tab: Level = input.tab === "series" || input.tab === "tests" ? input.tab : "problems";
    const next: Record<string, unknown> = {};
    for (const key of keys[tab]) {
        const value = input.filters[key];
        if (value == null) continue;
        if (key === "search") {
            if (typeof value === "string" && value.trim()) next[key] = value;
        } else if (key === "seriesId" || key === "testId") {
            if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) next[key] = value;
        } else if (key === "isOfficial" || key === "isComputational" || key === "verified") {
            if (typeof value === "boolean") next[key] = value;
        } else if (ranges[key]) {
            const [min, max] = ranges[key];
            if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => typeof n === "number" && Number.isSafeInteger(n))) continue;
            const [lo, hi] = value as [number, number];
            if (lo < min || hi > max || hi < lo) continue;
            // Full sliders mean Any, including rows with no stored value.
            const full = key === "year" ? YEAR_RANGE : ranges[key];
            if (key !== "problemNumbers" && lo === full[0] && hi === full[1]) continue;
            next[key] = [lo, hi];
        } else if (Array.isArray(value)) {
            const allowed = enums[key];
            const values = [...new Set(value.filter((v): v is string => typeof v === "string")
                .map((v) => v.trim()).filter((v) => v && (!allowed || allowed.includes(v))))].sort();
            if (values.length) next[key] = values;
        }
    }
    if (next.seriesId == null) {
        delete next.divisions;
        delete next.formats;
        if (next.testId == null) delete next.problemNumbers;
        if (tab === "problems") delete next.year;
    }
    if (next.testId != null) {
        delete next.divisions;
        delete next.formats;
        delete next.year;
    }
    return { tab, filters: next } as LibraryView;
}

export function transitionView(view: LibraryView, action: LibraryAction): LibraryView {
    const f: Filters = view.filters;
    switch (action.type) {
        case "tab":
            if (action.tab === view.tab) return view;
            return normalizeView({ tab: action.tab, filters: {} });
        case "series":
            return normalizeView({ tab: "tests", filters: { seriesId: action.seriesId } });
        case "test":
            return normalizeView({ tab: "problems", filters: { seriesId: action.seriesId, testId: action.testId } });
        case "clear-filters":
            return normalizeView({ tab: view.tab, filters: { search: f.search, seriesId: f.seriesId, testId: f.testId } });
        case "clear-scope":
            return transitionView(view, { type: "patch", filters: action.scope === "series"
                ? { seriesId: undefined, testId: undefined, divisions: undefined, formats: undefined, problemNumbers: undefined, year: undefined }
                : { testId: undefined, problemNumbers: undefined } });
        case "patch": {
            const patch = action.filters;
            const next = { ...f };
            if (Object.hasOwn(patch, "seriesId") && patch.seriesId !== f.seriesId) {
                delete next.testId;
                delete next.divisions;
                delete next.formats;
                delete next.problemNumbers;
                delete next.year;
            }
            return normalizeView({ tab: view.tab, filters: { ...next, ...patch } });
        }
    }
}

export function toQueryFilters(view: LibraryView): Filters {
    return view.filters;
}

/** Canonical ordering makes equivalent selections share a query identity. */
export function libraryViewKey(view: LibraryView): string {
    return JSON.stringify(normalizeView(view));
}
