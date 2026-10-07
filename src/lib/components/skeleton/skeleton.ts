import type { WithElementRef } from "$lib/utils.js";
import type { HTMLAttributes } from "svelte/elements";
import { type VariantProps, tv } from "tailwind-variants";

export const skeletonVariants = tv({
    base: "animate-pulse motion-reduce:animate-none bg-surface-container-high/60",
    variants: {
        rounded: {
            none: "rounded-none",
            sm: "rounded-sm",
            md: "rounded-md",
            lg: "rounded-lg",
            full: "rounded-full",
        },
    },
    defaultVariants: {
        rounded: "md",
    },
});

export type SkeletonRounded = VariantProps<typeof skeletonVariants>["rounded"];

export type SkeletonProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    rounded?: SkeletonRounded;
};
