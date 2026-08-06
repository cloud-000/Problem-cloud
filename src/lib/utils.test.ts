import { describe, expect, test } from "bun:test";
import { formatElapsed, problemLabel } from "./utils";

describe("problemLabel", () => {
    test("renders the stored 0-based n as the 1-based number people count with", () => {
        // The trainer's Coach chip used to read `#17` while the student worked #18 —
        // and that label is what the model was told the problem was.
        expect(problemLabel({ n: 17, tests: { name: "2023 AMC 10A" } })).toBe(
            "2023 AMC 10A #18",
        );
        expect(problemLabel({ n: 0, tests: { name: "2023 AMC 10A" } })).toBe(
            "2023 AMC 10A #1",
        );
    });

    test("falls back to a bare problem number when the test is unknown", () => {
        expect(problemLabel({ n: 0 })).toBe("Problem #1");
        expect(problemLabel({ n: 4, tests: null })).toBe("Problem #5");
        expect(problemLabel({ n: 4, tests: { name: null } })).toBe("Problem #5");
    });
});

describe("formatElapsed", () => {
    test("switches to m:ss past a minute", () => {
        expect(formatElapsed(5_000)).toBe("5s");
        expect(formatElapsed(65_000)).toBe("1:05");
        expect(formatElapsed(600_000)).toBe("10:00");
    });
});
