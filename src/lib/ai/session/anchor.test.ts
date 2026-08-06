import { describe, expect, test } from "bun:test";
import { anchorFor, anchorKey, sameAnchor } from "./anchor";

describe("anchorFor", () => {
    test("a standalone problem anchors on itself", () => {
        expect(anchorFor({ id: 42, canonical_id: null }, 7)).toEqual({
            problemId: 42,
            practiceSessionId: 7,
        });
    });

    test("an alias anchors on the canonical it shares state with", () => {
        // AMC 10A #18 and AMC 12A #12 are one problem: opening the thread from either
        // placement must land on the same sitting, exactly as submissions do.
        expect(anchorFor({ id: 99, canonical_id: 42 }, 7).problemId).toBe(42);
    });

    test("library work has no session", () => {
        expect(anchorFor({ id: 42 }, null).practiceSessionId).toBeNull();
    });
});

describe("sameAnchor", () => {
    test("the same problem in a different sitting is a different anchor", () => {
        expect(
            sameAnchor({ problemId: 1, practiceSessionId: 1 }, { problemId: 1, practiceSessionId: 2 }),
        ).toBe(false);
    });

    test("two sessionless anchors on one problem are the same slot", () => {
        // The unique index is `nulls not distinct`, so null is a single slot rather
        // than unlimited ones — this has to agree with it.
        expect(
            sameAnchor(
                { problemId: 1, practiceSessionId: null },
                { problemId: 1, practiceSessionId: null },
            ),
        ).toBe(true);
    });

    test("no anchor is not the same as any anchor", () => {
        expect(sameAnchor(null, { problemId: 1, practiceSessionId: null })).toBe(false);
        expect(sameAnchor(null, null)).toBe(true);
    });
});

test("anchorKey distinguishes a null session from any real one", () => {
    expect(anchorKey({ problemId: 1, practiceSessionId: null })).not.toBe(
        anchorKey({ problemId: 1, practiceSessionId: 2 }),
    );
});
