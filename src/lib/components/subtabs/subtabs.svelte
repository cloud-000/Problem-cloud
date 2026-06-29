<script lang="ts" module>
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";
    import { setContext, getContext } from "svelte";

    export const SUBTABS_CONTEXT_KEY = Symbol("subtabs");

    export interface SubtabsContext {
        value: string;
        variant: "line" | "pill" | "card";
        orientation: "horizontal" | "vertical";
    }

    export function useSubtabs() {
        const context = getContext<SubtabsContext | undefined>(SUBTABS_CONTEXT_KEY);
        if (!context) {
            throw new Error("Subtabs child components must be used within a <Subtabs.Root>");
        }
        return context;
    }

    export type SubtabsProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
        value: string;
        variant?: "line" | "pill" | "card";
        orientation?: "horizontal" | "vertical";
        onchange?: (value: string) => void;
    };
</script>

<script lang="ts">
    let {
        ref = $bindable(null),
        class: className,
        value = $bindable(),
        variant = "line",
        orientation = "horizontal",
        onchange,
        children,
        ...restProps
    }: SubtabsProps = $props();

    // Establish context with getters and setters to bind back to the props
    setContext<SubtabsContext>(SUBTABS_CONTEXT_KEY, {
        get value() {
            return value;
        },
        set value(val: string) {
            if (value !== val) {
                value = val;
                onchange?.(val);
            }
        },
        get variant() {
            return variant;
        },
        get orientation() {
            return orientation;
        }
    });
</script>

<div
    bind:this={ref}
    data-slot="subtabs-root"
    data-variant={variant}
    data-orientation={orientation}
    class={cn(
        "flex w-full",
        orientation === "vertical" ? "flex-row gap-6" : "flex-col gap-4",
        className
    )}
    {...restProps}
>
    {@render children?.()}
</div>
