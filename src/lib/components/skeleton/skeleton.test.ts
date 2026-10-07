import { describe, expect, test } from "bun:test";
import { cn } from "$lib/utils";
import { skeletonVariants, Skeleton, ProblemSkeleton } from "./index";

describe("Skeleton component variants & exports", () => {
    test("exports Skeleton and ProblemSkeleton from index barrel", () => {
        expect(Skeleton).toBeDefined();
        expect(ProblemSkeleton).toBeDefined();
    });

    test("skeletonVariants includes base animation and theme token classes", () => {
        const baseClass = skeletonVariants();
        expect(baseClass).toContain("animate-pulse");
        expect(baseClass).toContain("motion-reduce:animate-none");
        expect(baseClass).toContain("bg-surface-container-high/60");
        expect(baseClass).toContain("rounded-md");
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
        expect(merged).toContain("animate-pulse");
    });
});
