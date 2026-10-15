import { type VariantProps, tv } from "tailwind-variants";
import type { HTMLAttributes } from "svelte/elements";
import type { WithElementRef } from "#lib/utils.js";

export const skeletonVariants = tv({
    base: "relative overflow-hidden bg-surface-container-high/60 motion-reduce:animate-none",
    variants: {
        effect: {
            shimmer:
                "after:absolute after:inset-0 after:-translate-x-full after:animate-shimmer after:bg-gradient-to-r after:from-transparent after:via-foreground/5 after:to-transparent",
            pulse: "animate-pulse",
            none: "",
        },
        rounded: {
            none: "rounded-none",
            sm: "rounded-sm",
            md: "rounded-md",
            lg: "rounded-lg",
            full: "rounded-full",
        },
    },
    defaultVariants: {
        effect: "shimmer",
        rounded: "md",
    },
});

export type SkeletonEffect = VariantProps<typeof skeletonVariants>["effect"];

export type SkeletonProps = WithElementRef<HTMLAttributes<HTMLDivElement>> &
    VariantProps<typeof skeletonVariants> & {
        effect?: SkeletonEffect;
    };
