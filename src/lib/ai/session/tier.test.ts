import { describe, expect, test } from "bun:test";
import { promoteTier, tierForPresentation, tierPersists } from "./tier";

describe("coach tiers", () => {
    test("the presentation decides the tier", () => {
        expect(tierForPresentation("quick-ask")).toBe("one-shot");
        expect(tierForPresentation("panel")).toBe("assist");
        expect(tierForPresentation("inline")).toBe("work");
    });

    test("only a one-shot is absent from the database", () => {
        expect(tierPersists("one-shot")).toBe(false);
        expect(tierPersists("assist")).toBe(true);
        expect(tierPersists("work")).toBe(true);
    });

    test("escalating a one-shot takes the escalated presentation's tier", () => {
        expect(promoteTier("one-shot", "assist")).toBe("assist");
        expect(promoteTier("one-shot", "work")).toBe("work");
    });

    test("a persisted thread keeps its tier", () => {
        // No assist → work promotion: starting practice from an assist thread opens a
        // *new* work thread and leaves this one alone.
        expect(promoteTier("assist", "work")).toBe("assist");
        expect(promoteTier("work", "assist")).toBe("work");
    });

    test("nothing demotes a thread back into memory", () => {
        // It already has rows; treating it as a one-shot again would orphan them.
        expect(promoteTier("assist", "one-shot")).toBe("assist");
        expect(promoteTier("work", "one-shot")).toBe("work");
    });
});
