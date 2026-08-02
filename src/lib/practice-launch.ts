/**
 * Shareable commands that land on the Practice sessions hub and configure UI.
 *
 * Keep URL parsing and serialization here rather than teaching components about
 * individual parameters. New launch actions can extend this discriminated union
 * and the codec while SessionsView remains an intent consumer.
 */
export type PracticeLaunchIntent = {
    kind: "mock-test";
    testId: number;
    seriesId: number;
};

export type ParsedPracticeLaunch = {
    intent: PracticeLaunchIntent | null;
    /** A copy of the input URL with all launch-only parameters removed. */
    cleanedUrl: URL;
    /** True even for malformed or incomplete launch parameters. */
    hadLaunchParams: boolean;
};

const MOCK_TEST_PARAM = "mock_test";
const SERIES_ID_PARAM = "series_id";
const PRACTICE_LAUNCH_PARAMS = [MOCK_TEST_PARAM, SERIES_ID_PARAM] as const;

function positiveInteger(value: string | null): number | null {
    if (value == null || !/^[1-9]\d*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Build a relative, shareable Practice URL for a launch intent. */
export function practiceLaunchHref(
    intent: PracticeLaunchIntent,
    practicePath = "/practice",
): string {
    const params = new URLSearchParams();
    switch (intent.kind) {
        case "mock-test":
            params.set(MOCK_TEST_PARAM, String(intent.testId));
            params.set(SERIES_ID_PARAM, String(intent.seriesId));
            break;
    }
    return `${practicePath}?${params}`;
}

/**
 * Parse the one-shot launch command and return a URL safe to put back in history.
 * Unknown query parameters are preserved. Incomplete/malformed launch commands
 * are ignored but still removed so they cannot retrigger on a later render.
 */
export function parsePracticeLaunch(url: URL): ParsedPracticeLaunch {
    const cleanedUrl = new URL(url);
    const hadLaunchParams = PRACTICE_LAUNCH_PARAMS.some((param) =>
        cleanedUrl.searchParams.has(param),
    );
    const testId = positiveInteger(cleanedUrl.searchParams.get(MOCK_TEST_PARAM));
    const seriesId = positiveInteger(cleanedUrl.searchParams.get(SERIES_ID_PARAM));

    for (const param of PRACTICE_LAUNCH_PARAMS) {
        cleanedUrl.searchParams.delete(param);
    }

    return {
        intent:
            testId != null && seriesId != null
                ? { kind: "mock-test", testId, seriesId }
                : null,
        cleanedUrl,
        hadLaunchParams,
    };
}
