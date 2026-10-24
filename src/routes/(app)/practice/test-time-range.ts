/** Endpoints are indices in the review's original test order. */
export type TimeRangeSelection = { start: number; end: number } | null;

export function selectTimeEndpoint(selection: TimeRangeSelection, index: number): TimeRangeSelection {
    if (!selection) return { start: index, end: index };
    // Every highlighted problem is active, so repeating the selection gesture
    // anywhere inside the span toggles the range off.
    const from = Math.min(selection.start, selection.end);
    const to = Math.max(selection.start, selection.end);
    if (index >= from && index <= to) return null;
    return { start: selection.start, end: index };
}

export function summarizeTimeRange(
    history: readonly { elapsedMs?: number | null }[],
    selection: TimeRangeSelection,
) {
    if (!selection) return null;
    const from = Math.min(selection.start, selection.end);
    const to = Math.max(selection.start, selection.end);
    const entries = history.slice(from, to + 1);
    return {
        from,
        to,
        count: entries.length,
        totalMs: entries.reduce((sum, entry) => sum + recordedTime(entry.elapsedMs), 0),
    };
}

export function recordedTime(elapsedMs: number | null | undefined) {
    return elapsedMs != null && Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
}
