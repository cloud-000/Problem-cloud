import { describe, expect, test } from "bun:test";
import { parsePracticeLaunch, practiceLaunchHref } from "./practice-launch";

describe("practice launch URLs", () => {
    test("serializes a mock-test intent", () => {
        expect(
            practiceLaunchHref({ kind: "mock-test", testId: 42, seriesId: 7 }),
        ).toBe("/practice?mock_test=42&series_id=7");
    });

    test("parses a mock-test intent and preserves unrelated query state", () => {
        const parsed = parsePracticeLaunch(
            new URL("https://problem.test/practice?mock_test=42&series_id=7&source=library"),
        );

        expect(parsed.intent).toEqual({ kind: "mock-test", testId: 42, seriesId: 7 });
        expect(parsed.hadLaunchParams).toBe(true);
        expect(parsed.cleanedUrl.href).toBe(
            "https://problem.test/practice?source=library",
        );
    });

    test("strips malformed or incomplete launch parameters without acting", () => {
        const parsed = parsePracticeLaunch(
            new URL("https://problem.test/practice?mock_test=nope&keep=1"),
        );

        expect(parsed.intent).toBeNull();
        expect(parsed.hadLaunchParams).toBe(true);
        expect(parsed.cleanedUrl.href).toBe("https://problem.test/practice?keep=1");
    });

    test("leaves ordinary Practice URLs alone", () => {
        const parsed = parsePracticeLaunch(
            new URL("https://problem.test/practice?session=12"),
        );

        expect(parsed.intent).toBeNull();
        expect(parsed.hadLaunchParams).toBe(false);
        expect(parsed.cleanedUrl.href).toBe("https://problem.test/practice?session=12");
    });
});
