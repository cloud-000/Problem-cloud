import { describe, expect, test } from "bun:test";
import {
    ANSWER_STATUSES,
    RESPONSE_KINDS,
    hasComparableAnswer,
    inputModeFor,
    isAnswerStatus,
    isReferenceAnswerMissing,
    isResponseKind,
    resolveResponseKind,
    submissionOutcome,
} from "./problem-response";

describe("response metadata values", () => {
    test("accepts every declared value and rejects invalid database strings", () => {
        for (const kind of RESPONSE_KINDS) expect(isResponseKind(kind)).toBe(true);
        for (const status of ANSWER_STATUSES)
            expect(isAnswerStatus(status)).toBe(true);

        for (const value of [null, undefined, "", "essay", 1]) {
            expect(isResponseKind(value)).toBe(false);
        }
        for (const value of [null, undefined, "", "missing", false]) {
            expect(isAnswerStatus(value)).toBe(false);
        }
    });
});

describe("resolveResponseKind", () => {
    test("uses valid problem metadata before any legacy inference", () => {
        expect(
            resolveResponseKind({
                response_kind: "proof",
                choices: ["not", "an", "mcq"],
            }),
        ).toBe("proof");
    });

    test("infers legacy choice shapes without treating a lone key as MCQ", () => {
        expect(resolveResponseKind({ choices: ["A", "B"] })).toBe("mcq");
        expect(resolveResponseKind({ choices: ["42"] })).toBe("short_answer");
        expect(resolveResponseKind({ choices: [] })).toBe("unknown");
        expect(resolveResponseKind({ choices: null })).toBe("unknown");
    });

    test("ignores invalid metadata and never infers proof from answer status", () => {
        expect(
            resolveResponseKind({
                response_kind: "essay",
                answer_status: "not_applicable",
                choices: null,
            }),
        ).toBe("unknown");
    });
});

describe("inputModeFor", () => {
    test("maps every response kind to its initial capture mode", () => {
        expect(RESPONSE_KINDS.map((kind) => [kind, inputModeFor(kind)])).toEqual([
            ["mcq", "choice"],
            ["short_answer", "short-text"],
            ["proof", "long-text"],
            ["construction", "unsupported"],
            ["estimation", "short-text"],
            ["interactive", "unsupported"],
            ["unknown", "short-text"],
        ]);
    });
});

describe("reference-answer coverage", () => {
    test("requires known status and an in-range key", () => {
        expect(
            hasComparableAnswer({
                answer_status: "known",
                choices: ["A", "B"],
                answer_index: 1,
            }),
        ).toBe(true);
        expect(
            hasComparableAnswer({
                answer_status: "known",
                choices: ["42"],
                answer_index: 0,
            }),
        ).toBe(true);
        expect(
            hasComparableAnswer({
                answer_status: "known",
                choices: ["A"],
                answer_index: 1,
            }),
        ).toBe(false);
        expect(
            hasComparableAnswer({
                answer_status: "source_missing",
                choices: ["A"],
                answer_index: 0,
            }),
        ).toBe(false);
    });

    test("only missing and review statuses enter contribution flows", () => {
        expect(isReferenceAnswerMissing({ answer_status: "source_missing" })).toBe(
            true,
        );
        expect(isReferenceAnswerMissing({ answer_status: "needs_review" })).toBe(
            true,
        );
        expect(isReferenceAnswerMissing({ answer_status: "known" })).toBe(false);
        expect(isReferenceAnswerMissing({ answer_status: "not_applicable" })).toBe(
            false,
        );
        expect(isReferenceAnswerMissing({ answer_status: "invalid" })).toBe(false);
        expect(isReferenceAnswerMissing({ answer_status: null })).toBe(false);
    });
});

describe("submissionOutcome", () => {
    test("resolves all four persisted outcomes without boolean truthiness", () => {
        expect(submissionOutcome({ skipped: true, is_correct: null })).toBe("skipped");
        expect(submissionOutcome({ skipped: false, is_correct: null })).toBe(
            "ungraded",
        );
        expect(submissionOutcome({ skipped: false, is_correct: true })).toBe("correct");
        expect(submissionOutcome({ skipped: false, is_correct: false })).toBe(
            "incorrect",
        );
    });

    test("skip wins over inconsistent correctness and absent values are ungraded", () => {
        expect(submissionOutcome({ skipped: true, is_correct: false })).toBe("skipped");
        expect(submissionOutcome({})).toBe("ungraded");
    });
});
