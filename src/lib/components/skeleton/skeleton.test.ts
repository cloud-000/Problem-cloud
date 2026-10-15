import { describe, expect, test } from "bun:test";

const state = Object.assign(<T>(value: T): T => value, {
    snapshot: <T>(value: T): T => structuredClone(value),
});
Object.assign(globalThis, { $state: state });

const {
    skeletonVariants,
    Skeleton,
    ProblemSkeleton,
    ListRowSkeleton,
    DeferredLoading,
} = await import("./index");
const { cn } = await import("#lib/utils.js");

describe("Skeleton component variants & exports", () => {
    test("exports Skeleton, ProblemSkeleton, ListRowSkeleton, and DeferredLoading", () => {
        expect(Skeleton).toBeDefined();
        expect(ProblemSkeleton).toBeDefined();
        expect(ListRowSkeleton).toBeDefined();
        expect(DeferredLoading).toBeDefined();
    });

    test("skeletonVariants defaults to shimmer effect and semantic tokens", () => {
        const baseClass = skeletonVariants();
        expect(baseClass).toContain("after:animate-shimmer");
        expect(baseClass).toContain("motion-reduce:animate-none");
        expect(baseClass).toContain("bg-surface-container-high/60");
        expect(baseClass).toContain("rounded-md");
    });

    test("skeletonVariants supports pulse and none effects", () => {
        const pulseClass = skeletonVariants({ effect: "pulse" });
        expect(pulseClass).toContain("animate-pulse");
        expect(pulseClass).not.toContain("after:animate-shimmer");

        const noneClass = skeletonVariants({ effect: "none" });
        expect(noneClass).not.toContain("animate-pulse");
        expect(noneClass).not.toContain("after:animate-shimmer");
    });

    test("skeletonVariants supports rounded variants", () => {
        expect(skeletonVariants({ rounded: "none" })).toContain("rounded-none");
        expect(skeletonVariants({ rounded: "sm" })).toContain("rounded-sm");
        expect(skeletonVariants({ rounded: "md" })).toContain("rounded-md");
        expect(skeletonVariants({ rounded: "lg" })).toContain("rounded-lg");
        expect(skeletonVariants({ rounded: "full" })).toContain("rounded-full");
    });

    test("custom rounded class overrides default variant when merged with cn", () => {
        const merged = cn(skeletonVariants({ rounded: "md" }), "rounded-2xl");
        expect(merged).toContain("rounded-2xl");
        expect(merged).not.toContain("rounded-md");
    });

    test("arbitrary classes append properly with cn", () => {
        const merged = cn(skeletonVariants(), "h-6 w-32 border border-border/20");
        expect(merged).toContain("h-6");
        expect(merged).toContain("w-32");
        expect(merged).toContain("border");
        expect(merged).toContain("after:animate-shimmer");
    });
});

describe("DeferredLoading anti-flicker controller", () => {
    test("shows immediately when delayMs is 0", () => {
        const loader = new DeferredLoading(true, { delayMs: 0 });
        expect(loader.showSkeleton).toBe(true);
        expect(loader.isLoading).toBe(true);
        loader.destroy();
    });

    test("defers skeleton when delayMs > 0", async () => {
        const loader = new DeferredLoading(true, { delayMs: 40, minDurationMs: 50 });
        expect(loader.showSkeleton).toBe(false);

        await new Promise((r) => setTimeout(r, 60));
        expect(loader.showSkeleton).toBe(true);
        loader.destroy();
    });

    test("suppresses skeleton completely if loading finishes before delayMs (anti-flicker)", async () => {
        const loader = new DeferredLoading(true, { delayMs: 50, minDurationMs: 100 });
        expect(loader.showSkeleton).toBe(false);

        // Fast resolution in 20ms
        await new Promise((r) => setTimeout(r, 20));
        loader.setLoading(false);

        // Wait past original delay threshold
        await new Promise((r) => setTimeout(r, 50));
        expect(loader.showSkeleton).toBe(false);
        loader.destroy();
    });

    test("holds skeleton visible for minDurationMs once shown", async () => {
        const loader = new DeferredLoading(true, { delayMs: 0, minDurationMs: 60 });
        expect(loader.showSkeleton).toBe(true);

        // Loading finishes almost immediately (10ms)
        await new Promise((r) => setTimeout(r, 10));
        loader.setLoading(false);

        // Must still be visible to prevent micro-flicker
        expect(loader.showSkeleton).toBe(true);

        // Wait for minDurationMs to elapse
        await new Promise((r) => setTimeout(r, 70));
        expect(loader.showSkeleton).toBe(false);
        loader.destroy();
    });
});
