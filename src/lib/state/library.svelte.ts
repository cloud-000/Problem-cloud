import { untrack } from "svelte";
import type { Filters, Level, SeriesRow, TestRow } from "$lib/library";

/**
 * One entry in the navigation history. `context` holds the parent rows locked in by
 * drilling down (so their ids stay applied as filters and can be shown as breadcrumbs).
 */
export interface Frame {
    level: Level;
    context: { series?: SeriesRow; test?: TestRow };
    filters: Filters;
}

function freshFrame(level: Level): Frame {
    return { level, context: {}, filters: {} };
}

function normalizedFilters(filters: Filters): Filters {
    const next = Object.fromEntries(
        Object.entries(filters).filter(([, value]) => {
            if (value == null) return false;
            return !Array.isArray(value) || value.length > 0;
        }),
    ) as Filters;
    // Division/format vocabulary is per-series, and a locked test already
    // determines both. Problem numbers still apply under a test.
    if (next.seriesId == null) {
        delete next.divisions;
        delete next.formats;
        delete next.problemNumbers;
    }
    if (next.testId != null) {
        delete next.divisions;
        delete next.formats;
    }
    return next;
}

function filtersEqual(left: Filters, right: Filters): boolean {
    const leftEntries = Object.entries(normalizedFilters(left));
    const rightEntries = Object.entries(normalizedFilters(right));
    if (leftEntries.length !== rightEntries.length) return false;

    return leftEntries.every(([key, leftValue]) => {
        const rightValue = right[key as keyof Filters];
        if (Array.isArray(leftValue) && Array.isArray(rightValue)) {
            return (
                leftValue.length === rightValue.length &&
                leftValue.every((value, index) => value === rightValue[index])
            );
        }
        return leftValue === rightValue;
    });
}

/**
 * Browser-style navigation for the library finder. Back/forward step between frames
 * (drill-downs / manual level changes); filter edits mutate the *current* frame in
 * place via {@link patchFilters} and never create a new history entry.
 *
 * Instantiate per-page (not a module singleton) so each visit starts fresh and it
 * never leaks across SSR requests.
 */
export class LibraryStore {
    history = $state<Frame[]>([freshFrame("problems")]);
    cursor = $state(0);

    current = $derived(this.history[this.cursor]);
    canBack = $derived(this.cursor > 0);
    canForward = $derived(this.cursor < this.history.length - 1);

    back() {
        if (this.canBack) this.cursor--;
    }

    forward() {
        if (this.canForward) this.cursor++;
    }

    /** Append a frame, dropping any forward history first (like a fresh navigation). */
    private push(frame: Frame) {
        this.history = [...this.history.slice(0, this.cursor + 1), frame];
        this.cursor = this.history.length - 1;
    }

    /** Manual level change from the dropdown — starts a fresh, unscoped search. */
    setLevel(level: Level) {
        if (
            level === this.current.level &&
            !this.current.context.series &&
            !this.current.context.test
        )
            return;
        this.push(freshFrame(level));
    }

    /** Drill series → its tests, locking the series into the tests filter. */
    drillToTests(series: SeriesRow) {
        this.push({
            level: "tests",
            context: { series },
            filters: { seriesId: series.id },
        });
    }

    /** Drill test → its problems, locking the test (and its series) into the filter. */
    drillToProblems(series: SeriesRow | undefined, test: TestRow) {
        this.push({
            level: "problems",
            context: { series, test },
            filters: { seriesId: series?.id, testId: test.id },
        });
    }

    /**
     * Merge a partial filter set into the current frame (no new history entry).
     * The existing-filters read is untracked: callers patch from inside an `$effect`,
     * so subscribing to `filters` here would make that effect re-trigger its own write.
     */
    patchFilters(partial: Filters) {
        untrack(() => {
            const current = this.current.filters;
            const next = normalizedFilters({ ...current, ...partial });
            if (filtersEqual(current, next)) return;
            this.current.filters = next;
        });
    }

    /**
     * Remove a locked drill-down scope from the current frame (the chip "×").
     * Removing the series cascades to the test, since a test scope can't outlive
     * the series it was reached through. The matching filter ids are dropped
     * separately by the filter UI's reactive patch once its locals clear.
     */
    clearScope(which: "series" | "test") {
        untrack(() => {
            const ctx = { ...this.current.context };
            const filters = { ...this.current.filters };
            if (which === "series") {
                delete ctx.series;
                delete ctx.test;
                delete filters.seriesId;
                delete filters.testId;
            } else {
                delete ctx.test;
                delete filters.testId;
            }
            this.current.context = ctx;
            this.current.filters = filters;
        });
    }

    /** Clear optional filters while preserving the current search and drilled scope. */
    clearFilters() {
        untrack(() => {
            this.current.filters = {
                search: this.current.filters.search,
                seriesId: this.current.context.series?.id,
                testId: this.current.context.test?.id,
            };
        });
    }
}
