import type { Engagement, Mastery, ProblemProgress } from "$lib/progress";
import type { OfflinePlacementV1, OfflineProblemRatingV1, OfflineProblemV1 } from "$lib/offline/types";

export type ProblemFilterValues = {
    search?: string;
    seriesId?: number;
    testId?: number;
    topic?: string[];
    tags?: string[];
    difficulty?: [number, number];
    quality?: [number, number];
    isComputational?: boolean | null;
    verified?: boolean | null;
    mastery?: (Mastery | "unassessed")[];
    engagement?: (Engagement | "none")[];
    /** Per-series vocabulary; only applied when `seriesId` is set and `testId` is not. */
    divisions?: string[];
    formats?: string[];
    /** 1-based inclusive range (`problems.n + 1`); only applied when `seriesId` is set. */
    problemNumbers?: [number, number];
};

export type LocalProblemCandidate = {
    canonicalId: number;
    problem: OfflineProblemV1;
    placement: OfflinePlacementV1;
    rating: OfflineProblemRatingV1 | null;
    progress: ProblemProgress | null;
};

type FilterEntry<K extends keyof ProblemFilterValues> = {
    remote: (query: any, value: NonNullable<ProblemFilterValues[K]>, all: ProblemFilterValues) => any;
    local: (candidate: LocalProblemCandidate, value: NonNullable<ProblemFilterValues[K]>, all: ProblemFilterValues) => boolean;
};

type FilterSpec = { [K in keyof ProblemFilterValues]-?: FilterEntry<K> };

export function parseProblemSearchIds(input: string): number[] | null {
    const parts = input.split(/[\s,]+/).filter(Boolean);
    if (parts.length === 0 || parts.some((part) => !/^\d+$/.test(part) || Number(part) < 1)) {
        return null;
    }
    return [...new Set(parts.map(Number))];
}

function remoteNullable(query: any, column: "mastery" | "engagement", values: string[], nullValue: string) {
    const includeNull = values.includes(nullValue);
    const concrete = values.filter((value) => value !== nullValue);
    if (includeNull && concrete.length === 0) return query.is(column, null);
    if (!includeNull) return query.in(column, concrete);
    return query.or(`${column}.is.null,${column}.in.(${concrete.join(",")})`);
}

/** One declaration owns both the PostgREST and downloaded-record interpretations. */
export const PROBLEM_FILTERS = {
    search: {
        remote: (query, value) => {
            const ids = parseProblemSearchIds(value) ?? [];
            return query.or(`problem_id.in.(${ids.join(",")}),canonical_id.in.(${ids.join(",")})`);
        },
        local: (candidate, value) => {
            const ids = parseProblemSearchIds(value);
            return ids !== null && (ids.includes(candidate.placement.placementId) || ids.includes(candidate.canonicalId));
        },
    },
    testId: {
        remote: (query, value) => query.eq("test_id", value),
        local: (candidate, value) => candidate.placement.testId === value,
    },
    seriesId: {
        remote: (query, value, all) => all.testId == null ? query.eq("series_id", value) : query,
        local: (candidate, value, all) => all.testId != null || (candidate.placement.series?.id ?? candidate.placement.test?.seriesId) === value,
    },
    divisions: {
        remote: (query, value, all) =>
            all.seriesId == null || all.testId != null
                ? query
                : query.in("division", value),
        local: (candidate, value, all) => {
            if (all.seriesId == null || all.testId != null) return true;
            const division = candidate.placement.test?.division;
            return division != null && value.includes(division);
        },
    },
    formats: {
        remote: (query, value, all) =>
            all.seriesId == null || all.testId != null
                ? query
                : query.in("format", value),
        local: (candidate, value, all) => {
            if (all.seriesId == null || all.testId != null) return true;
            const format = candidate.placement.test?.format;
            return format != null && value.includes(format);
        },
    },
    problemNumbers: {
        remote: (query, value, all) => {
            if (all.seriesId == null) return query;
            const lo = value[0];
            const hi = value[1];
            if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi < lo) {
                return query;
            }
            return query.gte("n", lo - 1).lte("n", hi - 1);
        },
        local: (candidate, value, all) => {
            if (all.seriesId == null) return true;
            const lo = value[0];
            const hi = value[1];
            if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi < lo) {
                return true;
            }
            const displayed = candidate.placement.problemNumber + 1;
            return displayed >= lo && displayed <= hi;
        },
    },
    topic: {
        remote: (query, value) => query.in("topic", value),
        local: (candidate, value) => candidate.problem.topic !== null && value.includes(candidate.problem.topic),
    },
    tags: {
        remote: (query, value) => query.contains("tags", value),
        local: (candidate, value) => value.every((tag) => candidate.problem.tags?.includes(tag) === true),
    },
    difficulty: {
        remote: (query, value) => query.gte("rating", value[0]).lte("rating", value[1]),
        local: (candidate, value) => candidate.rating !== null && candidate.rating.rating >= value[0] && candidate.rating.rating <= value[1],
    },
    quality: {
        remote: (query, value) => query.gte("quality", value[0]).lte("quality", value[1]),
        local: (candidate, value) => candidate.problem.quality !== null && candidate.problem.quality >= value[0] && candidate.problem.quality <= value[1],
    },
    isComputational: {
        remote: (query, value) => query.eq("is_computational", value),
        local: (candidate, value) => candidate.problem.isComputational === value,
    },
    verified: {
        remote: (query, value) => query.eq("verified", value),
        local: (candidate, value) => candidate.problem.verified === value,
    },
    mastery: {
        remote: (query, value) => remoteNullable(query, "mastery", value, "unassessed"),
        local: (candidate, value) => {
            const actual = candidate.progress?.mastery ?? null;
            return actual === null ? value.includes("unassessed") : value.includes(actual);
        },
    },
    engagement: {
        remote: (query, value) => remoteNullable(query, "engagement", value, "none"),
        local: (candidate, value) => {
            const actual = candidate.progress?.engagement ?? null;
            return actual === null ? value.includes("none") : value.includes(actual);
        },
    },
} satisfies FilterSpec;

function active(value: unknown): boolean {
    return value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0) && value !== "";
}

export function applyRemoteProblemFilters(query: any, filters: ProblemFilterValues): any {
    let next = query;
    for (const key of Object.keys(PROBLEM_FILTERS) as (keyof ProblemFilterValues)[]) {
        const value = filters[key];
        if (active(value)) next = PROBLEM_FILTERS[key].remote(next, value as never, filters);
    }
    return next;
}

export function matchesLocalProblemFilters(candidate: LocalProblemCandidate, filters: ProblemFilterValues): boolean {
    return (Object.keys(PROBLEM_FILTERS) as (keyof ProblemFilterValues)[]).every((key) => {
        const value = filters[key];
        return !active(value) || PROBLEM_FILTERS[key].local(candidate, value as never, filters);
    });
}
