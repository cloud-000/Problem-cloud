import type { Filters } from "./filters.js";
import { normalizeView, type LibraryView } from "./view.js";

/** This is the URL vocabulary only; filter applicability belongs to normalizeView. */
const fields = {
    search: "search", seriesId: "series", testId: "test", topic: "topic", tags: "tag",
    difficulty: "rating", quality: "quality", isComputational: "computational",
    verified: "verified", mastery: "mastery", engagement: "plan", divisions: "division",
    formats: "format", problemNumbers: "problemNumbers", year: "year", type: "type", isOfficial: "official",
} as const satisfies Partial<Record<keyof Filters, string>>;
const numeric = new Set<keyof Filters>(["seriesId", "testId"]);
const boolean = new Set<keyof Filters>(["isOfficial", "isComputational", "verified"]);
const range = new Set<keyof Filters>(["difficulty", "quality", "problemNumbers", "year"]);

export function parseLibraryUrl(params: Pick<URLSearchParams, "get" | "getAll">): LibraryView {
    const filters: Record<string, unknown> = {};
    for (const [key, param] of Object.entries(fields) as [keyof typeof fields, string][]) {
        const values = params.getAll(param);
        if (!values.length) continue;
        const value = values[0];
        if (numeric.has(key)) {
            if (/^[1-9]\d*$/.test(value)) filters[key] = Number(value);
        } else if (boolean.has(key)) {
            if (value === "true" || value === "false") filters[key] = value === "true";
        } else if (range.has(key)) {
            if (/^\d+\.\.\d+$/.test(value)) filters[key] = value.split("..").map(Number);
        } else {
            filters[key] = key === "search" ? value : values;
        }
    }
    return normalizeView({ tab: params.get("tab") ?? "problems", filters: filters as Filters });
}

/** Preserve unrelated query parameters, the pathname, and the fragment. */
export function writeLibraryUrl(current: URL, input: LibraryView): URL {
    const url = new URL(current);
    const view = normalizeView(input);
    url.searchParams.delete("tab");
    for (const param of Object.values(fields)) url.searchParams.delete(param);
    if (view.tab !== "problems") url.searchParams.set("tab", view.tab);
    for (const [key, param] of Object.entries(fields) as [keyof typeof fields, string][]) {
        const value = (view.filters as Filters)[key];
        if (value == null) continue;
        if (range.has(key)) url.searchParams.set(param, (value as number[]).join(".."));
        else if (Array.isArray(value)) for (const entry of value) url.searchParams.append(param, String(entry));
        else url.searchParams.set(param, String(value));
    }
    return url;
}
