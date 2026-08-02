import { describe, expect, test } from "bun:test";
import { problemReportInsert } from "$lib/feedback";

describe("problemReportInsert", () => {
    test("normalizes one unified report payload", () => {
        expect(
            problemReportInsert("user-id", {
                problemId: 42,
                answerIndex: 2,
                message: "  The keyed answer looks wrong.  ",
            }),
        ).toEqual({
            user_id: "user-id",
            problem_id: 42,
            type: "problem_report",
            answer_index: 2,
            message: "The keyed answer looks wrong.",
        });
    });

    test("allows either a message or an answer suggestion", () => {
        expect(
            problemReportInsert("user-id", { problemId: 42, message: "Bad rendering" }),
        ).toMatchObject({ answer_index: null, message: "Bad rendering" });
        expect(
            problemReportInsert("user-id", { problemId: 42, answerIndex: 1 }),
        ).toMatchObject({ answer_index: 1, message: null });
    });

    test("rejects an empty report", () => {
        expect(() =>
            problemReportInsert("user-id", { problemId: 42, message: "   " }),
        ).toThrow("Write a message or suggest an answer.");
    });
});
